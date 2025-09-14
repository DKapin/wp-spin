/* eslint-disable perfectionist/sort-imports */
/* eslint-disable perfectionist/sort-classes */
/* eslint-disable perfectionist/sort-union-types */
/* eslint-disable perfectionist/sort-object-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable max-params */

import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import ora from 'ora';
import { createPromptModule } from 'inquirer';
import path from 'node:path';
import terminalLink from 'terminal-link';

import { BaseCommand } from './base.js';

// More accurate type for process streams
type ProcessWithStdio = {
  stdout?: {
    on: (event: string, callback: (data: Buffer) => void) => void;
  } | null;
  stderr?: {
    on: (event: string, callback: (data: Buffer) => void) => void;
  } | null;
};

interface ShareFlags {
  auth?: string;
  'cidr-allow'?: string[];
  'cidr-deny'?: string[];
  debug: boolean;
  domain?: string;
  'no-fixurl': boolean;
  port?: number;
}

export default class Share extends BaseCommand {
  static description = 'Share your WordPress site publicly using ngrok';
  static examples = [
    '$ wp-spin share',
    '$ wp-spin share --domain=mysite.ngrok-free.app',
  ];
  static flags = {
    auth: Flags.string({
      char: 'a',
      description: 'ngrok auth token (or use NGROK_AUTH_TOKEN env variable)',
    }),
    'cidr-allow': Flags.string({
      char: 'A',
      description: 'Reject connections that do not match the given CIDRs',
      multiple: true,
    }),
    'cidr-deny': Flags.string({
      char: 'D',
      description: 'Reject connections that match the given CIDRs',
      multiple: true,
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Enable debug mode to see detailed ngrok output',
    }),
    domain: Flags.string({
      char: 'd',
      description: 'Custom domain for your ngrok tunnel (requires ngrok account)',
    }),
    'no-fixurl': Flags.boolean({
      char: 'u',
      default: false,
      description: 'Skip fixing WordPress site URL for ngrok compatibility',
    }),
    port: Flags.integer({
      char: 'p',
      description: 'Port to expose (defaults to WordPress port from Docker)',
    }),
  };
  static hidden = false;
  private currentNgrokUrl: string = '';
  private flags: ShareFlags = {
    debug: false,
    'no-fixurl': false,
  };
  
  // Helper function to make URL clickable
  private makeClickable(url: string): string {
    return terminalLink(url, url);
  }

