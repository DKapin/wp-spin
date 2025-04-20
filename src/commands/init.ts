import { Args, Command, Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import crypto from 'node:crypto';
import { join } from 'node:path';
import ora from 'ora';

import { DEFAULT_PORTS } from '../config/ports.js';
import { DockerService } from '../services/docker.js';

export default class Init extends Command {
  static args = {
    name: Args.string({ description: 'Project name', required: true }),
  };
static description = 'Initialize a new WordPress project';
static examples = [
    '$ wp-spin init my-wordpress-site',
    '$ wp-spin init my-wordpress-site --from-github',
  ];
static flags = {
    force: Flags.boolean({ char: 'f', description: 'Force initialization even if directory exists' }),
    'from-github': Flags.boolean({
      char: 'g',
      description: 'Import from a GitHub repository',
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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const { name } = args;
    const { 'from-github': fromGithub } = flags;

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

      // Check Docker environment
      await this.ensureDockerEnvironment();

      // Initialize Docker service with new project path
      this.docker = new DockerService(projectPath);

      // Check and configure ports before creating any files
      const ports = {
        phpmyadmin: 8085,
        wordpress: 8084
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
      fs.mkdirSync(wordpressPath);
      spinner.succeed('WordPress directory structure created');

      // Start the environment
      spinner.start('Starting WordPress environment...');
      await this.docker.start();
      spinner.succeed('WordPress environment started');

      console.log('\n🌍 Your WordPress site is ready!');
      console.log(chalk.blue(`   WordPress: http://localhost:${ports.wordpress}`));
      console.log(chalk.blue(`   phpMyAdmin: http://localhost:${ports.phpmyadmin}`));
      console.log('\n📝 Next steps:');
      console.log(`   1. Complete the WordPress installation at http://localhost:${ports.wordpress}`);
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
    const dockerComposeContent = `version: '3.8'

services:
  wordpress:
    image: wordpress:latest
    container_name: wordpress
    restart: unless-stopped
    environment:
      - WORDPRESS_DB_HOST=mysql
      - WORDPRESS_DB_USER=wordpress
      - WORDPRESS_DB_PASSWORD=\${WORDPRESS_DB_PASSWORD}
      - WORDPRESS_DB_NAME=wordpress
    volumes:
      - ./wordpress:/var/www/html
    ports:
      - "8080:80"
    depends_on:
      - mysql
    security_opt:
      - no-new-privileges:true
    user: "www-data:www-data"
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    read_only: true
    tmpfs:
      - /tmp
      - /run
      - /run/lock

  mysql:
    image: mysql:8.0
    container_name: mysql
    restart: unless-stopped
    environment:
      - MYSQL_DATABASE=wordpress
      - MYSQL_USER=wordpress
      - MYSQL_PASSWORD=\${MYSQL_PASSWORD}
      - MYSQL_ROOT_PASSWORD=\${MYSQL_ROOT_PASSWORD}
    volumes:
      - ./mysql:/var/lib/mysql
    security_opt:
      - no-new-privileges:true
    user: "mysql:mysql"
    cap_drop:
      - ALL
    cap_add:
      - SETGID
      - SETUID
    read_only: true
    tmpfs:
      - /tmp
      - /run
      - /run/lock

  phpmyadmin:
    image: phpmyadmin/phpmyadmin
    container_name: phpmyadmin
    restart: unless-stopped
    environment:
      - PMA_HOST=mysql
      - PMA_USER=wordpress
      - PMA_PASSWORD=\${MYSQL_PASSWORD}
    ports:
      - "8081:80"
    depends_on:
      - mysql
    security_opt:
      - no-new-privileges:true
    user: "www-data:www-data"
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    read_only: true
    tmpfs:
      - /tmp
      - /run
      - /run/lock`;

    await fs.writeFile(join(projectPath, 'docker-compose.yml'), dockerComposeContent);
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
    const wordpressPassword = this.generateSecurePassword();

    const envContent = `WORDPRESS_DB_HOST=mysql
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=${wordpressPassword}
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
        password: wordpressPassword,
        user: 'wordpress'
      }
    };
    
    await fs.writeFile(
      join(projectPath, '.credentials.json'),
      JSON.stringify(credentials, null, 2)
    );
    
    // Set strict permissions on sensitive files
    await fs.chmod(join(projectPath, '.env'), 0o600);
    await fs.chmod(join(projectPath, '.credentials.json'), 0o600);
  }

  private generateSecurePassword(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}
