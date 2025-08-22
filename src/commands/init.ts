/* eslint-disable max-lines */
import { Args, Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import { createPromptModule } from 'inquirer';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';
import ora from 'ora';

import { addSite } from '../config/sites.js';
import { DockerService } from '../services/docker.js';
import { PortManagerService } from '../services/port-manager.js';
import { BaseCommand, baseFlags } from './base.js';

// Define specific types to replace 'any'
type Spinner = ReturnType<typeof ora>;

export default class Init extends BaseCommand {
  static args = {
    name: Args.string({ description: 'Project name', required: false }),
  };
  static default = Init;
  static description = 'Initialize a new WordPress development environment';
  static examples = [
    '$ wp-spin init my-site',
    '$ wp-spin init my-site --site-name="My Site"',
    '$ wp-spin init my-site --wordpress-version=6.4',
    '$ wp-spin init my-site --domain=mysite',
    '$ wp-spin init my-site --domain=mysite.test',
    '$ wp-spin init my-site --mailhog',
    '$ wp-spin init network --multisite --multisite-type=subdomain --domain=net.test --mailhog',
  ];
  static flags = {
    ...baseFlags,
    domain: Flags.string({
      description: 'Custom domain to use for the WordPress site (e.g., mysite.test). If no TLD is provided, .test will be automatically appended.',
    }),
    mailhog: Flags.boolean({
      default: false,
      description: 'Install MailHog for local email testing (also installs WP Mail SMTP plugin)',
    }),
    multisite: Flags.boolean({
      default: false,
      description: 'Enable WordPress Multisite (Network) support',
    }),
    'multisite-type': Flags.string({
      description: 'Type of multisite network: subdomain or path (required if --multisite is used)',
      options: ['subdomain', 'path'],
    }),
    'site-name': Flags.string({
      description: 'Site name (defaults to project name)',
    }),
    ssl: Flags.boolean({
      default: false,
      description: 'Generate a local SSL certificate for your custom domain using mkcert (requires mkcert to be installed)',
    }),
    'wordpress-version': Flags.string({
      default: 'latest',
      description: 'WordPress version to install',
    }),
  };
  protected docker: DockerService;
  private mysqlInitScriptPath: string = '';
  private projectPath: string = '';
  private wordpressVersion: string = 'latest';

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }
  
  // Methods in alphabetical order to satisfy perfectionist/sort-classes
  
  protected async configureDomain(port: number): Promise<void> {
    const { flags } = await this.parse(Init);
    if (!flags.domain) return;

    try {
      console.log(chalk.yellow('\nSetting up local domain:'));
      console.log(chalk.yellow('Adding domain to your computer\'s hosts file so it points to your WordPress container'));
      console.log(chalk.yellow('\nYou will be prompted for your computer password to make this change.'));
      
      await this.nginxProxy.addDomain(flags.domain, port);

      console.log(chalk.green('\nDomain configuration complete!'));
      console.log(chalk.blue('Your WordPress site will be accessible at:'));
      console.log(chalk.cyan(`  http://${flags.domain}`));
    } catch (error) {
      throw new Error(`Failed to configure domain: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

    // Add a new method to handle domain configuration with SSL
    protected async configureDomainWithSSL(domain: string, port: number, ssl: boolean): Promise<void> {
      try {
        await this.nginxProxy.addDomain(domain, port, ssl);
        console.log(chalk.green(`\nDomain configuration complete!`));
        if (ssl) {
          console.log(chalk.blue('Your WordPress site will be accessible at:'));
          console.log(chalk.cyan(`  https://${domain}`));
        } else {
          console.log(chalk.blue('Your WordPress site will be accessible at:'));
          console.log(chalk.cyan(`  http://${domain}`));
        }
      } catch (error) {
        throw new Error(`Failed to configure domain: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

  /**
   * Ensures Docker is installed and running correctly
   */
  protected async ensureDockerEnvironment(): Promise<void> {
    try {
      // Check system platform and architecture
      await this.checkSystem();
      
      await this.docker.checkDockerInstalled();
      await this.docker.checkDockerRunning();
      await this.docker.checkDockerComposeInstalled();
      await this.docker.checkDiskSpace();
      await this.docker.checkMemory();
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }

      this.error('Failed to verify Docker environment');
    }
  }
  
  /**
   * Main run method for the command
   */
  async run(): Promise<void> {
    let { args, flags } = await this.parse(Init) as { args: Record<string, unknown>, flags: Record<string, unknown> };

    // Normalize domain if provided
    if (flags.domain && typeof flags.domain === 'string') {
      flags.domain = this.normalizeDomain(flags.domain);
    }

    await this.validateMultisiteFlags(flags);

    if (!this.hasAllRequiredFlags(flags)) {
      ({ args, flags } = await this.handleInteractiveMode(args, flags));
    }

    // Ensure args.name is present
    if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
      this.error('Project name is required.');
      return;
    }

    await this.setupProject(args as Record<string, unknown> & { name: string }, flags);
  }
  
  /**
   * Builds Docker images for the WordPress project
   */
  private async buildDockerImages(projectPath: string): Promise<void> {
    const spinner = ora('Building Docker images...').start();
    const architecture = arch();
    
    try {
      // Pull necessary images and build them with appropriate platform
      if (architecture === 'arm64') {
        // For M1/M2 Macs, we need to pull with platform specification for phpMyAdmin
        await execa('docker', ['pull', '--platform=linux/amd64', 'phpmyadmin/phpmyadmin'], {
          cwd: projectPath,
        });
        
        // Pull MariaDB which has better ARM compatibility
        await execa('docker', ['pull', 'mariadb:10.6'], {
          cwd: projectPath,
        });
        
        // Pull WordPress ARM image - use specified version if not latest
        const wordpressImageTag = this.wordpressVersion === 'latest' 
          ? 'latest' 
          : this.wordpressVersion;
        
        await execa('docker', ['pull', `arm64v8/wordpress:${wordpressImageTag}`], {
          cwd: projectPath,
        });
        
        spinner.succeed('Docker images pulled successfully for ARM64 architecture');
        
        // Log the process
        console.log(chalk.blue('ℹ️ For ARM architecture:'));
        console.log(chalk.blue('  - Pulled phpMyAdmin image with linux/amd64 platform specification'));
        console.log(chalk.blue('  - Pulled MariaDB 10.6 for better ARM compatibility'));
        console.log(chalk.blue(`  - Pulled ARM-specific WordPress ${wordpressImageTag} image`));
        console.log(chalk.blue('  - This ensures compatibility with your system'));
      } else {
        // For Intel/AMD architectures, just pull the images
        await execa('docker', ['pull', 'phpmyadmin/phpmyadmin'], {
          cwd: projectPath,
        });
        
        await execa('docker', ['pull', 'mysql:8.0'], {
          cwd: projectPath,
        });
        
        // Pull WordPress image with specified version
        const wordpressImageTag = this.wordpressVersion === 'latest' 
          ? 'latest' 
          : this.wordpressVersion;
        
        await execa('docker', ['pull', `wordpress:${wordpressImageTag}`], {
          cwd: projectPath,
        });
        
        spinner.succeed(`Docker images pulled successfully (WordPress ${wordpressImageTag})`);
      }
    } catch {
      spinner.warn('Docker image building/pulling encountered issues');
      console.log(chalk.yellow('  - Will attempt to continue with Docker Compose'));
    }
  }
  
  /**
   * Check system compatibility for Docker installation
   */
  private async checkSystem(): Promise<void> {
    const spinner = ora('Checking system platform...').start();
    const platformType = process.platform;
    const architecture = arch();
    
    spinner.succeed(`Detected platform: ${platformType} (${architecture})`);
    
    // Warn about potential issues based on platform/architecture
    if (architecture === 'arm64') {
      console.log(chalk.yellow('ℹ️ ARM64 architecture detected'));
      console.log(chalk.yellow('  - Some Docker images may require platform specification'));
      console.log(chalk.yellow('  - phpMyAdmin will use linux/amd64 platform for compatibility'));
    }
    
    switch (platformType) {
    case 'darwin': {
      // macOS-specific checks
      console.log(chalk.blue('ℹ️ macOS detected'));
      console.log(chalk.blue('  - Using Docker Desktop for macOS'));
    
    break;
    }

    case 'linux': {
      console.log(chalk.blue('ℹ️ Linux detected'));
    
    break;
    }

    case 'win32': {
      console.log(chalk.blue('ℹ️ Windows detected'));
      console.log(chalk.blue('  - Using Docker Desktop for Windows'));
      console.log(chalk.yellow('  - Path mapping may differ from Unix-based systems'));
    
    break;
    }
    // No default
    }
  }
  
  /**
   * Copy WordPress files from one location to another
   */
  private async copyWordPressFiles(sourcePath: string, destinationPath: string): Promise<void> {
    const spinner = ora('Copying WordPress files...').start();
    
    try {
      await fs.copy(sourcePath, destinationPath, {
        filter: src => !src.includes('.git') && 
                !src.includes('node_modules') &&
                !src.includes('.github')
      });
      
      // Check for wp-config.php and handle it
      const sourceWpConfig = join(sourcePath, 'wp-config.php');
      const destWpConfig = join(destinationPath, 'wp-config.php');
      
      if (fs.existsSync(sourceWpConfig)) {
        // Backup the original wp-config.php
        await fs.copy(destWpConfig, `${destWpConfig}.original`);
        spinner.info('Original wp-config.php backed up as wp-config.php.original');
        
        // Update wp-config.php for Docker environment
        await this.updateWpConfigForDocker(destWpConfig);
        spinner.info('wp-config.php updated for Docker environment');
      }
      
      spinner.succeed('WordPress files copied successfully');
    } catch (error) {
      spinner.fail('Failed to copy WordPress files');
      if (error instanceof Error) {
        throw new TypeError(`Failed to copy WordPress files: ${error.message}`);
      }
      
      throw new TypeError('Failed to copy WordPress files');
    }
  }
  
  /**
   * Creates a docker-compose.yml file for the WordPress project
   */
  // eslint-disable-next-line complexity
  private async createDockerComposeFile(projectPath: string, flags?: Record<string, unknown>): Promise<void> {
    const dockerComposePath = join(projectPath, 'docker-compose.yml');
    const architecture = arch();
    const isArm = architecture === 'arm64';
    
    // Initialize port manager
    const portManager = new PortManagerService();
    
    // Get port from port manager if domain is specified
    const wordpressPort = flags?.domain ? await portManager.allocatePort(flags.domain as string, projectPath) : await portManager.findAvailablePort(8080);

    // Find available PhpMyAdmin port
    const phpMyAdminPort = await portManager.findAvailablePort(wordpressPort + 1);

    // Find available MailHog ports only if MailHog is enabled
    let mailhogWebPort: number | undefined;
    let mailhogSmtpPort: number | undefined;
    if (flags?.mailhog) {
      mailhogWebPort = await portManager.findAvailablePort(phpMyAdminPort + 1);
      mailhogSmtpPort = await portManager.findAvailablePort(mailhogWebPort + 1);
    }

    // Store the WordPress port in flags for later use
    if (flags) {
      flags.port = wordpressPort;
      if (flags.mailhog) {
        flags.mailhogWebPort = mailhogWebPort;
        flags.mailhogSmtpPort = mailhogSmtpPort;
      }
    }

    // Prepare WORDPRESS_CONFIG_EXTRA if multisite is enabled
    let configExtra = '';
    if (flags && flags.multisite) {
      configExtra = `define('WP_ALLOW_MULTISITE', true);`;
      if (flags['multisite-type'] === 'subdomain') {
        configExtra += `\ndefine('SUBDOMAIN_INSTALL', true);`;
      }
    }

    const dockerCompose = `
services:
  wordpress:
    build: 
      context: .
      dockerfile: Dockerfile
      args:
        WORDPRESS_VERSION: ${this.wordpressVersion === 'latest' ? 'latest' : this.wordpressVersion}
        TARGETPLATFORM: ${isArm ? 'linux/arm64/v8' : 'linux/amd64'}
    ports:
      - "${wordpressPort}:80"
    environment:
      WORDPRESS_DB_HOST: mysql
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
      XDEBUG_MODE: \${XDEBUG_MODE:-off}${configExtra ? `\n      WORDPRESS_CONFIG_EXTRA: |\n        ${configExtra.replaceAll('\n', '\n        ')}` : ''}
    volumes:
      - ./wp-content:/var/www/html/wp-content
    depends_on:
      - mysql${flags?.mailhog ? '\n      - mailhog' : ''}

  mysql:
    image: ${isArm ? 'mariadb:10.6' : 'mysql:5.7'}
    platform: ${isArm ? 'linux/arm64/v8' : 'linux/amd64'}
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
    volumes:
      - mysql_data:/var/lib/mysql

  phpmyadmin:
    image: phpmyadmin/phpmyadmin
    platform: ${isArm ? 'linux/amd64' : 'linux/amd64'}
    ports:
      - "${phpMyAdminPort}:80"
    environment:
      PMA_HOST: mysql
    depends_on:
      - mysql

${flags?.mailhog ? `
  mailhog:
    image: mailhog/mailhog:latest
    platform: ${isArm ? 'linux/amd64' : 'linux/amd64'}
    ports:
      - "${mailhogWebPort}:8025"   # Web UI
      - "${mailhogSmtpPort}:1025"  # SMTP server
` : ''}
volumes:
  mysql_data:
`;

    fs.writeFileSync(dockerComposePath, dockerCompose.trim());
  }
  
  /**
   * Creates a Dockerfile for the WordPress project
   */
  private async createDockerfile(projectPath: string): Promise<void> {
    const architecture = arch();
    const isArm = architecture === 'arm64';
    
    // Determine base image based on architecture and WordPress version
    const getBaseImage = () => {
      if (this.wordpressVersion === 'latest') {
        return isArm ? 'arm64v8/wordpress:latest' : 'wordpress:latest';
      }

      return isArm ? `arm64v8/wordpress:${this.wordpressVersion}` : `wordpress:${this.wordpressVersion}`;
    };

    const dockerfileContent = `# Use build args for flexible WordPress version and platform
ARG WORDPRESS_VERSION=latest
ARG TARGETPLATFORM

FROM ${getBaseImage()}

# Set platform info
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "Building WordPress with Xdebug for platform: $TARGETPLATFORM"

# Install system dependencies needed for Xdebug and WP-CLI
RUN apt-get update && apt-get install -y \\
    curl \\
    ca-certificates \\
    less \\
    unzip \\
    && rm -rf /var/lib/apt/lists/* \\
    && update-ca-certificates

# Install WP-CLI with fallback for SSL issues
RUN curl -k -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \\
    && chmod +x wp-cli.phar \\
    && mv wp-cli.phar /usr/local/bin/wp \\
    && wp --info || echo "WP-CLI installed but API check failed due to SSL - this is OK"

# Configure PHP settings for better development experience
RUN echo "memory_limit = 512M" > /usr/local/etc/php/conf.d/development.ini \\
    && echo "max_execution_time = 300" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "post_max_size = 64M" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "upload_max_filesize = 64M" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "display_errors = On" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "log_errors = On" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "curl.cainfo = /etc/ssl/certs/ca-certificates.crt" >> /usr/local/etc/php/conf.d/development.ini \\
    && echo "openssl.cafile = /etc/ssl/certs/ca-certificates.crt" >> /usr/local/etc/php/conf.d/development.ini

# Install and configure Xdebug
# Xdebug will be controlled by the XDEBUG_MODE environment variable
RUN pecl install xdebug \\
    && docker-php-ext-enable xdebug \\
    && echo "xdebug.client_host=host.docker.internal" > /usr/local/etc/php/conf.d/xdebug.ini \\
    && echo "xdebug.client_port=9003" >> /usr/local/etc/php/conf.d/xdebug.ini \\
    && echo "xdebug.start_with_request=yes" >> /usr/local/etc/php/conf.d/xdebug.ini \\
    && echo "xdebug.discover_client_host=true" >> /usr/local/etc/php/conf.d/xdebug.ini \\
    && echo "xdebug.idekey=docker" >> /usr/local/etc/php/conf.d/xdebug.ini \\
    && echo "xdebug.log=/var/log/xdebug.log" >> /usr/local/etc/php/conf.d/xdebug.ini

# Create custom entrypoint script that sets Xdebug mode based on environment variable
RUN echo '#!/bin/bash' > /usr/local/bin/wp-spin-entrypoint.sh \\
    && echo '# Set Xdebug mode based on environment variable (defaults to off)' >> /usr/local/bin/wp-spin-entrypoint.sh \\
    && echo 'echo "xdebug.mode=\${XDEBUG_MODE:-off}" > /usr/local/etc/php/conf.d/xdebug-mode.ini' >> /usr/local/bin/wp-spin-entrypoint.sh \\
    && echo 'echo "Xdebug mode set to: \${XDEBUG_MODE:-off}"' >> /usr/local/bin/wp-spin-entrypoint.sh \\
    && echo '# Call the original WordPress entrypoint' >> /usr/local/bin/wp-spin-entrypoint.sh \\
    && echo 'exec docker-entrypoint.sh "$@"' >> /usr/local/bin/wp-spin-entrypoint.sh \\
    && chmod +x /usr/local/bin/wp-spin-entrypoint.sh

# Verify installations
RUN php -m | grep -i xdebug && echo "Xdebug installed successfully" || echo "Xdebug installation failed"

# Set the working directory
WORKDIR /var/www/html

# Use our custom entrypoint
ENTRYPOINT ["/usr/local/bin/wp-spin-entrypoint.sh"]
CMD ["apache2-foreground"]`;

    await fs.writeFile(join(projectPath, 'Dockerfile'), dockerfileContent);
  }
  
  /**
   * Creates a .env file with environment variables for Docker
   */
  private async createEnvFile(projectPath: string): Promise<void> {
    const dbPassword = this.generateSecurePassword();
    const rootPassword = this.generateSecurePassword();

    const envContent = `WORDPRESS_DB_HOST=mysql
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=${dbPassword}
WORDPRESS_DB_NAME=wordpress
MYSQL_ROOT_PASSWORD=${rootPassword}
MYSQL_DATABASE=wordpress
MYSQL_USER=wordpress
MYSQL_PASSWORD=${dbPassword}
XDEBUG_MODE=off`;

    await fs.writeFile(join(projectPath, '.env'), envContent);
    
    // Create a secure backup of credentials
    const credentials = {
      mysql: {
        password: dbPassword,
        user: 'wordpress'
      },
      root: {
        password: rootPassword
      },
      wordpress: {
        password: dbPassword,
        user: 'wordpress'
      }
    };
    
    await fs.writeFile(
      join(projectPath, '.credentials.json'),
      JSON.stringify(credentials, null, 2)
    );
    
    // Create a MySQL initialization script to ensure proper user setup
    // This script will run when the MySQL container is first initialized
    const mysqlDir = join(projectPath, 'mysql-init');
    
    // Ensure the directory exists
    await fs.ensureDir(mysqlDir);
    
    const initScriptContent = `
-- Create WordPress database if it doesn't exist
CREATE DATABASE IF NOT EXISTS wordpress;

-- Ensure the wordpress user exists and has correct password
-- First remove the user if it exists to avoid "user exists" errors
DROP USER IF EXISTS 'wordpress'@'%';
CREATE USER 'wordpress'@'%' IDENTIFIED BY '${dbPassword}';

-- Grant all privileges to the wordpress user on the wordpress database
GRANT ALL PRIVILEGES ON wordpress.* TO 'wordpress'@'%';

-- Grant privileges needed for WordPress to create tables, etc.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX ON wordpress.* TO 'wordpress'@'%';

-- Apply the changes
FLUSH PRIVILEGES;
`;
    
    await fs.writeFile(join(mysqlDir, 'init.sql'), initScriptContent);
    
    // Update the Docker Compose file creation method to mount this init script
    // This reference will be used in createDockerComposeFile
    this.mysqlInitScriptPath = join(mysqlDir, 'init.sql');
    
    // Set strict permissions on sensitive files (Unix-like systems only)
    if (process.platform !== 'win32') {
      await fs.chmod(join(projectPath, '.env'), 0o600);
      await fs.chmod(join(projectPath, '.credentials.json'), 0o600);
      await fs.chmod(join(mysqlDir, 'init.sql'), 0o600);
    }
  }
  
  /**
   * Displays information about the WordPress project after initialization
   */
  private async displayProjectInfo(projectPath: string, port: number, flags: Record<string, unknown>): Promise<void> {
    const wordpressPath = join(projectPath, 'wp-content');
    const protocol = flags.ssl ? 'https' : 'http';

    this.log(`\nProject initialized at: ${chalk.cyan(projectPath)}`);
    this.log(`WordPress files: ${chalk.cyan(wordpressPath)}`);
    this.log(`\nYou can access your site at:`);
    if (flags.domain) {
      this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}`)}`);
    } else {
      this.log(`  ${chalk.cyan(`${protocol}://localhost:${port}`)}`);
    }
    
    this.log(`\nWordPress admin:`);
    if (flags.domain) {
      this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}/wp-admin`)}`);
    } else {
      this.log(`  ${chalk.cyan(`${protocol}://localhost:${port}/wp-admin`)}`);
    }

    this.log(`\nDefault credentials:`);
    this.log(`  Username: ${chalk.cyan('admin')}`);
    this.log(`  Password: ${chalk.cyan('password')}`);

    this.log(`\nDatabase management:`);
    this.log(`  phpMyAdmin: ${chalk.cyan(`http://localhost:${flags.phpmyadminPort || (port + 1)}`)}`);

    // Display MailHog information (if enabled)
    if (flags.mailhog && flags.mailhogWebPort) {
      this.log(`\n${chalk.yellow('📧 Email Testing with MailHog:')}`);
      this.log(`  Web UI: ${chalk.cyan(`http://localhost:${flags.mailhogWebPort}`)}`);
      this.log(`  SMTP Server: ${chalk.cyan(`localhost:${flags.mailhogSmtpPort}`)}`);
      this.log(`  ${chalk.gray('All emails sent from WordPress will be captured by MailHog for testing')}`);
    }
  }

  private async findAvailablePort(startPort: number, usedPorts: Set<number>): Promise<number> {
    const batchSize = 10;
    
    const checkBatch = async (port: number): Promise<number> => {
      const portChecks = await Promise.all(
        Array.from({ length: batchSize }, (_, i) => port + i)
          .filter(p => !usedPorts.has(p))
          .map(async p => ({
            available: await this.isPortAvailable(p),
            port: p
          }))
      );
      
      const availablePort = portChecks.find(check => check.available)?.port;
      if (availablePort) {
        return availablePort;
      }
      
      return checkBatch(port + batchSize);
    };
    
    return checkBatch(startPort);
  }
  
  /**
   * Fix critical WordPress files for Docker compatibility
   */
  private async fixCriticalWordPressFiles(wordpressPath: string, projectPath: string, spinner: Spinner): Promise<void> {
    // We need to download WordPress core files
    spinner.info('Downloading WordPress core files to fix missing components...');
    
    // Create a temporary directory for WordPress core
    const tempWpDir = join(tmpdir(), `wp-core-${Date.now()}`);
    await fs.ensureDir(tempWpDir);
    
    try {
      // Download and extract WordPress core - use the specified version
      spinner.start(`Downloading WordPress ${this.wordpressVersion}...`);
      
      // Construct the WordPress download URL based on version
      const wordpressUrl = this.wordpressVersion === 'latest' 
        ? 'https://wordpress.org/latest.tar.gz'
        : `https://wordpress.org/wordpress-${this.wordpressVersion}.tar.gz`;
      
      await execa('curl', ['-s', '-o', join(tempWpDir, 'wp.tar.gz'), wordpressUrl], {
        cwd: projectPath,
      });
      
      spinner.start('Extracting WordPress core...');
      await execa('tar', ['-xzf', join(tempWpDir, 'wp.tar.gz'), '-C', tempWpDir], {
        cwd: projectPath,
      });
      
      // Copy only missing core files, preserving existing content
      spinner.start('Merging missing core files...');
      await this.mergeWordPressCore(join(tempWpDir, 'wordpress'), wordpressPath);
      
      spinner.succeed('WordPress core files merged successfully');
      
      // Clean up
      await fs.remove(tempWpDir);
    } catch (error) {
      spinner.fail('Failed to fix WordPress installation');
      console.error('Error:', error);
    }
  }
  
  /**
   * Fix nested WordPress directory structure (when WordPress is in a subdirectory)
   */
  private async fixNestedWordPressStructure(wordpressPath: string): Promise<void> {
    // Check if the directory exists and has a 'wp-config.php'
    const wpConfigPath = join(wordpressPath, 'wp-config.php');
    if (fs.existsSync(wpConfigPath)) {
      let configContent = await fs.readFile(wpConfigPath, 'utf8');
      
      // Fix absolute path references that might be from a different server
      if (configContent.includes('$_SERVER[\'DOCUMENT_ROOT\']')) {
        configContent = configContent.replaceAll('$_SERVER[\'DOCUMENT_ROOT\']', "'" + wordpressPath + "'");
        await fs.writeFile(wpConfigPath, configContent);
      }
      
      // Fix direct path references that might be from the original server
      const replaceRegexes = [
        /\/var\/www\/html/g,
        /\/home\/\w+\/public_html/g,
        /\/srv\/www\/htdocs/g
      ];
      
      // Process all regex replacements in one pass to avoid multiple file writes
      let needsUpdate = false;
      for (const regex of replaceRegexes) {
        if (regex.test(configContent)) {
          configContent = configContent.replaceAll(regex, wordpressPath);
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        await fs.writeFile(wpConfigPath, configContent);
      }
    }

    // Look for nested WordPress installations
    const possibleWpDirs = ['wordpress', 'wp', 'cms', 'public'];
    
    const processDirectoryPromises = possibleWpDirs.map(async (dir) => {
      const nestedDir = join(wordpressPath, dir);
      
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        const nestedFiles = await fs.readdir(nestedDir);
        const isWordPress = nestedFiles.includes('wp-config.php') || 
                            (nestedFiles.includes('wp-admin') && nestedFiles.includes('wp-content'));
        
        if (isWordPress) {
          console.log(`Found nested WordPress installation in ${dir}. Merging to parent...`);
          // Merge the nested WordPress files to the parent
          await this.mergeWordPressCore(nestedDir, wordpressPath);
          // Remove the original once merged
          await fs.remove(nestedDir);
          return true;
        }
      }

      return false;
    });
    
    // Wait for all directory processing to complete
    await Promise.all(processDirectoryPromises);
  }
  
  /**
   * Generate a secure random password
   */
  private generateSecurePassword(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private async handleInteractiveMode(args: Record<string, unknown>, flags: Record<string, unknown>): Promise<{ args: Record<string, unknown>, flags: Record<string, unknown> }> {
    const prompt = createPromptModule();
    const interactiveAnswers: { domain?: string; mailhog?: boolean; multisite?: boolean; 'multisite-type'?: string; name?: string; ssl?: boolean } = {};

    // 1. Site name
    if (!args.name) {
      const { siteName } = await prompt({
        message: 'Enter a site name (this will be used to create the project directory):',
        name: 'siteName',
        type: 'input',
        validate: (input: string) => input.trim() ? true : 'Site name is required'
      });
      interactiveAnswers.name = siteName.trim();
    }

    // 2. Multisite prompt
    if (flags.multisite === undefined) {
      const { enableMultisite } = await prompt({
        default: false,
        message: 'Enable WordPress Multisite (Network) support?',
        name: 'enableMultisite',
        type: 'confirm',
      });
      interactiveAnswers.multisite = enableMultisite;
    }

    // 3. Multisite type prompt if multisite is enabled
    if ((flags.multisite || interactiveAnswers.multisite) && !flags['multisite-type']) {
      const { multisiteType } = await prompt({
        choices: [
          { name: 'Subdomain (e.g., site1.mysite.test)', value: 'subdomain' },
          { name: 'Path (e.g., mysite.test/site1)', value: 'path' },
        ],
        message: 'Select multisite type:',
        name: 'multisiteType',
        type: 'list',
      });
      interactiveAnswers['multisite-type'] = multisiteType;
    }

    // 4. Custom local domain
    let useCustomDomain = false;
    if (flags.domain) {
      useCustomDomain = true;
    } else {
      const { useCustomDomain: useCustomDomainAnswer } = await prompt({
        default: false,
        message: 'Do you want to use a custom local domain?',
        name: 'useCustomDomain',
        type: 'confirm'
      });
      useCustomDomain = useCustomDomainAnswer;
      if (useCustomDomain) {
        const { domainName } = await prompt({
          message: 'Enter a name for your custom domain (will be appended with .test):',
          name: 'domainName',
          type: 'input',
          validate: (input: string) => input.trim() ? true : 'Domain name is required'
        });
        interactiveAnswers.domain = `${domainName.trim()}.test`;
      }
    }

    // 5. If multisite type is subdomain, require custom domain
    if ((flags.multisite || interactiveAnswers.multisite) && 
        (flags['multisite-type'] === 'subdomain' || interactiveAnswers['multisite-type'] === 'subdomain') && 
        !(flags.domain || interactiveAnswers.domain)) {
      this.error('Subdomain multisite requires a custom local domain (e.g., mysite.test). Please provide --domain. See: https://developer.wordpress.org/advanced-administration/multisite/prepare-network/');
    }

    // 6. SSL prompt if using a custom domain and SSL flag wasn't explicitly provided
    const sslFlagExplicitlyProvided = process.argv.includes('--ssl') || process.argv.includes('--no-ssl');
    if (useCustomDomain && !sslFlagExplicitlyProvided) {
      const { useSSL } = await prompt({
        default: false,
        message: 'Do you want to install a local SSL certificate for this domain?',
        name: 'useSSL',
        type: 'confirm'
      });
      interactiveAnswers.ssl = useSSL;
    }

    // 7. MailHog prompt if not explicitly provided
    const mailhogFlagExplicitlyProvided = process.argv.includes('--mailhog') || process.argv.includes('--no-mailhog');
    if (!mailhogFlagExplicitlyProvided) {
      const { useMailHog } = await prompt({
        default: false,
        message: 'Do you want to install MailHog for local email testing?\n  This will also install the WP Mail SMTP plugin to ensure emails work properly.',
        name: 'useMailHog',
        type: 'confirm'
      });
      interactiveAnswers.mailhog = useMailHog;
    }

    // Merge interactive answers into args/flags
    args = { ...args, ...interactiveAnswers };
    flags = { ...flags, ...interactiveAnswers };
    return { args, flags };
  }
  
  /**
   * Handle local WordPress source (from current directory)
   */
  private async handleLocalSource(): Promise<string> {
    const spinner = ora();
    const currentDir = process.cwd();
    
    // Validate current directory
    const validation = await this.validateWordPressDirectory(currentDir);
    
    if (!validation.isValid) {
      spinner.warn('Current directory does not appear to contain a valid WordPress installation');
      console.log('Issues found:');
      for (const issue of validation.issues) {
        console.log(` - ${issue}`);
      }
      
      // Ask user if they want to continue anyway
      const prompt = createPromptModule();
    const { proceed } = await prompt([{
        default: false,
        message: 'Continue anyway?',
        name: 'proceed',
        type: 'confirm'
      }]);
      
      if (!proceed) {
        throw new TypeError('Aborted due to invalid WordPress installation in current directory');
      }
    }
    
    return currentDir;
  }

  private hasAllRequiredFlags(flags: Record<string, unknown>): boolean {
    // Only require site-name, domain, and ssl to skip interactive mode
    return (
      flags['site-name'] !== undefined &&
      flags.domain !== undefined &&
      flags.ssl !== undefined
    );
  }

  private async installWordPress(siteName: string, _version: string, flags: Record<string, unknown>): Promise<void> {
    try {
      // Get the correct container name from the base class method
      const containerNames = this.getContainerNames();
      const containerName = containerNames.wordpress;

      // Install WP-CLI properly for the container architecture
      execSync(
        `docker exec ${containerName} sh -c "curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp && wp --info"`,
        { stdio: 'inherit' }
      );

      // Set permissions on existing directories (ignore errors if they don't exist)
      execSync(
        `docker exec ${containerName} sh -c "chown -R www-data:www-data /var/www/html 2>/dev/null || true"`,
        { stdio: 'inherit' }
      );

      // Ensure wp-content and its subdirectories exist with correct permissions
      const subdirs = ['themes', 'plugins', 'uploads', 'upgrade'];
      for (const dir of subdirs) {
        execSync(
          `docker exec ${containerName} sh -c "mkdir -p /var/www/html/wp-content/${dir} 2>/dev/null || true && chown www-data:www-data /var/www/html/wp-content/${dir} 2>/dev/null || true"`,
          { stdio: 'inherit' }
        );
      }

      // Set final permissions (ignore errors)
      execSync(
        `docker exec ${containerName} sh -c "chown -R www-data:www-data /var/www/html 2>/dev/null || true"`,
        { stdio: 'inherit' }
      );
      
      // Set directory permissions
      execSync(
        `docker exec ${containerName} sh -c "find /var/www/html -type d -exec chmod 755 {} + 2>/dev/null || true"`,
        { stdio: 'inherit' }
      );
      
      // Set file permissions
      execSync(
        `docker exec ${containerName} sh -c "find /var/www/html -type f -exec chmod 644 {} + 2>/dev/null || true"`,
        { stdio: 'inherit' }
      );

      // Check if wp-config.php exists and remove it if it does
      try {
        execSync(
          `docker exec ${containerName} test -f /var/www/html/wp-config.php && docker exec ${containerName} rm /var/www/html/wp-config.php`,
          { stdio: 'ignore' }
        );
      } catch {
        // Ignore errors - file doesn't exist or couldn't be removed
      }

      // Create wp-config.php with debug settings and SSL support
      const protocol = flags.ssl ? 'https' : 'http';
      const sslConfig = flags.domain ? `
// Added by wp-spin for proxy support - MUST be at the top
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
    $_SERVER['SERVER_PORT'] = 443;
}
` : '';

      const domainConfig = flags.domain ? `
// Force WordPress to use the correct URL and protocol
define('WP_HOME', '${protocol}://${flags.domain}');
define('WP_SITEURL', '${protocol}://${flags.domain}');

${flags.ssl ? "// Force HTTPS for admin and login pages\ndefine('FORCE_SSL_ADMIN', true);\n" : ""}
// Ensure WordPress generates correct URLs for assets
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    define('WP_CONTENT_URL', '${protocol}://${flags.domain}/wp-content');
    define('WP_PLUGIN_URL', '${protocol}://${flags.domain}/wp-content/plugins');
}
` : '';

      const configContent = `<?php${sslConfig}
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'wordpress' );
define( 'DB_PASSWORD', 'wordpress' );
define( 'DB_HOST', 'mysql' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', true );
${domainConfig}
$table_prefix = 'wp_';

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}

require_once ABSPATH . 'wp-settings.php';`;

      // Write config to a temporary file
      const tempConfigPath = join(tmpdir(), 'wp-config.php');
      fs.writeFileSync(tempConfigPath, configContent);

      // Copy the config file into the container
      execSync(
        `docker cp ${tempConfigPath} ${containerName}:/var/www/html/wp-config.php`,
        { stdio: 'inherit' }
      );

      // Clean up the temporary file
      fs.unlinkSync(tempConfigPath);

      // Create a PHP configuration file to increase memory limit
      const phpConfigContent = `memory_limit = 512M
max_execution_time = 300
post_max_size = 64M
upload_max_filesize = 64M`;

      const tempPhpConfigPath = join(tmpdir(), 'php.ini');
      fs.writeFileSync(tempPhpConfigPath, phpConfigContent);

      // Copy PHP config into container
      execSync(
        `docker cp ${tempPhpConfigPath} ${containerName}:/usr/local/etc/php/conf.d/custom.ini`,
        { stdio: 'inherit' }
      );

      // Clean up the temporary PHP config file
      fs.unlinkSync(tempPhpConfigPath);

      // Restart PHP-FPM to apply new settings
      execSync(
        `docker exec ${containerName} sh -c "kill -USR2 1"`,
        { stdio: 'inherit' }
      );

      // Ensure WordPress core files are present
      try {
        execSync(
          `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp core download --force --allow-root"`,
          { stdio: 'inherit' }
        );
      } catch {
        // Fallback: download WordPress directly with curl to bypass SSL issues
        console.log('WordPress download failed, trying direct download...');
        execSync(
          `docker exec ${containerName} sh -c "cd /var/www/html && curl -k -L -O https://wordpress.org/latest.tar.gz && tar -xzf latest.tar.gz --strip-components=1 && rm latest.tar.gz"`,
          { stdio: 'inherit' }
        );
      }

      // Install WordPress using WP-CLI with the correct URL
      const installUrl = flags.domain 
        ? `${flags.ssl ? 'https' : 'http'}://${flags.domain}`
        : `http://localhost:${flags.port}`;
      
      execSync(
        `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp core install --url='${installUrl}' --title='${siteName}' --admin_user=admin --admin_password=password --admin_email=admin@example.com --allow-root 2>&1 | grep -v 'sendmail: not found'"`,
        { stdio: 'inherit' }
      );

      // Update site URLs - skip if domain is specified (already set in wp-config.php)
      if (flags.domain === undefined) {
        // Only update URLs to localhost if no custom domain is specified
        execSync(
          `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp option update home 'http://localhost:${flags.port}' --allow-root"`,
          { stdio: 'inherit' }
        );
        execSync(
          `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp option update siteurl 'http://localhost:${flags.port}' --allow-root"`,
          { stdio: 'inherit' }
        );
      } else {
        // URLs are already set via wp-config.php constants, no need to update via WP-CLI
        const protocol = flags.ssl ? 'https' : 'http';
        this.logDebug(`URLs already configured in wp-config.php as: ${protocol}://${flags.domain}`);
      }

      // Install and activate a default theme
      execSync(
        `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp theme install twentytwentyfour --activate --allow-root"`,
        { stdio: 'inherit' }
      );

      // Configure WordPress to use MailHog for email (if enabled)
      if (flags.mailhog) {
        console.log('Configuring WordPress to use MailHog for local email testing...');
        
        // Install and configure wp-mail-smtp plugin for MailHog
        try {
          execSync(
            `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp plugin install wp-mail-smtp --activate --allow-root"`,
            { stdio: 'inherit' }
          );
        } catch {
          // Fallback: download plugin directly with curl to bypass SSL issues
          console.log('Plugin download failed, trying direct download...');
          execSync(
            `docker exec ${containerName} sh -c "cd /var/www/html && curl -k -L -o wp-mail-smtp.zip https://downloads.wordpress.org/plugin/wp-mail-smtp.zip && unzip wp-mail-smtp.zip -d wp-content/plugins/ && rm wp-mail-smtp.zip && php -d memory_limit=512M /usr/local/bin/wp plugin activate wp-mail-smtp --allow-root"`,
            { stdio: 'inherit' }
          );
        }

        // Configure wp-mail-smtp plugin for MailHog
        const mailhogSmtpPort = 1025; // Internal Docker port for SMTP
        /* eslint-disable camelcase */
        const wpMailSmtpConfig = {
          mail: {
            from_email: 'admin@example.com',
            from_name: siteName,
            mailer: 'smtp',
            return_path: true
          },
          smtp: {
            auth: false,
            autotls: false,
            encryption: 'none',
            host: 'mailhog',
            pass: '',
            port: mailhogSmtpPort,
            user: ''
          }
        };
        /* eslint-enable camelcase */
        
        const configJson = JSON.stringify(wpMailSmtpConfig).replaceAll('"', String.raw`\"`);
        execSync(
          `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp option update wp_mail_smtp '${configJson}' --format=json --allow-root"`,
          { stdio: 'inherit' }
        );

        console.log('MailHog email configuration completed successfully!');
      }

      // Set up multisite if requested
      if (flags.multisite) {
        console.log('Setting up WordPress Multisite network...');
        
        const networkTitle = `${siteName} Network`;
        
        try {
          // Convert to multisite using WP-CLI
          const multisiteCommand = flags['multisite-type'] === 'subdomain' 
            ? `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp core multisite-convert --title='${networkTitle}' --subdomains --allow-root"`
            : `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp core multisite-convert --title='${networkTitle}' --allow-root"`;
          
          execSync(multisiteCommand, { stdio: 'inherit' });
          
          // Add multisite constants to wp-config.php manually since WP-CLI can't modify it when WP_HOME/WP_SITEURL are constants
          if (flags.domain) {
            const multisiteConfigContent = `<?php${sslConfig}
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'wordpress' );
define( 'DB_PASSWORD', 'wordpress' );
define( 'DB_HOST', 'mysql' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );

define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', true );
${domainConfig}
// Multisite configuration
define( 'WP_ALLOW_MULTISITE', true );
define( 'MULTISITE', true );
define( 'SUBDOMAIN_INSTALL', ${flags['multisite-type'] === 'subdomain' ? 'true' : 'false'} );
define( 'DOMAIN_CURRENT_SITE', '${flags.domain}' );
define( 'PATH_CURRENT_SITE', '/' );
define( 'SITE_ID_CURRENT_SITE', 1 );
define( 'BLOG_ID_CURRENT_SITE', 1 );

$table_prefix = 'wp_';

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}

require_once ABSPATH . 'wp-settings.php';`;

            // Write the complete multisite config
            const tempMultisiteConfigPath = join(tmpdir(), 'wp-config-multisite.php');
            fs.writeFileSync(tempMultisiteConfigPath, multisiteConfigContent);
            execSync(
              `docker cp ${tempMultisiteConfigPath} ${containerName}:/var/www/html/wp-config.php`,
              { stdio: 'inherit' }
            );
            fs.unlinkSync(tempMultisiteConfigPath);
          }
          
          console.log('WordPress Multisite network setup completed successfully!');
        } catch (error) {
          console.warn('Warning: Multisite setup encountered issues. You may need to complete setup manually.');
          console.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Clear WordPress cache
      execSync(
        `docker exec ${containerName} sh -c "cd /var/www/html && php -d memory_limit=512M /usr/local/bin/wp cache flush --allow-root"`,
        { stdio: 'inherit' }
      );

      // Final permissions fix
      execSync(
        `docker exec ${containerName} sh -c "chown -R www-data:www-data /var/www/html"`,
        { stdio: 'inherit' }
      );
      
      // Set directory permissions
      execSync(
        `docker exec ${containerName} sh -c "find /var/www/html -type d -exec chmod 755 {} +"`,
        { stdio: 'inherit' }
      );
      
      // Set file permissions  
      execSync(
        `docker exec ${containerName} sh -c "find /var/www/html -type f -exec chmod 644 {} +"`,
        { stdio: 'inherit' }
      );
    } catch (error) {
      throw new Error(`Failed to install WordPress: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      // Check if port is in use by Docker containers
      const result = execSync(`docker ps --format "{{.Ports}}" | grep ":${port}->"`, { encoding: 'utf8' }).trim();
      if (result) {
        return false;
      }

      // Also check if port is in use by the system
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port);
      });
    } catch {
      // If grep doesn't find anything, the port is available
      return true;
    }
  }

  /**
   * Merge WordPress core files into target directory
   */
  private async mergeWordPressCore(coreSourcePath: string, targetPath: string): Promise<void> {
    // Get list of files to merge
    const files = await fs.readdir(coreSourcePath);
    
    // Create a map of file operations to execute in parallel
    const copyOperations = files.map(async (file) => {
      const sourcePath = join(coreSourcePath, file);
      const destPath = join(targetPath, file);
      
      const fileStats = await fs.stat(sourcePath);
      
      if (fileStats.isDirectory()) {
        // For directories, ensure they exist at the destination
        await fs.ensureDir(destPath);
        
        // Recursively copy contents
        const dirFiles = await fs.readdir(sourcePath);
        
        // Process files in directory in parallel
        await Promise.all(dirFiles.map(async (innerFile) => {
          const innerSourcePath = join(sourcePath, innerFile);
          const innerDestPath = join(destPath, innerFile);
          
          const innerStats = await fs.stat(innerSourcePath);
          
          if (innerStats.isDirectory()) {
            // For nested directories, call recursively
            await this.mergeWordPressCore(innerSourcePath, innerDestPath);
          } else if (!fs.existsSync(innerDestPath)) {
            // Only copy files that don't exist to avoid overwrites
            await fs.copy(innerSourcePath, innerDestPath);
          }
        }));
      } else if (!fs.existsSync(destPath)) {
        // Only copy files that don't exist
        await fs.copy(sourcePath, destPath);
      }
    });
    
    // Wait for all copy operations to complete
    await Promise.all(copyOperations);
  }

  /**
   * Normalizes a domain by ensuring it ends with .test
   * @param domain - The domain to normalize
   * @returns The normalized domain with .test suffix
   */
  private normalizeDomain(domain: string): string {
    if (!domain) return domain;
    
    const trimmedDomain = domain.trim();
    
    // If the domain already ends with .test, return as-is
    if (trimmedDomain.endsWith('.test')) {
      return trimmedDomain;
    }
    
    // If the domain contains a TLD (has a dot), return as-is to respect user's intention
    if (trimmedDomain.includes('.') && !trimmedDomain.endsWith('.')) {
      return trimmedDomain;
    }
    
    // Otherwise, append .test
    return `${trimmedDomain}.test`;
  }
  
  /**
   * Prepares the project directory structure
   */
  private async prepareProjectDirectory(projectPath: string, force: boolean): Promise<void> {
    const spinner = ora();
    
    // Check if directory exists
    if (fs.existsSync(projectPath)) {
      if (force) {
        spinner.start('Removing existing project directory...');
        fs.removeSync(projectPath);
        spinner.succeed('Existing project directory removed');
      } else {
        this.error(`Directory ${projectPath.split('/').pop()} already exists`);
      }
    }

    // Create project directory
    spinner.start('Creating project directory...');
    fs.mkdirSync(projectPath, { recursive: true });
    // Set proper permissions (755 for directories)
    if (process.platform !== 'win32') {
      fs.chmodSync(projectPath, 0o755);
    }

    this.projectPath = projectPath; // Set the project path here

    // Create a .wp-spin file as a marker for project root
    const { flags } = await this.parse(Init);
    const config = {
      createdAt: new Date().toISOString(),
      domain: flags.domain || null,
      version: this.config.version,
    };
    fs.writeFileSync(join(projectPath, '.wp-spin'), JSON.stringify(config, null, 2));

    // Create .gitignore file
    const gitignoreContent = `# wp-spin specific files
.env
.credentials.json
.wp-spin

# WordPress core files - typically managed by updates, not version control
/wp-admin/
/wp-includes/
/wp-*.php
/index.php
/xmlrpc.php
/license.txt
/readme.html

# User-generated content - Back up uploads separately!
/wp-content/uploads/
/wp-content/upgrade/
/wp-content/backup*/
/wp-content/cache/
/wp-content/backups/

# Config file - Contains sensitive info
wp-config.php

# Cache files and logs
*.log
debug.log
/wp-content/debug.log

# Build/dependency files
node_modules/
vendor/
package-lock.json
composer.lock

# OS generated files
.DS_Store
Thumbs.db
desktop.ini

# IDE / Editor directories
.idea/
.vscode/
*.sublime-project
*.sublime-workspace

# Backup files created by editors
*~
*.bak
*.swp
*.swo
`;
    fs.writeFileSync(join(projectPath, '.gitignore'), gitignoreContent);
    spinner.succeed('.gitignore file created');
  }
  
  /**
   * Set up the Docker environment for WordPress
   */
  private async setupDockerEnvironment(projectPath: string, wordpressPath: string): Promise<void> {
    const spinner = ora();
    const { flags } = await this.parse(Init);

    // Create Dockerfile and entrypoint script
    spinner.start('Creating Docker configuration...');
    await this.createDockerfile(projectPath);
    spinner.succeed('Docker configuration created');

    // Create docker-compose.yml with the correct ports
    spinner.start('Creating docker-compose.yml...');
    await this.createDockerComposeFile(projectPath, flags);
    spinner.succeed('docker-compose.yml created');

    // Create .env file
    spinner.start('Creating .env file...');
    await this.createEnvFile(projectPath);
    spinner.succeed('.env file created');

    // Start the environment
    spinner.start('Starting WordPress environment...');
    try {
      await this.docker.start();
      spinner.succeed('WordPress environment started');
      
      // Add an extra check to make sure WordPress is properly set up
      spinner.start('Verifying WordPress installation...');
      await this.verifyWordPressSetup(wordpressPath);
      spinner.succeed('WordPress installation verified');
    } catch (error) {
      spinner.fail('Failed to start WordPress environment');
      console.error('Error starting WordPress:', error);
      
      // Try to recover from errors
      await this.tryRecoverEnvironment(error, wordpressPath, projectPath, spinner);
    }
  }

  private async setupProject(args: Record<string, unknown> & { name: string }, flags: Record<string, unknown>): Promise<void> {
    // Ensure nginxProxy is initialized if domain is present
    if (flags.domain && !this.nginxProxy) {
      this.nginxProxy = new (await import('../services/nginx-proxy.js')).NginxProxyService();
    }

    const spinner = ora('Initializing WordPress development environment').start();
    try {
      // Check system architecture
      const architecture = arch();
      spinner.info(`Detected architecture: ${architecture}`);
      if (architecture === 'arm64') {
        spinner.info('ARM64 architecture detected - using ARM-compatible images');
      }

      // Create project directory
      const projectName = args.name!;
      const projectPath = join(process.cwd(), projectName);
      if (fs.existsSync(projectPath)) {
        throw new Error(`Directory ${projectName} already exists`);
      }
      
      fs.mkdirSync(projectPath, { recursive: true });
      // Set proper permissions (755 for directories)
      if (process.platform !== 'win32') {
      fs.chmodSync(projectPath, 0o755);
    }

    this.projectPath = projectPath; // Set the project path here

      // Create Dockerfile first (required by docker-compose.yml)
      await this.createDockerfile(projectPath);
      
      // Create docker-compose.yml with architecture-specific images
      await this.createDockerComposeFile(projectPath, flags);

      // Initialize Docker service
      this.docker = new DockerService(projectPath, this);

      // Start containers
      await this.docker.start();

      // Get the actual port from Docker first
      const port = await this.docker.getPort('wordpress');
      
      // Update the port in flags to ensure consistency
      flags.port = port;

      // Get MailHog ports from Docker containers (if MailHog is enabled)
      /* eslint-disable max-depth */
      if (flags.mailhog) {
        try {
          const { execSync } = await import('node:child_process');
          const containerNames = this.getContainerNames();
          const result = execSync(`docker port ${containerNames.mailhog}`, { cwd: projectPath, encoding: 'utf8' });
          
          // Parse the output to get the actual ports
          // Expected format: "1025/tcp -> 0.0.0.0:XXXXX" and "8025/tcp -> 0.0.0.0:YYYYY"
          const lines = result.split('\n');
          let mailhogWebPort: number | undefined;
          let mailhogSmtpPort: number | undefined;
          
          for (const line of lines) {
            if (line.includes('8025/tcp')) {
              const match = line.match(/0\.0\.0\.0:(\d+)/);
              if (match) {
                mailhogWebPort = Number.parseInt(match[1], 10);
              }
            } else if (line.includes('1025/tcp')) {
              const match = line.match(/0\.0\.0\.0:(\d+)/);
              if (match) {
                mailhogSmtpPort = Number.parseInt(match[1], 10);
              }
            }
          }
          
          if (mailhogWebPort) flags.mailhogWebPort = mailhogWebPort;
          if (mailhogSmtpPort) flags.mailhogSmtpPort = mailhogSmtpPort;
        } catch {
          console.warn('Note: Could not retrieve MailHog ports from Docker - MailHog URLs may not be displayed');
        }
      }
      /* eslint-enable max-depth */

      // Wait for WordPress to be ready
      spinner.text = 'Waiting for WordPress to be ready...';
      await this.waitForWordPress();

      // Install WordPress
      spinner.text = 'Installing WordPress...';
      await this.installWordPress(flags['site-name'] as string || projectName, flags['wordpress-version'] as string, flags);

      // Configure custom domain if specified
      if (flags.domain) {
        spinner.text = 'Configuring custom domain...';
        let ssl = false;
        if (flags.ssl) {
          spinner.text = 'Generating local SSL certificate with mkcert...';
          await this.nginxProxy.generateSSLCert(flags.domain as string);
          ssl = true;
        }
        
        // Configure the domain with the actual port from Docker
        await this.nginxProxy.addDomain(flags.domain as string, port, ssl);
      }

      // Add site to config
      addSite(projectName, projectPath);

      spinner.succeed('WordPress development environment initialized successfully!');

      // Display project info with the actual port
      await this.displayProjectInfo(projectPath, port, flags);
    } catch (error) {
      spinner.fail('Failed to initialize project');
      this.prettyError(error instanceof Error ? error : new Error(String(error)));
      this.exit(1);
    }
  }

  /**
   * Set up WordPress source files
   */
  private async setupWordpressSource(wordpressPath: string, flags: Record<string, boolean | number | string | undefined>, projectPath: string): Promise<void> {
    const spinner = ora();
    const wordpressSourcePath: null | string = null;

    // Create directory structure
    spinner.start('Creating WordPress directory structure...');
    const mysqlPath = join(projectPath, 'mysql');
    const mysqlFilesPath = join(projectPath, 'mysql-files');
    fs.mkdirSync(wordpressPath);
    fs.mkdirSync(mysqlPath);
    fs.mkdirSync(mysqlFilesPath);
    spinner.succeed('WordPress directory structure created');
    
    // If we have WordPress source files, copy them
    if (wordpressSourcePath) {
      await this.copyWordPressFiles(wordpressSourcePath, wordpressPath);
      
      // Verify WordPress installation in the destination
      const validation = await this.validateWordPressDirectory(wordpressPath);
      
      if (!validation.isValid) {
        // Ask user whether to continue anyway
        spinner.warn('WordPress files appear to be incomplete or invalid:');
        for (const issue of validation.issues) console.log(`- ${issue}`);
        
        const inquirer = createPromptModule();
        const { proceed } = await inquirer({
          default: false,
          message: 'Do you want to continue anyway? (This might result in a non-functional installation)',
          name: 'proceed',
          type: 'confirm',
        });
        
        if (!proceed) {
          this.error('User declined to continue with invalid WordPress installation');
        }
      }
    } else {
      // No source specified, download standard WordPress
      spinner.start(`Downloading WordPress ${this.wordpressVersion}...`);
      try {
        // Create a temporary directory for the download
        const tempDir = join(tmpdir(), `wp-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Set PHP memory limit for WP-CLI
        process.env.PHP_MEMORY_LIMIT = '512M';
        
        // Use WordPress version if specified
        const versionArg = this.wordpressVersion === 'latest' ? '' : `--version=${this.wordpressVersion}`;
        
        // Download WordPress core using WP-CLI with increased memory limit
        await execa('wp', [
          'core',
          'download',
          versionArg,
          '--path=' + tempDir,
          '--skip-content'
        ], {
          env: {
            ...process.env,
            PHP_MEMORY_LIMIT: '512M'
          },
          stdio: 'pipe'
        });
        
        // Copy WordPress files to our destination
        await this.copyWordPressFiles(tempDir, wordpressPath);
        
        // Clean up temp directory
        fs.removeSync(tempDir);
        
        spinner.succeed(`WordPress ${this.wordpressVersion} downloaded and installed`);
      } catch (error) {
        spinner.fail(`Failed to download WordPress: ${error instanceof Error ? error.message : String(error)}`);
        this.error('Failed to download WordPress');
      }
    }
    
    try {
      // Check for nested WordPress structure and fix if needed
      await this.fixNestedWordPressStructure(wordpressPath);
      
      // Fix critical WordPress files for Docker environment
      await this.fixCriticalWordPressFiles(wordpressPath, projectPath, spinner);
      
      // Verify WordPress setup
      await this.verifyWordPressSetup(wordpressPath);
    } catch (error) {
      await this.tryRecoverEnvironment(error, wordpressPath, projectPath, spinner);
    }
  }
  
  /**
   * Handle recovery from errors during environment setup
   */
  private async tryRecoverEnvironment(error: unknown, wordpressPath: string, projectPath: string, spinner: Spinner): Promise<void> {
    // Check logs for specific errors
    spinner.info('Checking WordPress logs for specific errors...');
    try {
      // Get logs in case we need to check for errors
      await this.docker.getLogs();
      
      // Try to recover by fixing common issues
      spinner.info('Attempting to fix WordPress configuration...');
      
      // Make sure important files are writable by WordPress container (Unix-like systems only)
      if (process.platform !== 'win32') {
        await execa('chmod', ['-R', '777', join(wordpressPath, 'wp-content')], {
          cwd: projectPath,
        });
      }

      spinner.succeed('Fixed WordPress permissions');
      
      // Try starting again
      spinner.start('Restarting WordPress environment...');
      await this.docker.restart();
      spinner.succeed('WordPress environment restarted');
    } catch (error) {
      spinner.fail('Could not fix WordPress installation');
      console.error('Error details:', error);
    }
  }
  
  /**
   * Updates the wp-config.php file for Docker compatibility
   */
  private async updateWpConfigForDocker(wpConfigPath: string): Promise<void> {
    if (!fs.existsSync(wpConfigPath)) {
      return;
    }
    
    try {
      let content = await fs.readFile(wpConfigPath, 'utf8');
      
      // Replace database connection details with Docker environment variables
      content = content.replaceAll(
        /define\(\s*['"]DB_HOST['"]\s*,\s*['"].*?['"]\s*\);/,
        "define('DB_HOST', 'mysql');"
      );
      
      content = content.replaceAll(
        /define\(\s*['"]DB_USER['"]\s*,\s*['"].*?['"]\s*\);/,
        "define('DB_USER', 'wordpress');"
      );
      
      content = content.replaceAll(
        /define\(\s*['"]DB_PASSWORD['"]\s*,\s*['"].*?['"]\s*\);/,
        "define('DB_PASSWORD', 'wordpress');"
      );
      
      content = content.replaceAll(
        /define\(\s*['"]DB_NAME['"]\s*,\s*['"].*?['"]\s*\);/,
        "define('DB_NAME', 'wordpress');"
      );
      
      // Add helpful comment about Docker environment
      const dockerComment = "\n\n/**\n * Docker Environment Settings\n * Automatically configured by wp-spin\n */\n";
      if (!content.includes('Docker Environment Settings')) {
        content += dockerComment;
      }
      
      // Write the updated content back
      await fs.writeFile(wpConfigPath, content);
    } catch (error) {
      console.error('Error updating wp-config.php:', error);
      // Continue despite error - we'll use the original config
    }
  }

  private async validateMultisiteFlags(flags: Record<string, unknown>): Promise<void> {
    if (flags.multisite) {
      if (!flags['multisite-type']) {
        this.error('You must specify --multisite-type (subdomain or path) when using --multisite. See: https://developer.wordpress.org/advanced-administration/multisite/prepare-network/');
      }

      // Only validate domain requirement if we're not in interactive mode
      if (flags['multisite-type'] === 'subdomain' && !flags.domain && this.hasAllRequiredFlags(flags)) {
        this.error('Subdomain multisite requires a custom local domain (e.g., mysite.test). Please provide --domain. See: https://developer.wordpress.org/advanced-administration/multisite/prepare-network/');
      }
    }
  }

  /**
   * Validates a directory to check if it contains a valid WordPress installation
   */
  private async validateWordPressDirectory(directoryPath: string): Promise<{ issues: string[]; isValid: boolean }> {
    const requiredFiles = ['wp-config.php', 'wp-content', 'wp-includes', 'wp-admin'];
    const issues: string[] = [];
    
    for (const file of requiredFiles) {
      const filePath = join(directoryPath, file);
      if (!fs.existsSync(filePath)) {
        issues.push(`Missing ${file}`);
      }
    }
    
    return {
      issues,
      isValid: issues.length === 0,
    };
  }

  /**
   * Verifies WordPress setup after installation
   */
  private async verifyWordPressSetup(wordpressPath: string): Promise<void> {
    // Check permissions on wp-content directory
    try {
      if (process.platform !== 'win32') {
        await fs.chmod(join(wordpressPath, 'wp-content'), 0o777);
      }
      
      // Make sure important directories exist and are writable
      const contentDirs = [
        'uploads',
        'plugins',
        'themes',
        'upgrade'
      ];
      
      // Process all directories in parallel instead of sequentially
      await Promise.all(contentDirs.map(async (dir) => {
        const dirPath = join(wordpressPath, 'wp-content', dir);
        await fs.ensureDir(dirPath);
        if (process.platform !== 'win32') {
          await fs.chmod(dirPath, 0o777);
        }
      }));
      
      // Create an .htaccess file if it doesn't exist
      const htaccessPath = join(wordpressPath, '.htaccess');
      if (!fs.existsSync(htaccessPath)) {
        const htaccessContent = `
# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteBase /
RewriteRule ^index\\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress
`;
        await fs.writeFile(htaccessPath, htaccessContent);
      }
      
      // Always explicitly call the fixNestedWordPressStructure method to fix /cms/ path issues
      await this.fixNestedWordPressStructure(wordpressPath);
      
      // Make sure wp-config.php is properly set up and Docker-friendly
      const wpConfigPath = join(wordpressPath, 'wp-config.php');
      if (fs.existsSync(wpConfigPath)) {
        let configContent = await fs.readFile(wpConfigPath, 'utf8');
        
        // Check for custom content directories that might cause issues
        if (configContent.includes('WP_CONTENT_DIR') || configContent.includes('WP_CONTENT_URL')) {
          // Update content directory references to match our setup
          configContent = configContent.replaceAll(
            /define\s*\(\s*['"]WP_CONTENT_DIR['"]\s*,\s*['"].*?['"]\s*\);/,
            "define('WP_CONTENT_DIR', __DIR__ . '/wp-content');"
          );
          
          configContent = configContent.replaceAll(
            /define\s*\(\s*['"]WP_CONTENT_URL['"]\s*,\s*['"].*?['"]\s*\);/,
            "define('WP_CONTENT_URL', 'http://' . $_SERVER['HTTP_HOST'] . '/wp-content');"
          );
          
          await fs.writeFile(wpConfigPath, configContent);
          console.log('Fixed wp-config.php content directory references');
        }
        
        // Update the Docker database settings
        await this.updateWpConfigForDocker(wpConfigPath);
      }
      
      // Check for nested WordPress installations
      const possibleNestedDirsPromises = ['cms', 'wordpress', 'wp', 'public'].map(async (dir) => {
        const nestedDir = join(wordpressPath, dir);
        if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
          // Check if it contains WordPress files
          const wpBlogHeader = join(nestedDir, 'wp-blog-header.php');
          if (fs.existsSync(wpBlogHeader)) {
            console.log(`Found nested WordPress installation in ${dir} directory. Merging to root...`);
            await this.mergeWordPressCore(nestedDir, wordpressPath);
            await fs.remove(nestedDir);
          }
        }
      });
      
      // Wait for all nested directory checks to complete
      await Promise.all(possibleNestedDirsPromises);
      
    } catch (error) {
      console.error('Error verifying WordPress setup:', error);
      // Continue anyway - we've tried our best
    }
  }

  private async waitForWordPress(): Promise<void> {
    const maxAttempts = 30;
    const delay = 2000; // 2 seconds

    const sleep = (ms: number) => new Promise<void>(resolve => {
      setTimeout(resolve, ms);
    });

    const poll = async (attempt: number): Promise<void> => {
      try {
        const result = execSync('docker ps --filter "name=wordpress" --format "{{.Status}}"', { encoding: 'utf8' });
        if (result.includes('Up')) {
          return;
        }
      } catch {
        // Ignore errors and keep trying
      }

      if (attempt >= maxAttempts) {
        throw new Error('WordPress container failed to start');
      }

      await sleep(delay);
      return poll(attempt + 1);
    };

    return poll(1);
  }
}