  /**
   * Check if ngrok is already running
   */
  private async checkNgrokRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('curl', ['-s', 'http://localhost:4040/api/tunnels']);
      const tunnels = JSON.parse(stdout);
      return tunnels?.tunnels?.length > 0;
    } catch {
      // If curl fails or can't connect to ngrok API, ngrok is not running
      return false;
    }
  }

  /**
   * Attempt to find and kill running ngrok processes
   */
  private async killRunningNgrok(spinner: ReturnType<typeof ora>): Promise<boolean> {
    spinner.start('Attempting to stop running ngrok processes...');
    
    try {
      // Try different commands based on platform
      const killCommand = process.platform === 'win32'
        ? await execa('taskkill', ['/F', '/IM', 'ngrok.exe'])
        : await execa('pkill', ['-f', 'ngrok']);
      
      // Wait a moment for the process to fully terminate
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });
      
      // Check if it's really gone
      const stillRunning = await this.checkNgrokRunning();
      
      if (stillRunning) {
        spinner.fail('Could not stop ngrok process');
        return false;
      }
      
      spinner.succeed('Successfully stopped ngrok process');
      return true;
    } catch (error) {
      spinner.fail('Failed to stop ngrok process');
      if (this.flags.debug) {
        console.log(`Error killing ngrok: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      return false;
    }
  }

  async run(): Promise<void> {
    const spinner = ora();

    try {
      // Parse flags first
      const { flags } = await this.parse(Share);
      this.flags = flags as ShareFlags;
      
      await this.validateProjectContext(flags as ShareFlags, spinner);
      await this.ensureNgrokInstalled(spinner);
      
      // Get actual WordPress port if possible
      console.log(`DEBUG: About to call getWordPressPort with: ${flags.port ?? 8080}`);
      const port = await this.getWordPressPort(flags.port ?? 8080);
      console.log(`DEBUG: getWordPressPort returned: ${port}`);
      
      // Start ngrok and handle the tunnel
      await this.startNgrokTunnel(port, flags as ShareFlags, spinner);
    } catch (error) {
      spinner.fail('Failed to share WordPress site');
      
      if (error instanceof Error) {
        this.error(error.message);
      }
      
      this.error('Failed to share WordPress site');
    }
  }

  /**
   * Validates the project context and Docker environment
   */
  private async validateProjectContext(flags: ShareFlags, spinner: ReturnType<typeof ora>): Promise<string> {
    // BaseCommand.init() already resolved the path and initialized this.docker
    const projectPath = this.docker.getProjectPath();
    const isProjectValid = this.docker && await this.docker.checkProjectExists();

    if (!isProjectValid) {
      this.error('Could not find a valid wp-spin project. Run `wp-spin init` or specify a valid path with --site.');
    }
    
    // Check if Docker is running (this check is general, not project-specific)
    await this.checkDockerEnvironment();
    
    // Check if WordPress container is running for the specific project
    let wordpressContainerName = '';
    spinner.start(`Checking WordPress environment at ${projectPath}...`);
    try {
      // Use docker-compose ps to check status within the project context
      const { stdout } = await execa('docker-compose', ['-f', `${projectPath}/docker-compose.yml`, 'ps', '--services', '--filter', 'status=running'], {
        cwd: projectPath // Important: Run docker-compose in the project directory
      });
      
      const runningServices = stdout.split('\n').filter(s => s.trim() === 'wordpress');

      if (runningServices.length === 0) {
        spinner.fail('WordPress container is not running');
        this.error('WordPress container for this site is not running. Please start it first with `wp-spin start --site=...`.');
      }
      
      // Get the specific container name using BaseCommand helper
      wordpressContainerName = this.getContainerNames().wordpress;
      spinner.succeed(`WordPress environment is running (Container: ${wordpressContainerName})`);

    } catch (error) {
      spinner.fail('Failed to check Docker containers for this site');
      this.error(`Failed to check Docker containers: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return wordpressContainerName;
  }

  /**
   * Starts the ngrok tunnel and handles URL detection
   */
  private async startNgrokTunnel(port: number, flags: ShareFlags, spinner: ReturnType<typeof ora>): Promise<void> {
    // Check if ngrok is already running
    const ngrokRunning = await this.checkNgrokRunning();
    if (ngrokRunning) {
      await this.handleExistingNgrokTunnel(spinner);
    }

    // Start ngrok process
    const ngrokProcess = await this.startNgrokProcess(port, flags, spinner);
    if (!ngrokProcess) {
      return;
    }

    // Get WordPress container name
    const wordpressContainer = this.getContainerNames().wordpress;
    let foundUrl = false;

    // Handle ngrok output and URL detection
    await this.handleNgrokOutput(
      ngrokProcess,
      flags,
      spinner,
      port,
      wordpressContainer,
      (url: string, backupCreated: boolean) => {
        foundUrl = true;
        this.currentNgrokUrl = url;
        this.displaySuccessMessage(url, port, spinner, !backupCreated);
      },
      () => {
        // Cleanup when done
        if (ngrokProcess.pid) {
          process.kill(ngrokProcess.pid);
        }
      }
    );
  }

  /**
   * Handles the case when ngrok is already running
   */
  private async handleExistingNgrokTunnel(spinner: ReturnType<typeof ora>): Promise<void> {
    spinner.fail('ngrok is already running');
    
    console.log(chalk.yellow('\nAn ngrok tunnel appears to be already running.'));
    console.log('This can happen if:');
    console.log('1. You have another wp-spin share instance active');
    console.log('2. You have another ngrok tunnel running elsewhere');
    console.log('\nVisit http://localhost:4040 to see the currently running tunnel.');
    console.log('\nYou can try to stop the current ngrok process with:');
    console.log(chalk.blue('  wp-spin unshare'));
    console.log('\nOr manually kill the ngrok process with:');
    console.log(chalk.blue('  pkill -f ngrok    # On macOS/Linux'));
    console.log(chalk.blue('  taskkill /F /IM ngrok.exe    # On Windows'));
    
    const shouldStop = await this.promptToStopNgrok();
    if (shouldStop) {
      const stopped = await this.killRunningNgrok(spinner);
      if (!stopped) {
        this.error('Could not stop the running ngrok process. Please try stopping it manually.');
      }
    } else {
      this.error('Please stop the running ngrok process before starting a new tunnel.');
    }
  }

  /**
   * Prompts the user to stop the running ngrok process
   */
  private async promptToStopNgrok(): Promise<boolean> {
    try {
      const prompt = createPromptModule();
      const responses = await prompt([
        {
          default: true,
          message: 'Would you like to attempt to stop the running ngrok process?',
          name: 'shouldStop',
          type: 'confirm',
        },
      ]);
      return responses.shouldStop;
    } catch {
      return false;
    }
  }

  /**
   * Starts the ngrok process with the given configuration
   */
  private async startNgrokProcess(port: number, flags: ShareFlags, spinner: ReturnType<typeof ora>): Promise<ChildProcess | null> {
    try {
      const args = this.buildNgrokArgs(port, flags);
      spinner.start(`Creating ngrok tunnel to http://localhost:${port}...`);
      
      // Use spawn instead of execa to get a proper ChildProcess
      const { spawn } = await import('node:child_process');
      return spawn('ngrok', args, {
        env: {
          ...process.env,
          FORCE_COLOR: '1',
        },
        stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (error) {
      await this.handleNgrokError(error, spinner);
      return null;
    }
  }

  /**
   * Builds the command line arguments for ngrok
   */
  private buildNgrokArgs(port: number, flags: ShareFlags): string[] {
    const args = ['http', port.toString()];

    if (flags.auth) {
      args.push('--authtoken', flags.auth);
    }

    if (flags.domain) {
      args.push('--domain', flags.domain);
    }

    if (flags['cidr-allow']?.length) {
      args.push('--allow-cidr', flags['cidr-allow'].join(','));
    }

    if (flags['cidr-deny']?.length) {
      args.push('--deny-cidr', flags['cidr-deny'].join(','));
    }

    return args;
  }

  /**
   * Handle output from ngrok process to detect URL
   */
  private async handleNgrokOutput(
    ngrokProcess: ProcessWithStdio, 
    flags: ShareFlags, 
    spinner: ReturnType<typeof ora>,
    port: number,
    wordpressContainer: string,
    onUrlFound: (url: string, backupCreated: boolean) => void,
    onComplete: () => void
  ): Promise<void> {
    let foundUrl = false;
    
    // Set up interval to check ngrok API as a fallback
    const checkInterval = this.setupUrlCheckInterval(
      flags, spinner, port, wordpressContainer, () => foundUrl, (url, backup) => {
        foundUrl = true;
        clearInterval(checkInterval);
        onUrlFound(url, backup);
      }, onComplete
    );
    
    // Regex patterns to extract ngrok URL from console output
    const urlPatterns = [
      /Forwarding\s+https:\/\/([^.\s]+\.ngrok-free\.app|[^.\s]+\.ngrok\.io)/,
      /https:\/\/([^.\s]+\.ngrok-free\.app|[^.\s]+\.ngrok\.io)/
    ];

    // Start displaying progress
    spinner.text = 'Starting ngrok tunnel...';

    // Listen for stdout to capture ngrok URL
    ngrokProcess.stdout?.on('data', (data: Buffer) => {
      if (foundUrl) return; // Skip processing if URL already found

      // Parse output and look for ngrok URL
      const output = data.toString();

      if (flags.debug) {
        console.log('ngrok output:', output);
      }

      // Check for URL in the output using our patterns
      let detectedUrl: string | null = null;

      // Find first matching URL pattern
      for (const pattern of urlPatterns) {
        const match = output.match(pattern);
        if (match) {
          // If the pattern includes "Forwarding", use the full match
          detectedUrl = pattern.toString().includes('Forwarding') 
            ? match[0].replace('Forwarding', '').trim()
            : `https://${match[1]}`;
          break; // Exit the loop once we find a URL
        }
      }

      // Process the detected URL outside the loop
      if (detectedUrl && !foundUrl) {
        foundUrl = true;
        clearInterval(checkInterval);
        // Process the URL asynchronously (deliberately not awaited)
        this.processNgrokUrl(detectedUrl, flags, spinner, port, wordpressContainer, onUrlFound, onComplete);
      }
    });

    // Handle errors
    ngrokProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();

      if (error.includes('Error')) {
        spinner.fail(`ngrok error: ${error}`);
      }

      if (flags.debug) {
        console.log(`ngrok error: ${error}`);
      }
    });
  }

  /**
   * Processes a detected ngrok URL, fixes WordPress URL, and calls callbacks.
   */
  private async processNgrokUrl(
    url: string,
    flags: ShareFlags, 
    spinner: ReturnType<typeof ora>,
    port: number,
    wordpressContainer: string,
    onUrlFound: (url: string, backupCreated: boolean) => void,
    onComplete: () => void
  ): Promise<void> {
    try {
      // Set the current ngrok URL for later use in URL replacements
      this.currentNgrokUrl = url;
      
      // Display basic success message immediately
      spinner.succeed(`ngrok tunnel created at ${this.makeClickable(url)}`);
      
      let backupCreated = false;
      
      // Fix WordPress URLs if the option is enabled
      if (!flags['no-fixurl'] && wordpressContainer) {
        try {
          backupCreated = await this.fixWordPressUrl(wordpressContainer, url, spinner);
        } catch (error) {
          if (flags.debug) {
            console.error(`Error fixing WordPress URLs: ${error instanceof Error ? error.message : String(error)}`);
          }

          // Show manual instructions if we couldn't fix it automatically
          spinner.warn('Could not automatically configure WordPress URLs');
          this.showManualConfigInstructions(spinner);
        }
      }
      
      // Call the onUrlFound callback with the URL and backup status
      onUrlFound(url, backupCreated);
      
      // Complete the process
      onComplete();
    } catch (error) {
      spinner.fail(`Error processing ngrok URL: ${error instanceof Error ? error.message : String(error)}`);
      onComplete();
    }
  }

  /**
   * Display success message after tunnel is created
   */
  private displaySuccessMessage(url: string, port: number, spinner: ReturnType<typeof ora>, showManualInstructions = false): void {
    spinner.succeed(`WordPress site is now publicly available at: ${this.makeClickable(url)}`);
    console.log('\n🌎 Public URL information:');
    console.log(`${chalk.blue('WordPress Site:')} ${this.makeClickable(url)}`);
    console.log(`${chalk.blue('Local URL:')} http://localhost:${port}`);
    console.log('\n⚠️  Press Ctrl+C to stop sharing and close the tunnel');
    
    if (showManualInstructions) {
      console.log('\n⚠️  NOTE: WordPress might redirect to an incorrect URL.');
      console.log('   To manually fix the redirect issues, add this to your wp-config.php:');
      console.log(chalk.blue(`   define('WP_HOME', '${url}');`));
      console.log(chalk.blue(`   define('WP_SITEURL', '${url}');`));
    }
  }

  /**
   * Set up interval to check ngrok API for URL
   */
  private setupUrlCheckInterval(
    flags: ShareFlags,
    spinner: ReturnType<typeof ora>,
    port: number,
    wordpressContainer: string,
    foundUrlGetter: () => boolean,
    onUrlFound: (url: string, backupCreated: boolean) => void,
    onComplete: () => void
  ): NodeJS.Timeout {
    return setInterval(async () => {
      if (foundUrlGetter()) return; // Skip if URL already found

      let tunnelUrl: string | null = null;
      try {
        const { stdout } = await execa('curl', ['-s', 'http://localhost:4040/api/tunnels']);
        const tunnels = JSON.parse(stdout);
        if (tunnels?.tunnels?.length > 0) {
          // Find the first https tunnel URL
          interface NgrokTunnel {
            public_url?: string;
            // Other properties could be added as needed
          }
          const foundTunnel = tunnels.tunnels.find((tunnel: NgrokTunnel) => 
            tunnel.public_url && tunnel.public_url.startsWith('https://')
          );
          if (foundTunnel) {
            tunnelUrl = foundTunnel.public_url;
          }
        }
      } catch {
        // API might not be ready yet, continue trying
        if (flags.debug) {
          console.log('Waiting for ngrok API to be ready...');
        }
      }

      if (tunnelUrl && !foundUrlGetter()) {
        // Set foundUrl to true and clear interval via onUrlFound
        onUrlFound(tunnelUrl, false);
        // this.processNgrokUrl(tunnelUrl, flags, spinner, port, wordpressContainer, onUrlFound, onComplete);
      }
    }, 1000);
  }

  /**
   * Handle ngrok errors
   */
  private async handleNgrokError(error: unknown, spinner: ReturnType<typeof ora>): Promise<void> {
    spinner.fail('Failed to start ngrok tunnel');
    
    if (error instanceof Error) {
      if (error.message.includes('non-zero exit code')) {
        // This is expected when the user terminates with Ctrl+C
        if (error.message.includes('Your ngrok-agent version') && error.message.includes('is too old')) {
          console.log(chalk.yellow('\nYour ngrok version is outdated. Attempting to update...'));
          try {
            await this.updateNgrok(spinner);
            console.log(chalk.green('ngrok has been updated. Please run the share command again.'));
            return;
          } catch {
            console.log(chalk.red('Failed to update ngrok automatically.'));
            console.log(chalk.yellow('Please update manually with:'));
            console.log(chalk.blue('npm install -g ngrok@latest'));
            return;
          }
        }
        
        // Check if error contains address in use (port already in use)
        if (error.message.includes('address already in use') || error.message.includes('unable to bind to address')) {
          console.log(chalk.yellow('\nThe port is already in use by another application.'));
          console.log('\nYou can try:');
          console.log('1. Use a different port with --port flag');
          console.log('2. Stop the process using this port');
          console.log('\nTo stop ngrok processes, you can run:');
          console.log(chalk.blue('  wp-spin unshare'));
          return;
        }
        
        console.log(chalk.blue('\nTunnel has been closed.'));
        return;
      }
      
      if (error.message.includes('ENOENT') && error.message.includes('ngrok')) {
        console.log(chalk.yellow('\nngrok command not found. You may need to install it globally:'));
        console.log(chalk.blue('npm install -g ngrok'));
        return;
      }
      
      this.error(`Failed to start ngrok tunnel: ${error.message}`);
    }
    
    this.error(`Failed to start ngrok tunnel: ${String(error)}`);
  }

  /**
   * Ensure ngrok is installed, or install it if needed
   */
  private async ensureNgrokInstalled(spinner: ReturnType<typeof ora>): Promise<void> {
    spinner.start('Checking for ngrok...');
    
    try {
      // Try to run ngrok version command to see if it's installed
      await execa('npx', ['ngrok', '--version']);
      spinner.succeed('ngrok is already installed');
    } catch {
      spinner.info('ngrok is not installed. Installing it now...');
      
      try {
        // Install ngrok
        const installProcess = execa('npm', ['install', '--no-save', 'ngrok'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        
        // Forward stdout and stderr to spinner text
        installProcess.stdout?.on('data', (data: Buffer) => {
          spinner.text = `Installing ngrok: ${data.toString().trim()}`;
        });
        
        await installProcess;
        spinner.succeed('ngrok has been installed');
      } catch (error) {
        spinner.fail('Failed to install ngrok');
        this.error(`Failed to install ngrok: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Update WordPress wp-config.php to define WP_HOME and WP_SITEURL constants
   */
  private async fixWordPressConfig(
    containerName: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>
  ): Promise<boolean> {
    spinner.start('Updating WordPress config for ngrok compatibility...');
    
    try {
      const DEBUG = process.env.DEBUG === 'true';
      
      if (DEBUG) console.log('Starting fixWordPressConfig method...');
      
      // Find the wp-config.php file using the correct project path
      const wpConfigPath = await this.findWpConfigPath(containerName, DEBUG);
      
      if (!wpConfigPath) {
        this.showManualConfigInstructions(spinner);
        return false;
      }
      
      // Create a backup of wp-config.php
      if (DEBUG) console.log(`Creating backup of wp-config.php at: ${wpConfigPath}.bak`);
      fs.copyFileSync(wpConfigPath, `${wpConfigPath}.bak`);
      
      // Extract the port number from the ngrok URL or container port
      const localPort = await this.getWordPressPort(8080);
      if (DEBUG) console.log(`Using local port: ${localPort}`);
      
      // Read the current config file
      if (DEBUG) console.log(`Reading wp-config.php content from: ${wpConfigPath}`);
      let configContent = fs.readFileSync(wpConfigPath, 'utf8');
      
      // Create the WordPress configuration addition
      const wpConfigAddition = this.createConfigAddition(localPort);
      
      // Update the config file content
      configContent = this.updateConfigContent(configContent, wpConfigAddition, DEBUG);
      
      // Write the updated config back to the file
      if (DEBUG) console.log(`Writing updated content to: ${wpConfigPath}`);
      fs.writeFileSync(wpConfigPath, configContent);
      
      spinner.succeed('WordPress config updated with dynamic URL detection');
      
      console.log(chalk.yellow(`\nUpdated wp-config.php at: ${wpConfigPath}`));
      
      // Show a message about what we did
      console.log(chalk.blue('\nℹ️  Added smart configuration to WordPress that will:'));
      console.log(`  - Use ${chalk.green('https://<ngrok-subdomain>')} when accessed through ngrok`);
      console.log(`  - Use ${chalk.green(`http://localhost:${localPort}`)} when accessed locally`);
      
      return true;
    } catch (error) {
      spinner.fail('Failed to update WordPress wp-config.php');
      console.error(`Error in fixWordPressConfig: ${error}`);
      throw error;
    }
  }

  /**
   * Find the wp-config.php file path
   */
  private async findWpConfigPath(containerName: string, DEBUG = false): Promise<string | null> {
    // Get project path from the docker service instance
    const projectPath = this.docker?.getProjectPath();
    if (DEBUG) console.log(`findWpConfigPath - projectPath: ${projectPath}`);

    if (!projectPath) {
        if (DEBUG) console.log('Project path not found via DockerService.');
        // Potentially add other fallback strategies here if needed when --force is used?
        // For now, return null if we don't have a project path from the service.
        return null;
    }

    // Strategy 1: Check within the resolved project path
    const configPath = path.join(projectPath, 'wordpress', 'wp-config.php');
    if (DEBUG) console.log(`Checking for wp-config.php at: ${configPath}`);
    if (fs.existsSync(configPath)) {
      if (DEBUG) console.log('Found wp-config.php using Strategy 1 (Project Path).');
      return configPath;
    }

    // Remove Strategy 2 (docker inspect) as it's complex and less reliable than using projectPath
    // Remove Strategy 3 (hardcoded paths)

    if (DEBUG) console.log('wp-config.php not found in project path.');
    return null;
  }

  /**
   * Show instructions for manual configuration
   */
  private showManualConfigInstructions(spinner: ReturnType<typeof ora>): void {
    spinner.fail('Could not find wp-config.php file');
    console.log(chalk.yellow('\nTip: You can manually add the configuration to your wp-config.php file:'));
    console.log(chalk.blue(`
// In wp-config.php
if (isset($_SERVER['HTTP_HOST'])) {
    $current_host = $_SERVER['HTTP_HOST'];
    if (strpos($current_host, 'ngrok') !== false) {
        define('WP_HOME', 'https://' . $current_host);
        define('WP_SITEURL', 'https://' . $current_host);
    } else {
        define('WP_HOME', 'http://localhost:8083');
        define('WP_SITEURL', 'http://localhost:8083');
    }
}
`));
  }

  /**
   * Create the WordPress configuration addition
   */
  private createConfigAddition(localPort: number): string {
    return `
// Begin ngrok-specific URL configuration
// This dynamically detects if we're using ngrok or localhost
if (isset($_SERVER['HTTP_HOST'])) {
    $current_host = $_SERVER['HTTP_HOST'];
    if (strpos($current_host, 'ngrok') !== false) {
        define('WP_HOME', 'https://' . $current_host);
        define('WP_SITEURL', 'https://' . $current_host);
    } else {
        define('WP_HOME', 'http://localhost:${localPort}');
        define('WP_SITEURL', 'http://localhost:${localPort}');
    }
}
// End ngrok-specific URL configuration`;
  }

  /**
   * Update the WordPress configuration content
   */
  private updateConfigContent(configContent: string, wpConfigAddition: string, DEBUG = false): string {
    // Check if our configuration block already exists
    if (configContent.includes("// Begin ngrok-specific URL configuration")) {
      if (DEBUG) console.log(`Found existing ngrok configuration, replacing it...`);
      // Replace existing configuration - without capturing trailing newline
      const pattern = /\/\/ Begin ngrok-specific URL configuration[\s\S]*?\/\/ End ngrok-specific URL configuration/;
      return configContent.replace(pattern, wpConfigAddition.trim());
    } 
    
    if (DEBUG) console.log(`No existing ngrok configuration found, checking for WP_HOME/WP_SITEURL constants...`);
    
    // Check if WP_HOME and WP_SITEURL are already defined with a simple regex
    const homePattern = /define\s*\(\s*['"]WP_HOME['"]\s*,\s*[^)]+\)\s*;/;
    const siteurlPattern = /define\s*\(\s*['"]WP_SITEURL['"]\s*,\s*[^)]+\)\s*;/;
    
    // Remove existing constants if they exist
    if (homePattern.test(configContent)) {
      if (DEBUG) console.log(`Found and removing existing WP_HOME constant`);
      configContent = configContent.replace(homePattern, '');
    }
    
    if (siteurlPattern.test(configContent)) {
      if (DEBUG) console.log(`Found and removing existing WP_SITEURL constant`);
      configContent = configContent.replace(siteurlPattern, '');
    }
    
    return this.insertConfigurationBlock(configContent, wpConfigAddition, DEBUG);
  }

  /**
   * Insert configuration block into wp-config.php
   */
  private insertConfigurationBlock(configContent: string, wpConfigAddition: string, DEBUG = false): string {
    // Ensure the addition has exactly one leading and trailing newline
    const cleanAddition = `\n${wpConfigAddition.trim()}\n`;
    
    // Add our conditional constants before the WordPress settings section
    const insertionPoint = "/* That's all, stop editing! Happy publishing. */";
    
    if (DEBUG) {
      console.log(`Looking for insertion point: "${insertionPoint}"`);
      console.log(`Insertion point found: ${configContent.includes(insertionPoint)}`);
    }
    
    // If the standard insertion point exists, use it
    if (configContent.includes(insertionPoint)) {
      return configContent.replace(insertionPoint, `${cleanAddition}${insertionPoint}`);
    }
    
    // Otherwise try alternative insertion points
    if (DEBUG) console.log(`Insertion point not found, looking for alternatives...`);
    
    const alternativePoints = [
      "/* That's all, stop editing!",
      "/* That is all, stop editing!",
      "/* Stop editing */",
      "?>"
    ];
    
    for (const point of alternativePoints) {
      if (configContent.includes(point)) {
        if (DEBUG) console.log(`Found alternative insertion point: "${point}"`);
        return configContent.replace(point, `${cleanAddition}${point}`);
      }
    }
    
    // Last resort: append to the end of the file
    if (DEBUG) console.log(`No insertion point found, appending to the end of the file`);
    return configContent.replace(/\s*$/, '') + cleanAddition;
  }

  /**
   * Update WordPress options in database (fallback method)
   */
  private async fixWordPressOptions(
    containerName: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    spinner.start('Updating WordPress database options for ngrok compatibility...');
    
    try {
      // Get the correct container name from BaseCommand
      // const actualContainerName = this.getContainerNames().wordpress;
      // NOTE: The containerName passed in should already be the correct one from validateProjectContext

      // Create a wp-cli script to update options
      const script = `
#!/bin/bash
cd /var/www/html
wp option update home '${ngrokUrl}' --allow-root
wp option update siteurl '${ngrokUrl}' --allow-root
`;
      
      // Write script to container
      await execa('docker', [
        'exec',
        containerName,
        'bash',
        '-c',
        `echo "${script}" > /tmp/update-wp-options.sh && chmod +x /tmp/update-wp-options.sh`
      ]);
      
      // Run the script
      await execa('docker', [
        'exec',
        containerName,
        '/tmp/update-wp-options.sh'
      ]);
      
      spinner.succeed('WordPress database options updated for ngrok compatibility');
    } catch (error) {
      spinner.fail('Failed to update WordPress database options');
      throw error;
    }
  }

  /**
   * Fix WordPress URL to work with ngrok
   */
  private async fixWordPressUrl(
    containerName: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>
  ): Promise<boolean> {
    try {
      // Always attempt to update database options first
      try {
        await this.fixWordPressOptions(containerName, ngrokUrl, spinner);
      } catch {
        spinner.warn('Could not update WordPress database options');
        // Continue with config file if database failed
      }
      
      // Then update the config as well (if method is config or if database update failed)
      return this.fixWordPressConfig(containerName, ngrokUrl, spinner);
    } catch (error) {
      spinner.fail('Failed to update WordPress URL configuration');
      throw error;
    }
  }

  /**
   * Get the actual WordPress port from Docker
   */
  private async getWordPressPort(defaultPort: number): Promise<number> {
    console.log(`DEBUG: getWordPressPort called with defaultPort: ${defaultPort}`);
    
    const projectPath = this.docker?.getProjectPath();
    console.log(`DEBUG: projectPath: ${projectPath}`);
    
    if (!projectPath) {
      console.log(`DEBUG: No project path, returning default: ${defaultPort}`);
      return defaultPort;
    }

    const port = await this.tryDockerPortMethods(projectPath) || defaultPort;
    console.log(`DEBUG: Final port determined: ${port}`);
    return port;
  }

  /**
   * Try multiple Docker methods to get the WordPress port
   */
  private async tryDockerPortMethods(projectPath: string): Promise<number | null> {
    // Method 1: Docker Compose
    const composePort = await this.tryDockerComposeMethod(projectPath);
    if (composePort) return composePort;

    // Method 2: Docker Port
    const dockerPort = await this.tryDockerPortMethod(projectPath);
    if (dockerPort) return dockerPort;

    // Method 3: Docker Inspect
    const inspectPort = await this.tryDockerInspectMethod(projectPath);
    if (inspectPort) return inspectPort;

    return null;
  }

  /**
   * Try to get port using docker compose ps
   */
  private async tryDockerComposeMethod(projectPath: string): Promise<number | null> {
    try {
      const { stdout } = await execa('docker', ['compose', '-f', `${projectPath}/docker-compose.yml`, 'ps', '--format', 'table'], {
        cwd: projectPath
      });
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('wordpress') && line.includes('->80/tcp')) {
          if (this.flags.debug) {
            console.log(`Found WordPress line: ${line}`);
          }

          const match = line.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
          if (!match || !match[1]) continue;
          
          if (this.flags.debug) {
            console.log(`Extracted port from docker compose: ${match[1]}`);
          }

          return Number.parseInt(match[1], 10);
        }
      }
    } catch (error) {
      if (this.flags.debug) {
        console.log(`Method 1 failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return null;
  }

  /**
   * Try to get port using docker port command
   */
  private async tryDockerPortMethod(projectPath: string): Promise<number | null> {
    try {
      const containerName = `${path.basename(projectPath)}-wordpress-1`;
      if (this.flags.debug) {
        console.log(`Trying container name: ${containerName}`);
        console.log(`Project path: ${projectPath}`);
      }

      const { stdout } = await execa('docker', ['port', containerName, '80']);
      
      if (this.flags.debug) {
        console.log(`Docker port output: ${stdout}`);
      }

      const match = stdout.match(/0\.0\.0\.0:(\d+)/);
      if (match && match[1]) {
        if (this.flags.debug) {
          console.log(`Extracted port from docker port: ${match[1]}`);
        }

        return Number.parseInt(match[1], 10);
      }
    } catch (error) {
      if (this.flags.debug) {
        console.log(`Method 2 failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return null;
  }

  /**
   * Try to get port using docker inspect
   */
  private async tryDockerInspectMethod(projectPath: string): Promise<number | null> {
    try {
      const containerName = `${path.basename(projectPath)}-wordpress-1`;
      const { stdout } = await execa('docker', ['inspect', containerName, '--format', '{{json .NetworkSettings.Ports}}']);
      
      const ports = JSON.parse(stdout);
      const port80 = ports['80/tcp'];
      if (port80 && port80[0] && port80[0].HostPort) {
        return Number.parseInt(port80[0].HostPort, 10);
      }
    } catch (error) {
      if (this.flags.debug) {
        console.log(`Method 3 failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return null;
  }

  /**
   * Restore the WordPress wp-config.php from backup
   */
  private async restoreWordPressConfig(
    containerName: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    const DEBUG = process.env.DEBUG === 'true';
    if (DEBUG) console.log(`restoreWordPressConfig called for container: ${containerName}`);

    const projectPath = this.docker?.getProjectPath();
    if (!projectPath) {
        spinner.fail('Cannot restore config: Project path not determined.');
        return; 
    }

    if (DEBUG) console.log(`restoreWordPressConfig - projectPath: ${projectPath}`);

    const wpConfigPath = path.join(projectPath, 'wordpress', 'wp-config.php');
    const wpConfigBackupPath = `${wpConfigPath}.bak`;
    if (DEBUG) console.log(`Looking for backup: ${wpConfigBackupPath}`);

    // Check if we found the backup
    if (fs.existsSync(wpConfigBackupPath)) {
        // Restore from backup
        fs.copyFileSync(wpConfigBackupPath, wpConfigPath);
        fs.unlinkSync(wpConfigBackupPath);
        spinner.succeed(`WordPress configuration restored from backup at ${wpConfigPath}`);
    } else {
        // If no backup, try removing the ngrok block from the existing file
        if (DEBUG) console.log(`Backup not found. Trying to remove block from: ${wpConfigPath}`);
        if (fs.existsSync(wpConfigPath)) {
            let configContent = fs.readFileSync(wpConfigPath, 'utf8');
            
            // Remove the ngrok-specific configuration, without trailing newline
            const pattern = /\/\/ Begin ngrok-specific URL configuration[\s\S]*?\/\/ End ngrok-specific URL configuration\n?/;
            const originalLength = configContent.length;
            configContent = configContent.replace(pattern, '');
            
            if (configContent.length < originalLength) { // Check if replacement happened
                // Remove any double blank lines created by removal
                configContent = configContent.replaceAll(/\n\n\n+/g, '\n\n');
                
                // Write the updated config back to the file
                fs.writeFileSync(wpConfigPath, configContent);
                spinner.succeed(`WordPress configuration restored by removing ngrok block at ${wpConfigPath}`);
            } else {
                 if (DEBUG) console.log('Ngrok block not found in wp-config.php, no changes made.');
                 spinner.warn('Could not find ngrok block in wp-config.php to remove.');
            }
        } else {
            spinner.warn('Could not find wp-config.php or backup to restore.');
        }
    }
  }

  /**
   * Update ngrok to the latest version
   */
  private async updateNgrok(spinner: ReturnType<typeof ora>): Promise<void> {
    spinner.start('Updating ngrok to the latest version...');
    
    try {
      // Uninstall the old version first
      await execa('npm', ['uninstall', '-g', 'ngrok']);
      
      // Install the latest version
      await execa('npm', ['install', '-g', 'ngrok@latest']);
      
      // Verify installation
      await execa('ngrok', ['--version']);
      
      spinner.succeed('ngrok has been updated to the latest version');
    } catch (error) {
      spinner.fail('Failed to update ngrok');
      throw error;
    }
  }

  private getLocalUrl(url: string): string {
    // Replace ngrok URLs with localhost
    return url.replaceAll(/(https?:\/\/.*?ngrok-free\.app|https?:\/\/.*?ngrok\.io)/g, `http://localhost:${this.flags.port}`);
  }

  private getNgrokUrl(url: string): string {
    // Replace localhost URLs with ngrok URL
    return url.replaceAll(/(https?:\/\/localhost:[0-9]+)/g, this.currentNgrokUrl);
  }
} 