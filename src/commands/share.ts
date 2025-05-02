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
import inquirer from 'inquirer';

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
  debug: boolean;
  fixurl: boolean;
  force: boolean;
  method: string;
  port: number;
  region?: string;
  subdomain?: string;
}

export default class Share extends BaseCommand {
  static description = 'Share your WordPress site publicly using ngrok';
  static examples = [
    '$ wp-spin share',
    '$ wp-spin share --subdomain=mysite',
    '$ wp-spin share --region=eu',
  ];
  static flags = {
    auth: Flags.string({
      char: 'a',
      description: 'ngrok auth token (or use NGROK_AUTH_TOKEN env variable)',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Enable debug mode to see detailed ngrok output',
    }),
    fixurl: Flags.boolean({
      char: 'u',
      default: true,
      description: 'Fix WordPress site URL to work with ngrok',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force sharing even if not in a wp-spin project directory',
    }),
    method: Flags.string({
      char: 'm',
      default: 'config',
      description: 'Method to fix WordPress URLs: config (wp-config.php) or options (database)',
      options: ['config', 'options'],
    }),
    port: Flags.integer({
      char: 'p',
      default: 8080,
      description: 'Port to expose (defaults to WordPress port from Docker)',
    }),
    region: Flags.string({
      char: 'r',
      default: 'us',
      description: 'Region for the ngrok tunnel',
      options: ['us', 'eu', 'ap', 'au', 'sa', 'jp', 'in'],
    }),
    subdomain: Flags.string({
      char: 's',
      description: 'Custom subdomain for your ngrok tunnel (requires ngrok account)',
    }),
  };
  static hidden = false;
  
