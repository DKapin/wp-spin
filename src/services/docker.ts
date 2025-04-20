import { Command } from '@oclif/core';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { chmod, writeFile, unlink, mkdir } from 'node:fs/promises';
import boxen from 'boxen';
import chalk from 'chalk';
import { execa } from 'execa';
import * as fs from 'fs-extra';
import ora from 'ora';
import inquirer from 'inquirer';
import { DEFAULT_PORTS } from '../config/ports.js';

export class DockerService {
  private command?: Command;
  private spinner = ora();
  private architecture = arch();
  private platform = platform();
  private portMappings: Record<number, number> = {};
  private projectPath: string;

  constructor(projectPath: string, command?: Command) {
    this.projectPath = projectPath;
    if (command) {
      this.command = command;
    }
  }

  private prettyError(title: string, message: string, suggestion?: string): never {
    const errorBox = boxen(
      `${chalk.red.bold(title)}\n\n${message}${suggestion ? `\n\n${chalk.yellow('💡 Suggestion:')} ${suggestion}` : ''}`,
      {
        borderColor: 'red',
        borderStyle: 'round',
        margin: 1,
        padding: 1,
        title: 'Error',
        titleAlignment: 'center',
      }
    );

    console.error(errorBox);
    throw new Error(`${title}: ${message}`);
  }

