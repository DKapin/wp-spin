import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import { createPromptModule } from 'inquirer';
import { execSync } from 'node:child_process';
import https from 'node:https';
import { join } from 'node:path';
import ora from 'ora';

import { BaseCommand } from './base.js';

const SUPPORTED_PHP_VERSIONS = ['7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4'] as const;
type PhpVersion = typeof SUPPORTED_PHP_VERSIONS[number];

interface WordPressRequirements {
  mysql: {
    minimum: string;
    recommended: string;
  };
  php: {
    maximum?: string;
    minimum: string;
    recommended: string;
  };
  version: string;
}

interface WordPressApiOffer {
  mysql_version?: string;
  php_version?: string;
  version?: string;
}

interface WordPressApiResponse {
  offers?: WordPressApiOffer[];
}

interface PhpApiVersion {
  cycle: string;
  eol?: string;
  support?: string;
}

type PhpApiResponse = PhpApiVersion[];

interface PhpSupportInfo {
  activeSupport: boolean;
  eolDate: null | string;
  securitySupport: boolean;
  supported: boolean;
  version: string;
}

interface CompatibilityData {
  lastUpdated: string;
  phpSupport: PhpSupportInfo[];
  wordpressRequirements: WordPressRequirements[];
}

export default class Php extends BaseCommand {
  static args = {
    version: Args.string({
      description: 'PHP version to switch to',
      options: [...SUPPORTED_PHP_VERSIONS],
      required: false,
    }),
  };
  static description = 'Manage PHP version for WordPress environment';
static examples = [
    '$ wp-spin php',
    '$ wp-spin php 8.3',
    '$ wp-spin php 8.2',
    '$ wp-spin php 7.4',
    '$ wp-spin php --list',
  ];
static flags = {
    ...BaseCommand.flags,
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force PHP version change without confirmation',
    }),
    list: Flags.boolean({
      char: 'l',
      default: false,
      description: 'List all available PHP versions',
    }),
  };