  private currentNgrokUrl: string = '';
  private flags: ShareFlags = {
    debug: false,
    fixurl: true,
    force: false,
    method: 'config',
    port: 8080,
  };
  
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
      const port = flags.force ? flags.port : await this.getWordPressPort(flags.port);
      
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
  private async validateProjectContext(flags: ShareFlags, spinner: ReturnType<typeof ora>): Promise<string | undefined> {
    // Find the project root directory (unless forced)
    if (!flags.force) {
      const projectRoot = this.findProjectRoot();
      
      if (!projectRoot) {
        this.error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or use --force flag.');
      }
    }
    
    // Check if Docker is running
    await this.checkDockerEnvironment();
    
    // Check if WordPress container is running (unless forced)
    if (!flags.force) {
      try {
        spinner.start('Checking WordPress environment...');
        const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}} {{.Ports}}']);
        
        if (!stdout.includes('wordpress')) {
          spinner.fail('WordPress container is not running');
          this.error('WordPress container is not running. Please start your Docker environment first with `wp-spin start`.');
        }
        
        spinner.succeed('WordPress environment is running');
        
        // Find WordPress container name
        try {
          const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}}']);
          const containerNames = stdout.split('\n');
          const found = containerNames.find(name => name.includes('wordpress'));
          if (found) {
            return found;
          }
        } catch {
          // Continue even if we can't find the container
        }
      } catch (error) {
        spinner.fail('Failed to check Docker containers');
        this.error(`Failed to check Docker containers: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return undefined;
  }

  /**
   * Starts the ngrok tunnel and handles URL detection
   */
  private async startNgrokTunnel(port: number, flags: ShareFlags, spinner: ReturnType<typeof ora>): Promise<void> {
    // Check if ngrok is already running
    const ngrokRunning = await this.checkNgrokRunning();
    if (ngrokRunning) {
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
      
      // Ask if they want to try stopping the existing process
      try {
        const responses = await inquirer.prompt([
          {
            default: true,
            message: 'Would you like to attempt to stop the running ngrok process?',
            name: 'shouldStop',
            type: 'confirm',
          },
        ]);
        
        if (responses.shouldStop) {
          const stopped = await this.killRunningNgrok(spinner);
          if (!stopped) {
            this.error('Could not stop the running ngrok process. Please try stopping it manually.');
          }
        } else {
          this.error('Operation cancelled. Please stop the running ngrok process before starting a new one.');
        }
      } catch {
        this.error('Could not prompt for confirmation. Please stop the running ngrok process manually.');
      }
    }
    
    // Generate ngrok command arguments
    const ngrokArgs = ['http'];
    
    // Add auth token if provided
    if (flags.auth) {
      process.env.NGROK_AUTHTOKEN = flags.auth;
    }
    
    // Add subdomain if provided
    if (flags.subdomain) {
      ngrokArgs.push('--subdomain', flags.subdomain);
    }
    
    // Add region
    if (flags.region) {
      ngrokArgs.push('--region', flags.region);
    }
    
    // Add port
    ngrokArgs.push(port.toString());
    
    // Start ngrok tunnel
    spinner.start(`Creating ngrok tunnel to http://localhost:${port}...`);
    
    try {
      // Use direct command instead of npx
      const ngrokCommand = flags.debug ? 'ngrok' : 'npx ngrok';
      const stdioOption = flags.debug ? 'inherit' : 'pipe';
      
      let urlCheckInterval: NodeJS.Timeout | undefined;
      let foundUrl = false;
      let wordpressContainer = '';
      let originalConfigBackup = false;
      
      // Find WordPress container name if not forced
      if (!flags.force) {
        wordpressContainer = await this.findWordPressContainer() || '';
      }
      
      // Run ngrok as a child process
      const ngrokProcess = execa(ngrokCommand, ngrokArgs, {
        env: {
          ...process.env,
          FORCE_COLOR: '1',
        },
        shell: true,
        stdio: stdioOption,
      });
      
      if (!flags.debug) {
        // Handle ngrok output and URL detection
        await this.handleNgrokOutput(ngrokProcess, flags, spinner, port, wordpressContainer, 
          (url, backup) => {
            foundUrl = true;
            originalConfigBackup = backup;
          }, 
          () => {
            if (urlCheckInterval) {
              clearInterval(urlCheckInterval);
              urlCheckInterval = undefined;
            }
          });
        
        // Set up a backup method to get the URL if not found in stdout
        urlCheckInterval = this.setupUrlCheckInterval(
          flags, spinner, port, wordpressContainer, foundUrl,
          (url, backup) => {
            foundUrl = true;
            originalConfigBackup = backup;
          },
          () => {
            if (urlCheckInterval) {
              clearInterval(urlCheckInterval);
              urlCheckInterval = undefined;
            }
          }
        );
        
        // After 15 seconds, if URL still not found but ngrok is running, show a fallback message
        setTimeout(() => {
          if (!foundUrl && urlCheckInterval) {
            clearInterval(urlCheckInterval);
            urlCheckInterval = undefined;
            spinner.succeed('ngrok tunnel appears to be running');
            console.log('\n🌎 Your site should be available through ngrok.');
            console.log(chalk.blue('To find the URL, visit: http://localhost:4040'));
            console.log('\n⚠️  Press Ctrl+C to stop sharing and close the tunnel');
          }
        }, 15_000);
      }
      
      // Wait for ngrok to exit
      await ngrokProcess;
      
      // Clean up the interval if it still exists
      if (urlCheckInterval) {
        clearInterval(urlCheckInterval);
      }
      
      // Restore WordPress configuration if it was changed
      if (flags.fixurl && wordpressContainer && originalConfigBackup) {
        try {
          spinner.start('Restoring WordPress configuration...');
          await this.restoreWordPressConfig(wordpressContainer, spinner);
          spinner.succeed('WordPress configuration has been restored');
        } catch {
          spinner.warn('Failed to restore WordPress configuration');
          console.log(chalk.yellow('You may need to manually restore your wp-config.php file.'));
        }
      }
    } catch (error) {
      await this.handleNgrokError(error, spinner);
    }
  }

  /**
   * Handle ngrok process output to detect URLs
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
    // Listen for ngrok output
    ngrokProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      
      if (flags.debug) {
        console.log(`ngrok output: ${output}`);
      }
      
      // Look for different URL patterns in ngrok output
      const urlPatterns = [
        /url=https:\/\/([^\s]+)/,
        /Forwarding\s+https:\/\/([^\s]+)\s+->/,
        /Web Interface\s+http:\/\/([^\s]+)/
      ];
      
      for (const pattern of urlPatterns) {
        const match = output.match(pattern);
        if (match && match[1]) {
          const url = `https://${match[1]}`;
          
          // Fix WordPress URLs if requested
          if (flags.fixurl && wordpressContainer) {
            this.fixWordPressUrl(wordpressContainer, url, spinner, flags.method)
              .then((backupCreated) => {
                onUrlFound(url, backupCreated);
                this.displaySuccessMessage(url, port, spinner);
                onComplete();
              })
              .catch(() => {
                onUrlFound(url, false);
                this.displaySuccessMessage(url, port, spinner, true);
                onComplete();
              });
          } else {
            onUrlFound(url, false);
            this.displaySuccessMessage(url, port, spinner);
            
            if (!flags.fixurl && wordpressContainer) {
              console.log('\n⚠️  NOTE: WordPress URLs have not been updated to work with ngrok.');
              console.log('   If links don\'t work, try:');
              console.log(chalk.blue('   wp-spin share --fixurl'));
            }
            
            onComplete();
          }
          
          break;
        }
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
   * Display success message after tunnel is created
   */
  private displaySuccessMessage(url: string, port: number, spinner: ReturnType<typeof ora>, showManualInstructions = false): void {
    spinner.succeed(`WordPress site is now publicly available at: ${chalk.green(url)}`);
    console.log('\n🌎 Public URL information:');
    console.log(`${chalk.blue('WordPress Site:')} ${chalk.green(url)}`);
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
    foundUrl: boolean,
    onUrlFound: (url: string, backupCreated: boolean) => void,
    onComplete: () => void
  ): NodeJS.Timeout {
    return setInterval(async () => {
      if (!foundUrl) {
        try {
          const { stdout } = await execa('curl', ['-s', 'http://localhost:4040/api/tunnels']);
          const tunnels = JSON.parse(stdout);
          if (tunnels?.tunnels?.length > 0) {
            for (const tunnel of tunnels.tunnels) {
              if (tunnel.public_url && tunnel.public_url.startsWith('https://')) {
                const url = tunnel.public_url;
                
                // Fix WordPress URLs if requested
                if (flags.fixurl && wordpressContainer) {
                  this.fixWordPressUrl(wordpressContainer, url, spinner, flags.method)
                    .then((backupCreated) => {
                      onUrlFound(url, backupCreated);
                      this.displaySuccessMessage(url, port, spinner);
                      onComplete();
                    })
                    .catch(() => {
                      onUrlFound(url, false);
                      this.displaySuccessMessage(url, port, spinner, true);
                      onComplete();
                    });
                } else {
                  onUrlFound(url, false);
                  this.displaySuccessMessage(url, port, spinner);
                  
                  if (!flags.fixurl && wordpressContainer) {
                    console.log('\n⚠️  NOTE: WordPress URLs have not been updated to work with ngrok.');
                    console.log('   If links don\'t work, try:');
                    console.log(chalk.blue('   wp-spin share --fixurl'));
                  }
                  
                  onComplete();
                }
                
                break;
              }
            }
          }
        } catch {
          // API might not be ready yet, continue trying
          if (flags.debug) {
            console.log('Waiting for ngrok API to be ready...');
          }
        }
      }
    }, 1000);
  }

  /**
   * Find the WordPress container name
   */
  private async findWordPressContainer(): Promise<string | undefined> {
    try {
      const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}}']);
      const containerNames = stdout.split('\n');
      return containerNames.find(name => name.includes('wordpress'));
    } catch {
      return undefined;
    }
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
    container: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>
  ): Promise<boolean> {
    spinner.start('Updating WordPress config for ngrok compatibility...');
    
    try {
      const DEBUG = process.env.DEBUG === 'true';
      
      if (DEBUG) console.log('Starting fixWordPressConfig method...');
      
      // Find the wp-config.php file
      console.log('finding wp-config.php file');
      const wpConfigPath = await this.findWpConfigPath(container, DEBUG);
      
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
  private async findWpConfigPath(container: string, DEBUG = false): Promise<string | null> {
    let wpConfigPath = '';
    
    // Strategy 1: Project root
    const projectRoot = this.findProjectRoot();
    if (DEBUG) console.log(`Project root: ${projectRoot || 'not found'}`);
    
    if (projectRoot) {
      const configPath = `${projectRoot}/wordpress/wp-config.php`;
      if (DEBUG) console.log(`Checking for wp-config.php at: ${configPath}`);
      if (fs.existsSync(configPath)) {
        wpConfigPath = configPath;
        if (DEBUG) console.log(`Found wp-config.php using Strategy 1!`);
      }
    }
    
    // Strategy 2: Docker volume path (only works with local volumes)
    if (!wpConfigPath) {
      if (DEBUG) console.log('Trying Strategy 2: Docker volume path...');
      try {
        const { stdout: inspectOutput } = await execa('docker', [
          'inspect',
          '--format',
          '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}',
          container
        ]);
        
        if (DEBUG) console.log(`Docker volume path: ${inspectOutput.trim() || 'not found'}`);
        
        if (inspectOutput && inspectOutput.trim()) {
          const volPath = `${inspectOutput.trim()}/wp-config.php`;
          if (DEBUG) console.log(`Checking for wp-config.php at: ${volPath}`);
          if (fs.existsSync(volPath)) {
            wpConfigPath = volPath;
            if (DEBUG) console.log(`Found wp-config.php using Strategy 2!`);
          }
        }
      } catch (error) {
        // Continue with other strategies
        if (DEBUG) console.log(`Strategy 2 failed: ${error}`);
      }
    }
    
    // Strategy 3: Look for specific paths if forced (your specific setup)
    if (!wpConfigPath) {
      if (DEBUG) console.log('Trying Strategy 3: Specific paths...');
      const possiblePaths = [
        '/Users/danielkapin/Projects/test-site/test-site/wordpress/wp-config.php'
      ];
      
      for (const path of possiblePaths) {
        if (DEBUG) console.log(`Checking for wp-config.php at: ${path}`);
        if (fs.existsSync(path)) {
          wpConfigPath = path;
          if (DEBUG) console.log(`Found wp-config.php using Strategy 3!`);
          break;
        }
      }
    }
    
    return wpConfigPath || null;
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
    container: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    spinner.start('Updating WordPress database options for ngrok compatibility...');
    
    try {
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
        container,
        'bash',
        '-c',
        `echo "${script}" > /tmp/update-wp-options.sh && chmod +x /tmp/update-wp-options.sh`
      ]);
      
      // Run the script
      await execa('docker', [
        'exec',
        container,
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
    container: string,
    ngrokUrl: string,
    spinner: ReturnType<typeof ora>,
    method = 'config'
  ): Promise<boolean> {
    try {
      // Always attempt to update database options first
      try {
        await this.fixWordPressOptions(container, ngrokUrl, spinner);
      } catch {
        spinner.warn('Could not update WordPress database options');
        // Continue with config file if database failed
      }
      
      // Then update the config as well (if method is config or if database update failed)
      if (method === 'config') {
        console.log('fixing wordpress config');
        return this.fixWordPressConfig(container, ngrokUrl, spinner);
      }
      
      return false;
    } catch (error) {
      spinner.fail('Failed to update WordPress URL configuration');
      throw error;
    }
  }

  /**
   * Get the actual WordPress port from Docker
   */
  private async getWordPressPort(defaultPort: number): Promise<number> {
    try {
      // Try to determine the actual port mapping from Docker
      const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}} {{.Ports}}']);
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        if (line.includes('wordpress')) {
          // Example: "my-project_wordpress 0.0.0.0:32769->80/tcp"
          const match = line.match(/:(\d+)->80\/tcp/);
          if (match && match[1]) {
            return Number.parseInt(match[1], 10);
          }
        }
      }
      
      // If we can't determine the port, use the default
      return defaultPort;
    } catch {
      // In case of error, fall back to the default port
      return defaultPort;
    }
  }

  /**
   * Restore the WordPress wp-config.php from backup
   */
  private async restoreWordPressConfig(
    container: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    try {
      // Try to find the WordPress config file and backup using several strategies
      let wpConfigPath = '';
      let wpConfigBackupPath = '';
      
      // Strategy 1: Project root
      const projectRoot = this.findProjectRoot();
      if (projectRoot) {
        const configPath = `${projectRoot}/wordpress/wp-config.php`;
        if (fs.existsSync(`${configPath}.bak`)) {
          wpConfigPath = configPath;
          wpConfigBackupPath = `${configPath}.bak`;
        }
      }
      
      // Strategy 2: Docker volume path (only works with local volumes)
      if (!wpConfigPath) {
        try {
          const { stdout: inspectOutput } = await execa('docker', [
            'inspect',
            '--format',
            '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}',
            container
          ]);
          
          if (inspectOutput && inspectOutput.trim()) {
            const volPath = `${inspectOutput.trim()}/wp-config.php`;
            if (fs.existsSync(`${volPath}.bak`)) {
              wpConfigPath = volPath;
              wpConfigBackupPath = `${volPath}.bak`;
            }
          }
        } catch {
          // Continue with other strategies
        }
      }
      
      // Strategy 3: Look for specific paths if forced (your specific setup)
      if (!wpConfigPath) {
        const possiblePaths = [
          '/Users/danielkapin/Projects/test-site/test-site/wordpress/wp-config.php'
        ];
        
        for (const path of possiblePaths) {
          if (fs.existsSync(`${path}.bak`)) {
            wpConfigPath = path;
            wpConfigBackupPath = `${path}.bak`;
            break;
          }
        }
      }
      
      // Check if we found the backup
      if (wpConfigBackupPath && fs.existsSync(wpConfigBackupPath)) {
        // Restore from backup
        fs.copyFileSync(wpConfigBackupPath, wpConfigPath);
        fs.unlinkSync(wpConfigBackupPath);
        spinner.succeed(`WordPress configuration restored from backup at ${wpConfigPath}`);
      } else {
        // Search for any wp-config.php to try to remove the ngrok configuration
        if (!wpConfigPath) {
          const possiblePaths = [
            '/Users/danielkapin/Projects/test-site/test-site/wordpress/wp-config.php'
          ];
          
          for (const path of possiblePaths) {
            if (fs.existsSync(path)) {
              wpConfigPath = path;
              break;
            }
          }
        }
        
        if (wpConfigPath && fs.existsSync(wpConfigPath)) {
          let configContent = fs.readFileSync(wpConfigPath, 'utf8');
          
          // Remove the ngrok-specific configuration, without trailing newline
          const pattern = /\/\/ Begin ngrok-specific URL configuration[\s\S]*?\/\/ End ngrok-specific URL configuration\n?/;
          configContent = configContent.replace(pattern, '');
          
          // Remove any double blank lines created by removal
          configContent = configContent.replaceAll(/\n\n\n+/g, '\n\n');
          
          // Write the updated config back to the file
          fs.writeFileSync(wpConfigPath, configContent);
          spinner.succeed(`WordPress configuration restored by removing ngrok block at ${wpConfigPath}`);
        } else {
          spinner.warn('Could not find wp-config.php or backup to restore');
        }
      }
    } catch (error) {
      spinner.fail('Failed to restore WordPress configuration');
      throw error;
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