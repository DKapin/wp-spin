import { Args, Command, Flags, Config } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import { join } from 'node:path';
import ora from 'ora';
import { DockerService } from '../services/docker.js';
import { DEFAULT_PORTS } from '../config/ports.js';

export default class Init extends Command {
  static description = 'Initialize a new WordPress project';

  static examples = [
    '$ wp-spin init my-wordpress-site',
    '$ wp-spin init my-wordpress-site --from-github',
  ];

  static flags = {
    'from-github': Flags.boolean({
      char: 'g',
      description: 'Import from a GitHub repository',
      required: false,
    }),
    force: Flags.boolean({ char: 'f', description: 'Force initialization even if directory exists' }),
  };

  static args = {
    name: Args.string({ description: 'Project name', required: true }),
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

  private async createDockerComposeFile(projectPath: string): Promise<void> {
    const isArm64 = process.arch === 'arm64';
    const dockerComposeContent = `version: '3'
services:
  wordpress:
    build: .
    platform: linux/${isArm64 ? 'arm64' : 'amd64'}
    ports:
      - "${DEFAULT_PORTS.WORDPRESS}:80"
    environment:
      WORDPRESS_DB_HOST: mysql
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - ./wordpress:/var/www/html
    depends_on:
      - mysql

  mysql:
    image: mysql:8.0
    platform: linux/${isArm64 ? 'arm64' : 'amd64'}
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
    volumes:
      - mysql_data:/var/lib/mysql

  phpmyadmin:
    image: arm64v8/phpmyadmin:latest
    ports:
      - "${DEFAULT_PORTS.PHPMYADMIN}:80"
    environment:
      PMA_HOST: mysql
      UPLOAD_LIMIT: 64M
    depends_on:
      - mysql

volumes:
  mysql_data:`;

    await fs.writeFile(join(projectPath, 'docker-compose.yml'), dockerComposeContent);
  }

  private async createEnvFile(projectPath: string): Promise<void> {
    const envContent = `WORDPRESS_DB_HOST=mysql
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=wordpress
WORDPRESS_DB_NAME=wordpress
MYSQL_ROOT_PASSWORD=root
MYSQL_DATABASE=wordpress
MYSQL_USER=wordpress
MYSQL_PASSWORD=wordpress`;

    await fs.writeFile(join(projectPath, '.env'), envContent);
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
        wordpress: 8084,
        phpmyadmin: 8085
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
}