static hidden = false;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Php);
    
    // List available versions if requested
    if (flags.list) {
      await this.listPhpVersions();
      return;
    }
    
    // Show current version if no version specified
    if (!args.version) {
      await this.showCurrentPhpVersion();
      return;
    }
    
    // Validate PHP version
    const targetVersion = args.version as PhpVersion;
    if (!SUPPORTED_PHP_VERSIONS.includes(targetVersion)) {
      this.error(`Unsupported PHP version: ${targetVersion}. Supported versions: ${SUPPORTED_PHP_VERSIONS.join(', ')}`);
    }
    
    // Check if environment is running
    await this.checkDockerEnvironment();
    const running = await this.isWordPressRunning(false);
    
    if (!running) {
      this.error('WordPress environment is not running. Start it first with: wp-spin start');
    }
    
    // Get current PHP version
    const currentVersion = await this.getCurrentPhpVersion();
    
    if (currentVersion === targetVersion) {
      this.log(`WordPress environment is already using PHP ${chalk.cyan(targetVersion)}`);
      return;
    }
    
    // Confirm version change unless forced
    if (!flags.force) {
      const prompt = createPromptModule();
      const { confirm } = await prompt({
        default: false,
        message: `Change PHP version from ${currentVersion} to ${targetVersion}? This will restart your containers.`,
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('PHP version change cancelled');
        return;
      }
    }
    
    // Change PHP version
    await this.changePhpVersion(targetVersion, currentVersion);
  }

  private async changePhpVersion(targetVersion: PhpVersion, currentVersion: string): Promise<void> {
    const spinner = ora(`Changing PHP version from ${currentVersion} to ${targetVersion}...`).start();
    
    try {
      const projectPath = this.docker.getProjectPath();
      const dockerComposePath = join(projectPath, 'docker-compose.yml');
      
      // Read current docker-compose.yml
      spinner.text = 'Reading Docker Compose configuration...';
      const dockerComposeContent = await fs.readFile(dockerComposePath, 'utf8');
      
      // Update PHP version in docker-compose.yml
      spinner.text = 'Updating Docker Compose configuration...';
      const updatedContent = this.updatePhpVersionInDockerCompose(dockerComposeContent, targetVersion);
      
      // Write updated docker-compose.yml
      await fs.writeFile(dockerComposePath, updatedContent);
      
      // Stop current containers
      spinner.text = 'Stopping current containers...';
      execSync('docker-compose down', { 
        cwd: projectPath,
        stdio: 'pipe' 
      });
      
      // Pull new PHP image
      spinner.text = `Pulling PHP ${targetVersion} image...`;
      execSync('docker-compose pull wordpress', { 
        cwd: projectPath,
        stdio: 'pipe' 
      });
      
      // Start containers with new PHP version
      spinner.text = 'Starting containers with new PHP version...';
      execSync('docker-compose up -d', { 
        cwd: projectPath,
        stdio: 'pipe' 
      });
      
      // Wait for containers to be ready
      spinner.text = 'Waiting for containers to be ready...';
      await this.waitForContainers();
      
      // Verify the change
      const newVersion = await this.getCurrentPhpVersion();
      
      if (newVersion === targetVersion) {
        spinner.succeed(`Successfully changed PHP version to ${chalk.cyan(`PHP ${targetVersion}`)}`);
        
        // Show updated info
        this.log('\nWordPress environment updated:');
        this.log(`• PHP version: ${chalk.cyan(`PHP ${newVersion}`)}`);
        
        // Show site URL
        const siteUrl = await this.getCurrentSiteUrl();
        if (siteUrl) {
          this.log(`• Site URL: ${chalk.cyan(siteUrl)}`);
        }
        
      } else {
        spinner.warn(`PHP version changed but verification shows: PHP ${newVersion}`);
      }
      
    } catch (error) {
      spinner.fail('Failed to change PHP version');
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private delayExecution(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  private async fetchLiveCompatibilityData(): Promise<CompatibilityData> {
    /**
     * Fetches live compatibility data from official sources:
     * 
     * 1. WordPress.org API (https://api.wordpress.org/core/version-check/1.7/)
     *    - Official WordPress API maintained by WordPress core team
     *    - Provides latest WordPress version and minimum PHP requirements
     *    - Updated automatically when new WordPress versions are released
     * 
     * 2. EndOfLife.date API (https://endoflife.date/api/php.json)  
     *    - Community-maintained database of software EOL dates
     *    - Tracks PHP support lifecycle (active, security, EOL)
     *    - Open source project with reliable data
     */

    // Try WordPress.org API first for WordPress requirements
    let wordpressData: null | WordPressApiResponse = null;
    try {
      const wpResponse = await this.httpGet('https://api.wordpress.org/core/version-check/1.7/');
      wordpressData = JSON.parse(wpResponse) as WordPressApiResponse;
    } catch {
      // Graceful fallback to built-in data
    }

    // Try endoflife.date for PHP support info
    let phpData: null | PhpApiResponse = null;
    try {
      const phpResponse = await this.httpGet('https://endoflife.date/api/php.json');
      phpData = JSON.parse(phpResponse) as PhpApiResponse;
    } catch {
      // Graceful fallback to built-in data
    }

    // Transform the data into our format
    const compatibilityData: CompatibilityData = {
      lastUpdated: new Date().toISOString(),
      phpSupport: this.transformPhpData(phpData),
      wordpressRequirements: this.transformWordPressData(wordpressData),
    };

    return compatibilityData;
  }

  private getCompatibilityForLatestWordPress(php: number): string {
    if (php <= 73) return chalk.red(' (Not supported)');
    if (php === 74) return chalk.yellow(' (Deprecated, min version)');
    if (php === 80) return chalk.yellow(' (Supported, but EOL)');
    if (php >= 81 && php <= 83) return chalk.green(' (Recommended)');
    if (php === 84) return chalk.blue(' (Latest, may have issues)');
    return chalk.gray(' (Unknown compatibility)');
  }

  private getCompatibilityForOlderWordPress(php: number): string {
    if (php <= 72) return chalk.red(' (Not supported)');
    if (php === 73) return chalk.red(' (EOL)');
    if (php === 74) return chalk.green(' (Recommended for older WP)');
    if (php === 80) return chalk.green(' (Good choice)');
    if (php >= 81) return chalk.yellow(' (May need testing)');
    return chalk.gray(' (Unknown compatibility)');
  }

  private getCompatibilityForWordPress6061(php: number): string {
    if (php <= 72) return chalk.red(' (Not supported)');
    if (php === 73) return chalk.red(' (EOL, not recommended)');
    if (php === 74) return chalk.yellow(' (Minimum version)');
    if (php === 80) return chalk.green(' (Supported)');
    if (php >= 81 && php <= 82) return chalk.green(' (Recommended)');
    if (php >= 83) return chalk.yellow(' (May have compatibility issues)');
    return chalk.gray(' (Unknown compatibility)');
  }

  private getCompatibilityForWordPress6263(php: number): string {
    if (php <= 73) return chalk.red(' (Not supported)');
    if (php === 74) return chalk.yellow(' (Minimum version)');
    if (php === 80) return chalk.yellow(' (Supported, but EOL)');
    if (php >= 81 && php <= 83) return chalk.green(' (Recommended)');
    if (php === 84) return chalk.yellow(' (May have compatibility issues)');
    return chalk.gray(' (Unknown compatibility)');
  }

  private getCompatibilityForWordPressVersion(wp: number, php: number): string {
    if (wp >= 64) {
      return this.getCompatibilityForLatestWordPress(php);
    }
    
    if (wp >= 62) {
      return this.getCompatibilityForWordPress6263(php);
    }
    
    if (wp >= 60) {
      return this.getCompatibilityForWordPress6061(php);
    }
    
    return this.getCompatibilityForOlderWordPress(php);
  }

  private async getCurrentPhpVersion(): Promise<string> {
    try {
      const containerName = this.getContainerNames().wordpress;
      const phpVersion = execSync(
        `docker exec ${containerName} php -r "echo PHP_VERSION;"`,
        { encoding: 'utf8' }
      ).trim();
      
      // Extract major.minor version (e.g., "8.2.15" -> "8.2")
      const [major, minor] = phpVersion.split('.');
      return `${major}.${minor}`;
    } catch {
      throw new Error('Failed to get current PHP version from container');
    }
  }

  private async getCurrentSiteUrl(): Promise<null | string> {
    try {
      const containerName = this.getContainerNames().wordpress;
      const siteUrl = execSync(
        `docker exec ${containerName} sh -c "cd /var/www/html && wp option get siteurl --allow-root 2>/dev/null"`,
        { encoding: 'utf8' }
      ).trim();
      
      return siteUrl || null;
    } catch {
      return null;
    }
  }

  private getGeneralPhpStatus(phpVersion: string): string {
    switch (phpVersion) {
      case '7.2':
      case '7.3': {
        return chalk.red(' (EOL)');
      }

      case '7.4': {
        return chalk.yellow(' (Legacy, EOL Nov 2022)');
      }

      case '8.0': {
        return chalk.yellow(' (EOL Nov 2023)');
      }

      case '8.1': {
        return chalk.green(' (Recommended)');
      }

      case '8.2': {
        return chalk.green(' (Recommended)');
      }

      case '8.3': {
        return chalk.green(' (Recommended)');
      }

      case '8.4': {
        return chalk.blue(' (Latest)');
      }

      default: {
        return '';
      }
    }
  }

  private getLivePhpCompatibilityStatus(phpVersion: string, wordpressVersion: null | string, liveData: CompatibilityData): string {
    // Find PHP support info
    const phpInfo = liveData.phpSupport.find(p => p.version === phpVersion);
    
    // Find WordPress requirements
    const wpReq = wordpressVersion 
      ? liveData.wordpressRequirements.find(wp => this.versionMatches(wp.version, wordpressVersion))
      : liveData.wordpressRequirements[0]; // Use latest if no specific version

    if (!phpInfo) {
      return this.getPhpCompatibilityStatus(phpVersion, wordpressVersion);
    }

    // Check WordPress compatibility
    let wpCompatible = true;
    let wpStatus = '';
    
    if (wpReq) {
      const phpNum = Number.parseFloat(phpVersion);
      const minPhp = Number.parseFloat(wpReq.php.minimum);
      const recPhp = Number.parseFloat(wpReq.php.recommended);
      
      if (phpNum < minPhp) {
        wpCompatible = false;
        wpStatus = ' - Not supported by WordPress';
      } else if (phpNum < recPhp) {
        wpStatus = ' - Minimum for WordPress';
      } else {
        wpStatus = ' - Recommended for WordPress';
      }
    }

    // Combine PHP support status with WordPress compatibility
    if (!wpCompatible) {
      return chalk.red(` (Not supported by WordPress${wpStatus})`);
    }

    if (!phpInfo.supported) {
      return chalk.red(` (EOL${phpInfo.eolDate ? ` since ${phpInfo.eolDate}` : ''}${wpStatus})`);
    }

    if (phpInfo.activeSupport) {
      return chalk.green(` (Active support${wpStatus})`);
    }

    if (phpInfo.securitySupport) {
      return chalk.yellow(` (Security support only${wpStatus})`);
    }

    return chalk.gray(` (Legacy${wpStatus})`);
  }

  private getLiveRecommendedPhpVersion(wordpressVersion: null | string, liveData: CompatibilityData): string {
    const wpReq = wordpressVersion 
      ? liveData.wordpressRequirements.find(wp => this.versionMatches(wp.version, wordpressVersion))
      : liveData.wordpressRequirements[0];

    if (wpReq) {
      return wpReq.php.recommended;
    }

    // Find the latest PHP version with active support
    const activePhp = liveData.phpSupport
      .filter(p => p.activeSupport)
      .sort((a, b) => Number.parseFloat(b.version) - Number.parseFloat(a.version))[0];

    return activePhp?.version || '8.2';
  }

  private getPhpCompatibilityStatus(phpVersion: string, wordpressVersion: null | string): string {
    if (!wordpressVersion) {
      // Fallback to general status when WordPress version is unknown
      return this.getGeneralPhpStatus(phpVersion);
    }

    const wpMajorMinor = this.parseVersion(wordpressVersion);
    const phpMajorMinor = this.parseVersion(phpVersion);

    // WordPress PHP compatibility matrix
    const compatibility = this.getWordPressPhpCompatibility(wpMajorMinor, phpMajorMinor);
    
    return compatibility;
  }

  private getRecommendedPhpVersion(wordpressVersion: null | string): string {
    if (!wordpressVersion) {
      return '8.2'; // General recommendation
    }

    const wpVersion = this.parseVersion(wordpressVersion);
    const wp = wpVersion.major * 10 + wpVersion.minor;

    // WordPress 6.4+: Recommend PHP 8.2 or 8.3
    if (wp >= 64) return '8.3';
    
    // WordPress 6.2-6.3: Recommend PHP 8.1 or 8.2
    if (wp >= 62) return '8.2';
    
    // WordPress 6.0-6.1: Recommend PHP 8.0 or 8.1
    if (wp >= 60) return '8.1';
    
    // Older WordPress: Recommend PHP 7.4 or 8.0
    return '8.0';
  }

  private getWordPressPhpCompatibility(wpVersion: { major: number; minor: number }, phpVersion: { major: number; minor: number }): string {
    const wp = wpVersion.major * 10 + wpVersion.minor; // e.g., 6.4 becomes 64
    const php = phpVersion.major * 10 + phpVersion.minor; // e.g., 8.1 becomes 81

    return this.getCompatibilityForWordPressVersion(wp, php);
  }

  private async getWordPressVersion(): Promise<null | string> {
    try {
      const containerName = this.getContainerNames().wordpress;
      const wpVersion = execSync(
        `docker exec ${containerName} sh -c "cd /var/www/html && wp core version --allow-root 2>/dev/null"`,
        { encoding: 'utf8' }
      ).trim();
      
      return wpVersion || null;
    } catch {
      return null;
    }
  }

  private async httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: 3000 }, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        });
      });
      
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  private async listPhpVersions(): Promise<void> {
    this.log('\nSupported PHP versions:\n');
    
    // Get WordPress version to provide accurate compatibility info
    let wordpressVersion: null | string = null;
    try {
      await this.checkDockerEnvironment();
      const running = await this.isWordPressRunning(false);
      if (running) {
        wordpressVersion = await this.getWordPressVersion();
      }
    } catch {
      // Continue without WordPress version info
    }
    
    // Try to fetch live compatibility data with automatic fallback
    let liveData: CompatibilityData | null = null;
    const spinner = ora('Fetching latest compatibility data...').start();
    try {
      liveData = await this.fetchLiveCompatibilityData();
      spinner.succeed('Latest compatibility data loaded');
    } catch {
      spinner.warn('Network unavailable, using built-in compatibility data');
      // Continue with built-in data
    }
    
    if (wordpressVersion) {
      this.log(`  ${chalk.blue(`WordPress ${wordpressVersion} detected`)}`);
    }
    
    if (liveData) {
      this.log(`  ${chalk.green('Live compatibility data')} (updated: ${new Date(liveData.lastUpdated).toLocaleDateString()})\n`);
    } else {
      this.log(`  ${chalk.yellow('Built-in compatibility data')}\n`);
    }
    
    // Group versions by major version for better display
    const php7Versions = SUPPORTED_PHP_VERSIONS.filter(v => v.startsWith('7.'));
    const php8Versions = SUPPORTED_PHP_VERSIONS.filter(v => v.startsWith('8.'));
    
    if (php7Versions.length > 0) {
      this.log(`  ${chalk.yellow('PHP 7.x (Legacy)')}`);
      for (const version of php7Versions) {
        const status = liveData 
          ? this.getLivePhpCompatibilityStatus(version, wordpressVersion, liveData)
          : this.getPhpCompatibilityStatus(version, wordpressVersion);
        this.log(`    • PHP ${chalk.cyan(version)}${status}`);
      }

      this.log('');
    }
    
    if (php8Versions.length > 0) {
      this.log(`  ${chalk.green('PHP 8.x (Modern)')}`);
      for (const version of php8Versions) {
        const status = liveData 
          ? this.getLivePhpCompatibilityStatus(version, wordpressVersion, liveData)
          : this.getPhpCompatibilityStatus(version, wordpressVersion);
        this.log(`    • PHP ${chalk.cyan(version)}${status}`);
      }
    }
    
    const recommendedVersion = liveData 
      ? this.getLiveRecommendedPhpVersion(wordpressVersion, liveData)
      : this.getRecommendedPhpVersion(wordpressVersion);
    
    this.log('\nUsage:');
    this.log(`  ${chalk.blue(`wp-spin php ${recommendedVersion}`)} - Switch to PHP ${recommendedVersion} (recommended)`);
    this.log(`  ${chalk.blue('wp-spin php 7.4')} - Switch to PHP 7.4 (legacy support)`);
    this.log(`  ${chalk.blue('wp-spin php')} - Show current PHP version`);
    this.log(`  ${chalk.blue('wp-spin php --list')} - Show all versions with latest compatibility data`);
    
    this.log('\nNotes:');
    if (wordpressVersion) {
      this.log(`  • Compatibility shown for WordPress ${chalk.cyan(wordpressVersion)}`);
    }

    if (liveData) {
      this.log(`  • ${chalk.green('Live data')} from WordPress.org and EndOfLife.date APIs`);
    } else {
      this.log(`  • ${chalk.yellow('Built-in data')} used (network unavailable)`);
    }

    this.log(`  • ${chalk.yellow('Legacy versions')} may have limited plugin compatibility`);
    this.log(`  • ${chalk.green('Recommended versions')} have active security support and WordPress compatibility`);
    this.log(`  • ${chalk.blue('Latest version')} includes newest PHP features but may have compatibility issues`);
  }

  private parseVersion(version: string): { major: number; minor: number } {
    const parts = version.split('.').map(p => Number.parseInt(p, 10));
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
    };
  }

  private async showCurrentPhpVersion(): Promise<void> {
    try {
      await this.checkDockerEnvironment();
      const running = await this.isWordPressRunning(false);
      
      if (!running) {
        this.log('WordPress environment is not running. Start it with: wp-spin start');
        return;
      }
      
      const currentVersion = await this.getCurrentPhpVersion();
      this.log(`Current PHP version: ${chalk.cyan(`PHP ${currentVersion}`)}`);
      
      // Show additional PHP info
      await this.showPhpInfo(currentVersion);
      
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to get PHP version');
    }
  }

  private async showPhpInfo(_version: string): Promise<void> {
    try {
      const containerName = this.getContainerNames().wordpress;
      
      // Get PHP extensions
      const extensions = execSync(
        `docker exec ${containerName} sh -c "php -m | grep -E '^(mysqli|pdo|gd|curl|zip|xml|mbstring|imagick|xdebug)' | head -10"`,
        { encoding: 'utf8' }
      ).trim().split('\n').filter(ext => ext.length > 0);
      
      // Get memory limit
      const memoryLimit = execSync(
        `docker exec ${containerName} php -r "echo ini_get('memory_limit');"`,
        { encoding: 'utf8' }
      ).trim();
      
      this.log('\nPHP Configuration:');
      this.log(`  Memory limit: ${chalk.blue(memoryLimit)}`);
      
      if (extensions.length > 0) {
        this.log(`  Key extensions: ${chalk.blue(extensions.slice(0, 5).join(', '))}${extensions.length > 5 ? '...' : ''}`);
      }
      
    } catch {
      // Continue silently if we can't get PHP info
    }
  }

  private transformPhpData(data: null | PhpApiResponse): PhpSupportInfo[] {
    if (!data || !Array.isArray(data)) {
      // Fallback to current known PHP support status
      return [
        { activeSupport: false, eolDate: '2020-11-30', securitySupport: false, supported: false, version: '7.2' },
        { activeSupport: false, eolDate: '2021-12-06', securitySupport: false, supported: false, version: '7.3' },
        { activeSupport: false, eolDate: '2022-11-28', securitySupport: false, supported: false, version: '7.4' },
        { activeSupport: false, eolDate: '2023-11-26', securitySupport: false, supported: false, version: '8.0' },
        { activeSupport: false, eolDate: '2025-11-25', securitySupport: true, supported: true, version: '8.1' },
        { activeSupport: true, eolDate: '2026-12-08', securitySupport: true, supported: true, version: '8.2' },
        { activeSupport: true, eolDate: '2027-11-23', securitySupport: true, supported: true, version: '8.3' },
      ];
    }

    return data.map((phpVersion: PhpApiVersion) => ({
      activeSupport: phpVersion.support !== undefined && (!phpVersion.support || new Date(phpVersion.support) > new Date()),
      eolDate: phpVersion.eol ?? null,
      securitySupport: phpVersion.support !== undefined && (!phpVersion.eol || new Date(phpVersion.eol) > new Date()),
      supported: !phpVersion.eol || new Date(phpVersion.eol) > new Date(),
      version: phpVersion.cycle,
    }));
  }

  private transformWordPressData(data: null | WordPressApiResponse): WordPressRequirements[] {
    if (!data || !data.offers || data.offers.length === 0) {
      // Fallback to current known requirements
      return [
        {
          mysql: { minimum: '5.7', recommended: '8.0' },
          php: { minimum: '7.4', recommended: '8.2' },
          version: '6.4',
        },
      ];
    }

    // Extract requirements from WordPress API response
    const latestVersion = data.offers[0];
    return [
      {
        mysql: {
          minimum: latestVersion.mysql_version || '5.7',
          recommended: '8.0',
        },
        php: {
          minimum: latestVersion.php_version || '7.4',
          recommended: '8.2', // WordPress doesn't provide this in API, use sensible default
        },
        version: latestVersion.version || '6.4',
      },
    ];
  }

  private updatePhpVersionInDockerCompose(content: string, version: PhpVersion): string {
    // Update the WordPress image to use the specified PHP version
    // Look for patterns like "wordpress:6.4-php8.1" or "wordpress:php8.1"
    const phpImagePattern = /image:\s*wordpress:.*php\d+\.\d+/g;
    const wordpressImagePattern = /image:\s*wordpress:(\d+\.\d+-)php\d+\.\d+/g;
    
    // If we find a versioned WordPress image with PHP version
    if (wordpressImagePattern.test(content)) {
      return content.replaceAll(wordpressImagePattern, (_match, wpVersion) => `image: wordpress:${wpVersion}php${version}`);
    }
    
    // If we find a simple php-versioned image
    if (phpImagePattern.test(content)) {
      return content.replaceAll(phpImagePattern, (match) => match.replace(/php\d+\.\d+/, `php${version}`));
    }
    
    // If no PHP version specified, add it to the wordpress image
    const genericWordpressPattern = /image:\s*wordpress(?::(\d+\.\d+))?$/gm;
    return content.replaceAll(genericWordpressPattern, (_match, wpVersion) => {
      const imageTag = wpVersion ? `${wpVersion}-php${version}` : `php${version}`;
      return `image: wordpress:${imageTag}`;
    });
  }

  private versionMatches(available: string, target: string): boolean {
    const availableMajorMinor = available.split('.').slice(0, 2).join('.');
    const targetMajorMinor = target.split('.').slice(0, 2).join('.');
    return availableMajorMinor === targetMajorMinor;
  }

  private async waitForContainers(): Promise<void> {
    const maxWaitTime = 30_000;
    const checkInterval = 2000;
    const startTime = Date.now();
    
    return this.waitForContainersRecursive(startTime, maxWaitTime, checkInterval);
  }

  private async waitForContainersRecursive(startTime: number, maxWaitTime: number, checkInterval: number): Promise<void> {
    if (Date.now() - startTime >= maxWaitTime) {
      throw new Error('Containers failed to start within expected time');
    }
    
    const running = await this.isWordPressRunning(false);
    if (running) {
      try {
        const containerName = this.getContainerNames().wordpress;
        execSync(
          `docker exec ${containerName} wp --info --allow-root`,
          { stdio: 'pipe', timeout: 5000 }
        );
        return;
      } catch {
        // Container not responsive yet, continue waiting
      }
    }
    
    await this.delayExecution(checkInterval);
    return this.waitForContainersRecursive(startTime, maxWaitTime, checkInterval);
  }
}