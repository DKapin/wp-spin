import { Args, Command, Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import { createPromptModule } from 'inquirer';
import crypto from 'node:crypto';
import net from 'node:net';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';
import ora from 'ora';

import { DEFAULT_PORTS } from '../config/ports.js';
import { addSite } from '../config/sites.js';
import { DockerService } from '../services/docker.js';

// Define specific types to replace 'any'
type Spinner = ReturnType<typeof ora>;
type CommandFlags = Record<string, boolean | number | string | undefined>;

// Define validation result type with proper field ordering
interface ValidationResult {
  issues: string[];
  isValid: boolean;
}

export default class Init extends Command {
  static args = {
    name: Args.string({ description: 'Project name', required: true }),
  };
static description = 'Initialize a new WordPress project with your choice of WordPress version';
static examples = [
    '$ wp-spin init my-wordpress-site                             # Uses latest WordPress version',
    '$ wp-spin init my-wordpress-site --wordpress-version=6.4.2   # Installs specific WordPress version 6.4.2',
    '$ wp-spin init my-wordpress-site --site-name=pretty          # Creates a site with a friendly name "pretty"',
  ];
static flags = {
    force: Flags.boolean({ 
      char: 'f', 
      description: 'Force initialization even if directory exists' 
    }),
    'site-name': Flags.string({
      char: 's',
      description: 'Site name/alias to register for easy reference with --site flag',
      required: false,
    }),
    'wordpress-version': Flags.string({
      char: 'w',
      default: 'latest',
      description: 'WordPress version to install (e.g., 6.2, 5.9.3, latest). Use specific version numbers like "6.4.2" for a precise release, or "latest" for the most recent version.',
      required: false,
    }),
  };
protected docker: DockerService;
  private mysqlInitScriptPath: string = '';
  private wordpressVersion: string = 'latest';

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }
  
  // Methods in alphabetical order to satisfy perfectionist/sort-classes
  
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
    const { args, flags } = await this.parse(Init);
    const { name } = args;
    
    // Store the WordPress version from flag
    this.wordpressVersion = flags['wordpress-version'] || 'latest';

    const spinner = ora();
    const projectPath = join(process.cwd(), name);

    try {
      // Show WordPress version being used
      const versionDisplay = this.wordpressVersion === 'latest' ? 'latest version' : `version ${this.wordpressVersion}`;
      spinner.info(`Initializing WordPress project with ${versionDisplay}`);
      
      await this.prepareProjectDirectory(projectPath, flags.force);
      await this.ensureDockerEnvironment();
      
      // Initialize Docker service with new project path
      this.docker = new DockerService(projectPath);
      
      // Set up WordPress source
      const wordpressPath = join(projectPath, 'wordpress');
      await this.setupWordpressSource(wordpressPath, flags as CommandFlags, projectPath);
      
      // Setup Docker environment
      await this.setupDockerEnvironment(projectPath, wordpressPath);
      
      // Register site if name provided or use directory name
      const siteName = flags['site-name'] || name;
      const siteAdded = addSite(siteName, projectPath);
      
      if (siteAdded) {
        spinner.succeed(`Site registered with name: ${siteName}`);
        console.log(`You can now use ${chalk.blue(`--site=${siteName}`)} with any wp-spin command.`);
      } else {
        spinner.warn(`Site "${siteName}" already exists. Using existing name.`);
        console.log(`To update, use ${chalk.blue(`wp-spin sites update ${siteName} ${projectPath}`)}`);
      }
      
      // Display information to the user
      await this.displayProjectInfo(projectPath, wordpressPath);

    } catch (error) {
      spinner.fail('Failed to initialize project');
      if (error instanceof Error) {
        this.error(error.message);
      }

      this.error('Failed to initialize project');
    }
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
  private async createDockerComposeFile(projectPath: string): Promise<void> {
    // Get the default ports from our configuration
    let wordpressPort = DEFAULT_PORTS.WORDPRESS;
    let phpmyadminPort = DEFAULT_PORTS.PHPMYADMIN;
    
    // Apply any port mappings from the Docker service
    const portMappings = this.docker.getPortMappings();
    
    // Apply port mappings if available - use type assertions to avoid type errors
    if (portMappings[DEFAULT_PORTS.WORDPRESS]) {
      wordpressPort = portMappings[DEFAULT_PORTS.WORDPRESS] as typeof DEFAULT_PORTS.WORDPRESS;
    }
    
    if (portMappings[DEFAULT_PORTS.PHPMYADMIN]) {
      phpmyadminPort = portMappings[DEFAULT_PORTS.PHPMYADMIN] as typeof DEFAULT_PORTS.PHPMYADMIN;
    }
    
    // Ensure that we don't use the same port for both services
    // Convert to number before comparison
    if (Number(wordpressPort) === Number(phpmyadminPort)) {
      // If they're the same, increment one of them
      phpmyadminPort = (Number(wordpressPort) + 1) as typeof DEFAULT_PORTS.PHPMYADMIN;
      
      // Verify this new port is actually available
      try {
        // Use node:net import instead of require
        const server = net.createServer();
        await new Promise<void>((resolve) => {
          server.once('error', () => {
            phpmyadminPort = (Number(phpmyadminPort) + 1) as typeof DEFAULT_PORTS.PHPMYADMIN; // increment again if there's an error
            resolve();
          });
          
          server.once('listening', () => {
            server.close();
            resolve();
          });
          
          server.listen(Number(phpmyadminPort)); // Convert to number for the server
        });
      } catch {
        // If there's any error, just increment to be safe
        phpmyadminPort = (Number(phpmyadminPort) + 1) as typeof DEFAULT_PORTS.PHPMYADMIN;
      }
    }

    // Get project folder name for unique container names
    const projectName = projectPath.split('/').pop() || 'wp-spin';
    
    // Get platform-specific images with the specified WordPress version
    const architecture = arch();
    const isArm = architecture === 'arm64';
    const wordpressImageTag = this.wordpressVersion === 'latest' ? 'latest' : this.wordpressVersion;
    
    // Set the WordPress image based on architecture and version
    const wordpressImage = isArm 
      ? `arm64v8/wordpress:${wordpressImageTag}` 
      : `wordpress:${wordpressImageTag}`;

    const dockerComposeContent = `version: '3.8'

services:
  wordpress:
    image: ${wordpressImage}
    container_name: ${projectName}_wordpress
    restart: unless-stopped
    environment:
      - WORDPRESS_DB_HOST=mysql
      - WORDPRESS_DB_USER=wordpress
      - WORDPRESS_DB_PASSWORD=\${WORDPRESS_DB_PASSWORD}
      - WORDPRESS_DB_NAME=wordpress
    volumes:
      - ./wordpress:/var/www/html
    ports:
      - "${wordpressPort}:80"
    depends_on:
      - mysql
    security_opt:
      - no-new-privileges:true
    user: "www-data:www-data"
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
      - CHOWN
      - SETGID
      - SETUID
    read_only: true
    tmpfs:
      - /tmp
      - /run
      - /run/lock
      - /var/run/apache2

  mysql:
    image: ${isArm ? 'mariadb:10.6' : 'mysql:8.0'}
    container_name: ${projectName}_mysql
    restart: unless-stopped
    environment:
      - MYSQL_DATABASE=wordpress
      - MYSQL_USER=wordpress
      - MYSQL_PASSWORD=\${MYSQL_PASSWORD}
      - MYSQL_ROOT_PASSWORD=\${MYSQL_ROOT_PASSWORD}
    volumes:
      - ./mysql:/var/lib/mysql
      - ./mysql-files:/var/lib/mysql-files
      - ./mysql-init:/docker-entrypoint-initdb.d
    security_opt:
      - no-new-privileges:true
    # MariaDB is more tolerant with ARM platforms
    tmpfs:
      - /tmp
      - /run
      - /run/mysqld

  phpmyadmin:
    image: phpmyadmin/phpmyadmin
    platform: linux/amd64
    container_name: ${projectName}_phpmyadmin
    restart: unless-stopped
    environment:
      - PMA_HOST=mysql
      - PMA_USER=wordpress
      - PMA_PASSWORD=\${MYSQL_PASSWORD}
    ports:
      - "${phpmyadminPort}:80"
    depends_on:
      - mysql
    security_opt:
      - no-new-privileges:true
    user: "www-data:www-data"
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
      - CHOWN
      - SETGID
      - SETUID
    read_only: true
    tmpfs:
      - /tmp
      - /run
      - /var/run/apache2
      - /etc/phpmyadmin
      - /run/lock
      - /sessions`;

    await fs.writeFile(join(projectPath, 'docker-compose.yml'), dockerComposeContent);
    
    // Update the Docker service with these final port mappings
    if (wordpressPort !== DEFAULT_PORTS.WORDPRESS) {
      await this.docker.updateDockerComposePorts(DEFAULT_PORTS.WORDPRESS, wordpressPort);
    }
    
    if (phpmyadminPort !== DEFAULT_PORTS.PHPMYADMIN) {
      await this.docker.updateDockerComposePorts(DEFAULT_PORTS.PHPMYADMIN, phpmyadminPort);
    }
  }
  
  /**
   * Creates a Dockerfile for the WordPress project
   */
  private async createDockerfile(projectPath: string): Promise<void> {
    const dockerfileContent = `FROM wordpress:latest

# Set platform
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "I am running on $BUILDPLATFORM, building for $TARGETPLATFORM"

# Install dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    less \\
    && rm -rf /var/lib/apt/lists/*

# Install WP-CLI
RUN curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \\
    && chmod +x wp-cli.phar \\
    && mv wp-cli.phar /usr/local/bin/wp

# Configure PHP memory limits
RUN echo "memory_limit = 256M" > /usr/local/etc/php/conf.d/memory-limit.ini \\
    && echo "max_execution_time = 300" >> /usr/local/etc/php/conf.d/memory-limit.ini \\
    && echo "post_max_size = 64M" >> /usr/local/etc/php/conf.d/memory-limit.ini \\
    && echo "upload_max_filesize = 64M" >> /usr/local/etc/php/conf.d/memory-limit.ini

# Verify WP-CLI installation
RUN wp --info

# Set working directory
WORKDIR /var/www/html

# Copy WordPress files to a temporary location
RUN cp -r /usr/src/wordpress/. /tmp/wordpress/

# Create entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["apache2-foreground"]`;

    await fs.writeFile(join(projectPath, 'Dockerfile'), dockerfileContent);

    // Create custom entrypoint script
    const entrypointContent = `#!/bin/bash
set -euo pipefail

# If wordpress directory is empty, copy WordPress core files
if [ ! -f "/var/www/html/wp-config.php" ]; then
  echo "WordPress not found in /var/www/html - copying now..."
  cp -r /tmp/wordpress/. /var/www/html/
  echo "Complete! WordPress has been successfully copied to /var/www/html"
fi

# Ensure correct permissions
chown -R www-data:www-data /var/www/html
find /var/www/html -type d -exec chmod 755 {} \\;
find /var/www/html -type f -exec chmod 644 {} \\;

# Execute the original entrypoint script
exec docker-php-entrypoint "$@"`;

    await fs.writeFile(join(projectPath, 'docker-entrypoint.sh'), entrypointContent);
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
MYSQL_PASSWORD=${dbPassword}`;

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
    
    // Set strict permissions on sensitive files
    await fs.chmod(join(projectPath, '.env'), 0o600);
    await fs.chmod(join(projectPath, '.credentials.json'), 0o600);
    await fs.chmod(join(mysqlDir, 'init.sql'), 0o600);
  }
  
  /**
   * Displays information about the WordPress project after initialization
   */
  private async displayProjectInfo(projectPath: string, _wordpressPath: string): Promise<void> {
    const spinner = ora();
    
    try {
      // Get list of all containers in this project
      spinner.start('Getting project information...');
      
      // Get WordPress port from Docker service
      const portMappings = this.docker.getPortMappings();
      const wpPort = portMappings[DEFAULT_PORTS.WORDPRESS] || DEFAULT_PORTS.WORDPRESS;
      
      // Get name of current directory
      const projectName = projectPath.split('/').pop() || 'wordpress-site';
      
      // Display info about how to access the site
      const wpUrl = `http://localhost:${wpPort}`;
      const adminUrl = `${wpUrl}/wp-admin`;
      
      spinner.succeed('WordPress environment is ready!');
      
      console.log('\n📊 Project Information:');
      console.log(`🌐 Site URL: ${chalk.blue(wpUrl)}`);
      console.log(`⚙️  Admin URL: ${chalk.blue(adminUrl)}`);
      console.log(`📁 Project directory: ${chalk.blue(projectPath)}`);
      
      // Additional information
      console.log('\n🚀 Getting Started:');
      console.log(`👉 To start your WordPress site:  ${chalk.blue(`cd ${projectName} && wp-spin start`)}`);
      console.log(`👉 To stop your WordPress site:   ${chalk.blue(`wp-spin stop`)}`);
      console.log(`👉 To check container status:     ${chalk.blue(`wp-spin status`)}`);
      console.log(`👉 To access shell:               ${chalk.blue(`wp-spin shell`)}`);
      
      console.log('\n🔐 Default Credentials:');
      console.log(`👤 Admin username: ${chalk.blue('admin')}`);
      console.log(`🔑 Admin password: ${chalk.blue('password')}`);
      console.log('   (You should change these after first login)');
      
      console.log('\n🎯 Next Steps:');
      console.log(`1. Browse to your WordPress site at ${chalk.blue(wpUrl)}`);
      console.log('2. Complete the WordPress setup process');
      console.log('3. Install your favorite plugins and themes using ' + chalk.blue('wp-spin plugin --add <name>') + ' and ' + chalk.blue('wp-spin theme --add <name>'));
      
    } catch (error) {
      spinner.fail('Could not display complete project information');
      console.error('Error:', error);
    }
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
    fs.mkdirSync(projectPath);
    spinner.succeed('Project directory created');

    // Create a .wp-spin file as a marker for project root
    fs.writeFileSync(join(projectPath, '.wp-spin'), JSON.stringify({
      createdAt: new Date().toISOString(),
      version: this.config.version,
    }, null, 2));

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
    
    // Use DockerService's checkPorts method to handle port conflicts
    await this.docker.checkPorts();

    // Create Dockerfile and entrypoint script
    spinner.start('Creating Docker configuration...');
    await this.createDockerfile(projectPath);
    spinner.succeed('Docker configuration created');

    // Create docker-compose.yml with the correct ports
    spinner.start('Creating docker-compose.yml...');
    await this.createDockerComposeFile(projectPath);
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
  
  /**
   * Set up WordPress source files
   */
  private async setupWordpressSource(wordpressPath: string, flags: CommandFlags, projectPath: string): Promise<void> {
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
      
      // Make sure important files are writable by WordPress container
      await execa('chmod', ['-R', '777', join(wordpressPath, 'wp-content')], {
        cwd: projectPath,
      });
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

  /**
   * Validates a directory to check if it contains a valid WordPress installation
   */
  private async validateWordPressDirectory(directoryPath: string): Promise<ValidationResult> {
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
      await fs.chmod(join(wordpressPath, 'wp-content'), 0o777);
      
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
        await fs.chmod(dirPath, 0o777);
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
}