  public async findNextAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    while (port < 65_535) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
      port++;
    }
    throw new Error('No available ports found');
  }

  private getDockerPath(path: string): string {
    return './wordpress';
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const { stdout } = await execa('lsof', ['-i', `:${port}`]);
      return stdout.trim() === '';
    } catch (error) {
      return true;
    }
  }

  private async runDockerCompose(args: string[]): Promise<void> {
    try {
      await execa('docker-compose', args, {
        cwd: this.projectPath,
        stdio: 'inherit',
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('command not found')) {
          this.prettyError(
            'Docker Compose Not Found',
            'Docker Compose is not installed on your system.',
            'Please install Docker Compose from https://docs.docker.com/compose/install/'
          );
        }
        this.prettyError(
          'Docker Compose Error',
          error.message,
          'Please check your Docker Compose configuration and try again.'
        );
      }
      this.prettyError(
        'Docker Compose Error',
        'An unknown error occurred while running Docker Compose.',
        'Please check your Docker installation and try again.'
      );
    }
  }

  private async updateDockerComposePorts(oldPort: number, newPort: number): Promise<void> {
    this.portMappings[oldPort] = newPort;
    const composePath = join(this.projectPath, 'docker-compose.yml');
    const composeContent = await fs.readFile(composePath, 'utf-8');
    const updatedContent = composeContent.replace(
      new RegExp(`:${oldPort}`, 'g'),
      `:${newPort}`
    );
    await fs.writeFile(composePath, updatedContent);
  }

  private getPlatformSpecificImages(): { [key: string]: string } {
    const isArm = this.architecture === 'arm64';
    return {
      wordpress: isArm ? 'arm64v8/wordpress:latest' : 'wordpress:latest',
      mysql: isArm ? 'arm64v8/mysql:8.0' : 'mysql:8.0',
      phpmyadmin: 'phpmyadmin:latest'
    };
  }

  private async updateDockerComposeImages(): Promise<void> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    let content = await fs.readFile(dockerComposePath, 'utf-8');
    const images = this.getPlatformSpecificImages();

    // Update image references in docker-compose.yml
    content = content.replace(
      /image: wordpress:latest/g,
      `image: ${images.wordpress}`
    );
    content = content.replace(
      /image: mysql:5.7/g,
      `image: ${images.mysql}`
    );
    content = content.replace(
      /image: phpmyadmin\/phpmyadmin/g,
      `image: ${images.phpmyadmin}`
    );

    await fs.writeFile(dockerComposePath, content);
  }

  async checkPorts(): Promise<void> {
    this.spinner.start('Checking ports...');
    const ports = Object.values(DEFAULT_PORTS);
    let portsChanged = false;
    
    const portConflicts = new Map<number, boolean>();
    for (const port of ports) {
      portConflicts.set(port, !await this.isPortAvailable(port));
    }
    
    for (const [port, isConflict] of portConflicts) {
      if (isConflict) {
        let nextPort = port + 1;
        while (nextPort < 65_535) {
          if (await this.isPortAvailable(nextPort)) {
            break;
          }
          nextPort++;
        }

        const { action } = await inquirer.prompt([
          {
            name: 'action',
            type: 'list',
            message: `Port ${port} is already in use. What would you like to do?`,
            choices: [
              {
                name: `Use next available port (${nextPort})`,
                value: 'next',
              },
              {
                name: 'Stop the current instance',
                value: 'stop',
              },
              {
                name: 'Cancel operation',
                value: 'cancel',
              },
            ],
          },
        ]);

        switch (action) {
          case 'next': {
            await this.updateDockerComposePorts(port, nextPort);
            portsChanged = true;
            console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
            break;
          }
          case 'stop': {
            const { stdout } = await execa('docker', ['ps', '--format', '{{.ID}}', '--filter', `publish=${port}`]);
            const containerId = stdout.trim();
            if (containerId) {
              await execa('docker', ['stop', containerId], { stdio: 'inherit' });
              console.log(chalk.green(`Stopped container ${containerId} using port ${port}`));
            } else {
              throw new Error('Could not find container using the port');
            }
            break;
          }
          case 'cancel': {
            throw new Error('Operation cancelled by user');
          }
          default: {
            throw new Error('Invalid action selected');
          }
        }
      }
    }

    if (portsChanged) {
      this.spinner.succeed('Ports reconfigured');
      console.log(chalk.blue('\nUpdated port mappings:'));
      Object.entries(this.portMappings).forEach(([original, newPort]) => {
        console.log(chalk.blue(`  ${original} -> ${newPort}`));
      });
    } else {
      this.spinner.succeed('Ports are available');
    }
  }

  async checkDockerInstalled(): Promise<void> {
    this.spinner.start('Checking Docker installation...');
    try {
      await execa('docker', ['--version'], { stdio: 'ignore' });
      this.spinner.succeed('Docker is installed');
    } catch {
      this.spinner.fail('Docker is not installed');
      this.prettyError(
        'Docker Not Found',
        'Docker is not installed on your system.',
        'Please install Docker from https://www.docker.com/get-started'
      );
    }
  }

  async checkDockerRunning(): Promise<void> {
    this.spinner.start('Checking Docker...');
    try {
      await execa('docker', ['info'], { stdio: 'ignore' });
      this.spinner.succeed('Docker is running');
    } catch {
      this.spinner.fail('Docker is not running');
      this.prettyError(
        'Docker Not Running',
        'Docker daemon is not running on your system.',
        'Please start Docker Desktop and try again.'
      );
    }
  }

  async checkDockerComposeInstalled(): Promise<void> {
    this.spinner.start('Checking Docker Compose installation...');
    try {
      await execa('docker-compose', ['--version'], { stdio: 'ignore' });
      this.spinner.succeed('Docker Compose is installed');
    } catch {
      this.spinner.fail('Docker Compose is not installed');
      this.prettyError(
        'Docker Compose Not Found',
        'Docker Compose is not installed on your system.',
        'Please install Docker Compose from https://docs.docker.com/compose/install/'
      );
    }
  }

  async checkDiskSpace(): Promise<void> {
    this.spinner.start('Checking disk space...');
    try {
      if (this.platform === 'win32') {
        // Windows disk space check
        const { stdout } = await execa('wmic', ['logicaldisk', 'get', 'size,freespace,caption'], { stdio: 'pipe' });
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes('C:')) {
            const [_, freeSpace] = line.trim().split(/\s+/);
            const freeSpaceGB = parseInt(freeSpace) / (1024 * 1024 * 1024);
            if (freeSpaceGB < 1) {
              this.spinner.fail('Insufficient disk space');
              this.prettyError(
                'Insufficient Disk Space',
                'Less than 1GB of disk space available.',
                'Please free up some disk space and try again.'
              );
            }
          }
        }
      } else {
        // Unix-like systems (macOS, Linux)
        const { stdout } = await execa('df', ['-h', this.projectPath]);
        const availableSpace = parseInt(stdout.split('\n')[1].split(/\s+/)[3]);
        if (availableSpace < 1) {
          this.spinner.fail('Insufficient disk space');
          this.prettyError(
            'Insufficient Disk Space',
            'Less than 1GB of disk space available.',
            'Please free up some disk space and try again.'
          );
        }
      }
      this.spinner.succeed('Sufficient disk space available');
    } catch (error) {
      this.spinner.fail('Failed to check disk space');
      // Continue anyway as this is not critical
    }
  }

  async checkMemory(): Promise<void> {
    this.spinner.start('Checking system memory...');
    try {
      if (this.platform === 'win32') {
        // Windows memory check
        const { stdout } = await execa('wmic', ['computersystem', 'get', 'TotalPhysicalMemory'], { stdio: 'pipe' });
        const totalMemory = parseInt(stdout.split('\n')[1].trim()) / (1024 * 1024 * 1024);
        if (totalMemory < 2) {
          this.spinner.fail('Insufficient memory');
          this.prettyError(
            'Insufficient Memory',
            'Less than 2GB of RAM available.',
            'Please upgrade your system memory and try again.'
          );
        }
      } else {
        // Unix-like systems (macOS, Linux)
        const { stdout } = await execa('free', ['-g'], { stdio: 'pipe' });
        const totalMemory = parseInt(stdout.split('\n')[1].split(/\s+/)[1]);
        if (totalMemory < 2) {
          this.spinner.fail('Insufficient memory');
          this.prettyError(
            'Insufficient Memory',
            'Less than 2GB of RAM available.',
            'Please upgrade your system memory and try again.'
          );
        }
      }
      this.spinner.succeed('Sufficient memory available');
    } catch (error) {
      this.spinner.fail('Failed to check memory');
      // Continue anyway as this is not critical
    }
  }

  async checkProjectExists(): Promise<boolean> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    return await fs.pathExists(dockerComposePath);
  }

  private async createDockerCompose(): Promise<void> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    const wordpressPath = './wordpress'; // Use relative path
    const images = this.getPlatformSpecificImages();
    const isArm = this.architecture === 'arm64';
    
    const compose = {
      version: '3',
      services: {
        wordpress: {
          image: images.wordpress,
          ports: ['8084:80'],
          environment: {
            WORDPRESS_DB_HOST: 'mysql',
            WORDPRESS_DB_USER: 'wordpress',
            WORDPRESS_DB_PASSWORD: 'wordpress',
            WORDPRESS_DB_NAME: 'wordpress',
          },
          volumes: [
            `${wordpressPath}:/var/www/html`,
          ],
          depends_on: ['mysql'],
        },
        mysql: {
          image: images.mysql,
          environment: {
            MYSQL_ROOT_PASSWORD: 'root',
            MYSQL_DATABASE: 'wordpress',
            MYSQL_USER: 'wordpress',
            MYSQL_PASSWORD: 'wordpress',
          },
          volumes: ['mysql_data:/var/lib/mysql'],
        },
        phpmyadmin: {
          image: images.phpmyadmin,
          platform: isArm ? 'linux/amd64' : undefined,
          ports: ['8085:80'],
          environment: {
            PMA_HOST: 'mysql',
            MYSQL_ROOT_PASSWORD: 'root',
          },
          depends_on: ['mysql'],
        },
      },
      volumes: {
        mysql_data: {},
      },
    };

    try {
      const yamlContent = JSON.stringify(compose, null, 2)
        .replace(/"([^"]+)":/g, '$1:') // Remove quotes from keys
        .replace(/undefined/g, ''); // Remove undefined values
      
      await fs.writeFile(dockerComposePath, yamlContent);
      this.spinner.succeed('docker-compose.yml created');
    } catch (error) {
      this.spinner.fail('Failed to create docker-compose.yml');
      if (error instanceof Error) {
        this.prettyError(
          'Docker Compose Error',
          `Failed to create docker-compose.yml: ${error.message}`,
          'Please check your file permissions and try again.'
        );
      }
      throw error;
    }
  }

  private async ensureWordPressDirectory(): Promise<void> {
    const wordpressPath = join(this.projectPath, 'wordpress');
    
    try {
      // Create directory if it doesn't exist
      await mkdir(wordpressPath, { recursive: true });
      
      // Set directory permissions to 755 (rwxr-xr-x)
      await chmod(wordpressPath, 0o755);
      
      // Create a test file to verify write permissions
      const testFile = join(wordpressPath, '.test');
      await writeFile(testFile, 'test');
      await unlink(testFile);
      
      this.spinner.succeed('WordPress directory verified');
    } catch (error) {
      this.spinner.fail('Failed to create WordPress directory');
      if (error instanceof Error) {
        this.prettyError(
          'Directory Error',
          `Failed to create WordPress directory: ${error.message}`,
          'Please check your file permissions and try again.'
        );
      }
      throw error;
    }
  }

  async start(): Promise<void> {
    this.spinner.start('Starting WordPress environment...');
    try {
      // Ensure WordPress directory exists with correct permissions
      await this.ensureWordPressDirectory();
      
      // Start the containers
      await this.runDockerCompose(['up', '-d']);
      
      // Wait for MySQL to be ready
      await this.waitForMySQL();
      
      this.spinner.succeed('WordPress environment started');
    } catch (error) {
      this.spinner.fail('Failed to start WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Start Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Start Error',
        'Failed to start WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async stop(): Promise<void> {
    this.spinner.start('Stopping WordPress environment...');
    try {
      await this.runDockerCompose(['down']);
      this.spinner.succeed('WordPress environment stopped');
    } catch (error) {
      this.spinner.fail('Failed to stop WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Stop Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Stop Error',
        'Failed to stop WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async restart(): Promise<void> {
    this.spinner.start('Restarting WordPress environment...');
    try {
      await this.runDockerCompose(['restart']);
      this.spinner.succeed('WordPress environment restarted');
    } catch (error) {
      this.spinner.fail('Failed to restart WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Restart Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Restart Error',
        'Failed to restart WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async logs(): Promise<void> {
    try {
      await this.runDockerCompose(['logs', '-f']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Logs Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Logs Error',
        'Failed to view logs',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async status(): Promise<void> {
    try {
      await this.runDockerCompose(['ps']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Status Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Status Error',
        'Failed to check status',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async shell(): Promise<void> {
    try {
      await this.runDockerCompose(['exec', 'wordpress', 'bash']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Shell Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }
      this.prettyError(
        'Shell Error',
        'Failed to open shell',
        'Please check your Docker installation and try again.'
      );
    }
  }

  private async waitForMySQL(): Promise<void> {
    this.spinner.start('Waiting for MySQL to be ready...');
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        await execa('docker-compose', ['exec', '-T', 'mysql', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'root', '-proot'], {
          cwd: this.projectPath,
          stdio: 'ignore',
        });
        this.spinner.succeed('MySQL is ready');
        return;
      } catch {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.spinner.fail('MySQL failed to start');
    this.prettyError(
      'MySQL Error',
      'MySQL failed to start within the expected time.',
      'Please check your Docker configuration and try again.'
    );
  }
} 