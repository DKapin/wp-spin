import { Args, Command, Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import crypto from 'node:crypto';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { DEFAULT_PORTS } from '../config/ports.js';

export default class Init extends Command {
  static args = {
    name: Args.string({ description: 'Project name', required: true }),
  };
static description = 'Initialize a new WordPress project';
static examples = [
    '$ wp-spin init my-wordpress-site',
    '$ wp-spin init my-wordpress-site --from-github https://github.com/user/wp-repo',
    '$ wp-spin init my-wordpress-site --from-current-dir',
  ];
static flags = {
    'from-current-dir': Flags.boolean({
      char: 'c',
      description: 'Use the current directory as the WordPress source if it contains a valid installation',
      required: false,
    }),
    force: Flags.boolean({ 
      char: 'f', 
      description: 'Force initialization even if directory exists' 
    }),
    'from-github': Flags.string({
      char: 'g',
      description: 'Import from a GitHub repository containing a WordPress installation',
      required: false,
    }),
  };
protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

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
   * Checks the system platform and architecture
   * Provides warnings or informational messages based on system architecture
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
    
    if (platformType === 'darwin') {
      // macOS-specific checks
      console.log(chalk.blue('ℹ️ macOS detected'));
      console.log(chalk.blue('  - Using Docker Desktop for macOS'));
    } else if (platformType === 'linux') {
      console.log(chalk.blue('ℹ️ Linux detected'));
    } else if (platformType === 'win32') {
      console.log(chalk.blue('ℹ️ Windows detected'));
      console.log(chalk.blue('  - Using Docker Desktop for Windows'));
      console.log(chalk.yellow('  - Path mapping may differ from Unix-based systems'));
    }
  }
  
  /**
   * Clones a GitHub repository to a temporary directory
   * @param repoUrl GitHub repository URL
   * @returns Path to the cloned repository
   */
  private async cloneGitHubRepo(repoUrl: string): Promise<string> {
    const spinner = ora('Cloning GitHub repository...').start();
    const tempDir = join(tmpdir(), `wp-spin-${Date.now()}`);
    
    try {
      await fs.ensureDir(tempDir);
      await execa('git', ['clone', repoUrl, tempDir, '--depth', '1']);
      spinner.succeed('Repository cloned successfully');
      return tempDir;
    } catch (error) {
      spinner.fail('Failed to clone repository');
      if (error instanceof Error) {
        throw new TypeError(`Failed to clone repository: ${error.message}`);
      }
      
      throw new TypeError('Failed to clone repository');
    }
  }
  
  /**
   * Copies WordPress files from source to destination
   * @param sourcePath Source directory with WordPress files
   * @param destinationPath Destination directory
   */
  private async copyWordPressFiles(sourcePath: string, destinationPath: string): Promise<void> {
    const spinner = ora('Copying WordPress files...').start();
    
    try {
      await fs.copy(sourcePath, destinationPath, {
        filter: src => !src.includes('.git') && 
                !src.includes('node_modules') &&
                !src.includes('.github')
      });
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
   * Validates if a directory contains a WordPress installation
   * @param directoryPath Path to check for WordPress files
   * @returns Object with validation result and details
   */
  private async validateWordPressDirectory(directoryPath: string): Promise<{isValid: boolean; issues: string[]}> {
    const issues: string[] = [];
    
    // Check for key WordPress files and directories
    const requiredFiles = [
      'wp-config.php',
      'wp-content',
      'wp-includes',
      'wp-admin'
    ];
    
    for (const file of requiredFiles) {
      const filePath = join(directoryPath, file);
      if (!fs.existsSync(filePath)) {
        issues.push(`Missing WordPress component: ${file}`);
      }
    }
    
    // Additional checks could be added here
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const { name } = args;
    
    // Handle flag conflicts
    if (flags['from-github'] && flags['from-current-dir']) {
      this.error('Cannot use both --from-github and --from-current-dir flags simultaneously');
      return;
    }

    const spinner = ora();
    const projectPath = join(process.cwd(), name);

    try {
      // Check if directory exists
      if (fs.existsSync(projectPath)) {
        if (flags.force) {
          spinner.start('Removing existing project directory...');
          fs.removeSync(projectPath);
          spinner.succeed('Existing project directory removed');
        } else {
          this.error(`Directory ${name} already exists`);
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

      // Check Docker environment
      await this.ensureDockerEnvironment();

      // Initialize Docker service with new project path
      this.docker = new DockerService(projectPath);
      
      let wordpressSourcePath: string | null = null;
      
      // Handle --from-github flag
      if (flags['from-github']) {
        const repoUrl = flags['from-github'];
        try {
          const tempRepoPath = await this.cloneGitHubRepo(repoUrl);
          
          // Validate that it contains WordPress files
          const validation = await this.validateWordPressDirectory(tempRepoPath);
          
          if (!validation.isValid) {
            spinner.warn('Repository does not appear to contain a valid WordPress installation');
            console.log('Issues found:');
            validation.issues.forEach(issue => console.log(` - ${issue}`));
            
            // Ask user if they want to continue anyway
            const { proceed } = await inquirer.prompt([{
              type: 'confirm',
              name: 'proceed',
              message: 'Continue anyway?',
              default: false
            }]);
            
            if (!proceed) {
              await fs.remove(tempRepoPath);
              throw new TypeError('Aborted due to invalid WordPress installation in repository');
            }
          }
          
          wordpressSourcePath = tempRepoPath;
        } catch (error) {
          if (error instanceof Error) {
            throw new TypeError(`GitHub repository error: ${error.message}`);
          }
          throw new TypeError('Failed to process GitHub repository');
        }
      }
      
      // Handle --from-current-dir flag
      if (flags['from-current-dir']) {
        const currentDir = process.cwd();
        
        // Validate current directory
        const validation = await this.validateWordPressDirectory(currentDir);
        
        if (!validation.isValid) {
          spinner.warn('Current directory does not appear to contain a valid WordPress installation');
          console.log('Issues found:');
          validation.issues.forEach(issue => console.log(` - ${issue}`));
          
          // Ask user if they want to continue anyway
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Continue anyway?',
            default: false
          }]);
          
          if (!proceed) {
            throw new TypeError('Aborted due to invalid WordPress installation in current directory');
          }
        }
        
        wordpressSourcePath = currentDir;
      }

      // Use the ports from the configuration
      const ports = {
        wordpress: DEFAULT_PORTS.WORDPRESS,
        phpmyadmin: DEFAULT_PORTS.PHPMYADMIN,
        mysql: DEFAULT_PORTS.MYSQL
      };

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

      // Create directory structure
      spinner.start('Creating WordPress directory structure...');
      const wordpressPath = join(projectPath, 'wordpress');
      const mysqlPath = join(projectPath, 'mysql');
      const mysqlFilesPath = join(projectPath, 'mysql-files');
      fs.mkdirSync(wordpressPath);
      fs.mkdirSync(mysqlPath);
      fs.mkdirSync(mysqlFilesPath);
      spinner.succeed('WordPress directory structure created');
      
      // If we have WordPress source files, copy them
      if (wordpressSourcePath) {
        await this.copyWordPressFiles(
          wordpressSourcePath, 
          wordpressPath
        );
        
        // If this was a temp github dir, clean it up
        if (flags['from-github'] && wordpressSourcePath.includes(tmpdir())) {
          await fs.remove(wordpressSourcePath);
        }
      }
      
      // Build Docker images if needed
      await this.buildDockerImages(projectPath);

      // Start the environment
      spinner.start('Starting WordPress environment...');
      await this.docker.start();
      spinner.succeed('WordPress environment started');

      // Get the actual used ports
      const portMappings = this.docker.getPortMappings();
      
      // Use the configured ports from the Docker Compose file
      // with fallback to the DEFAULT_PORTS values
      const dockerComposeYml = await fs.readFile(join(projectPath, 'docker-compose.yml'), 'utf8');
      
      // Extract ports from Docker Compose file
      const wordpressPortMatch = dockerComposeYml.match(/wordpress.*?ports:\s*-\s*"(\d+):80"/s);
      const phpmyadminPortMatch = dockerComposeYml.match(/phpmyadmin.*?ports:\s*-\s*"(\d+):80"/s);
      
      const actualWordpressPort = wordpressPortMatch ? wordpressPortMatch[1] : 
                                  (portMappings[DEFAULT_PORTS.WORDPRESS] || DEFAULT_PORTS.WORDPRESS);
      
      const actualPhpMyAdminPort = phpmyadminPortMatch ? phpmyadminPortMatch[1] : 
                                   (portMappings[DEFAULT_PORTS.PHPMYADMIN] || DEFAULT_PORTS.PHPMYADMIN);

      console.log('\n🌍 Your WordPress site is ready!');
      console.log(chalk.blue(`   WordPress: http://localhost:${actualWordpressPort}`));
      console.log(chalk.blue(`   phpMyAdmin: http://localhost:${actualPhpMyAdminPort}`));
      console.log('\n📝 Next steps:');
      console.log(`   1. Complete the WordPress installation at http://localhost:${actualWordpressPort}`);
      console.log('   2. Use `wp-spin plugin:add` to install plugins');
      console.log('   3. Use `wp-spin theme:add` to install themes');
      console.log('   4. Use `wp-spin stop` to stop the environment when done');
      console.log('\n💡 Your WordPress files are located in:');
      console.log(chalk.green(`   ${wordpressPath}`));
      console.log('   Any changes you make to these files will be reflected immediately in your site.');

    } catch (error) {
      spinner.fail('Failed to initialize project');
      if (error instanceof Error) {
        this.error(error.message);
      }

      this.error('Failed to initialize project');
    }
  }

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
      } catch (_error) {
        // If there's any error, just increment to be safe
        phpmyadminPort = (Number(phpmyadminPort) + 1) as typeof DEFAULT_PORTS.PHPMYADMIN;
      }
    }

    // Get project folder name for unique container names
    const projectName = projectPath.split('/').pop() || 'wp-spin';

    const dockerComposeContent = `version: '3.8'

services:
  wordpress:
    image: wordpress:latest
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
    image: mariadb:10.6
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
      - /run/lock`;

    await fs.writeFile(join(projectPath, 'docker-compose.yml'), dockerComposeContent);
    
    // Update the Docker service with these final port mappings
    if (wordpressPort !== DEFAULT_PORTS.WORDPRESS) {
      await this.docker.updateDockerComposePorts(DEFAULT_PORTS.WORDPRESS, wordpressPort);
    }
    
    if (phpmyadminPort !== DEFAULT_PORTS.PHPMYADMIN) {
      await this.docker.updateDockerComposePorts(DEFAULT_PORTS.PHPMYADMIN, phpmyadminPort);
    }
  }

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

  // Add this property to the class to store the MySQL init script path
  private mysqlInitScriptPath: string = '';

  private generateSecurePassword(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Builds Docker images if necessary (especially for ARM architectures)
   * @param projectPath Path to the project directory
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
        
        // Pull WordPress ARM image
        await execa('docker', ['pull', 'arm64v8/wordpress:latest'], {
          cwd: projectPath,
        });
        
        spinner.succeed('Docker images pulled successfully for ARM64 architecture');
        
        // Log the process
        console.log(chalk.blue('ℹ️ For ARM architecture:'));
        console.log(chalk.blue('  - Pulled phpMyAdmin image with linux/amd64 platform specification'));
        console.log(chalk.blue('  - Pulled MariaDB 10.6 for better ARM compatibility'));
        console.log(chalk.blue('  - Pulled ARM-specific WordPress image'));
        console.log(chalk.blue('  - This ensures compatibility with your system'));
      } else {
        // For Intel/AMD architectures, just pull the images
        await execa('docker', ['pull', 'phpmyadmin/phpmyadmin'], {
          cwd: projectPath,
        });
        
        await execa('docker', ['pull', 'mysql:8.0'], {
          cwd: projectPath,
        });
        
        await execa('docker', ['pull', 'wordpress:latest'], {
          cwd: projectPath,
        });
        
        spinner.succeed('Docker images pulled successfully');
      }
    } catch (error) {
      spinner.warn('Docker image building/pulling encountered issues');
      console.log(chalk.yellow('  - Will attempt to continue with Docker Compose'));
    }
  }
}
