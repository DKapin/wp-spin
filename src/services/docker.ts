import { Command } from '@oclif/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { execa } from 'execa';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { access, chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import ora from 'ora';

import { DEFAULT_PORTS } from '../config/ports.js';
import { IDockerService } from './docker-interface.js';

export class DockerService implements IDockerService {
  private architecture = arch();
  private command?: Command;
  private platform = platform();
  private portMappings: Record<number, number> = {};
  private projectPath: string;
  private spinner = ora();

  constructor(projectPath: string, command?: Command) {
    this.projectPath = projectPath;
    if (command) {
      this.command = command;
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
            const parts = line.trim().split(/\s+/);
            const freeSpace = parts[1];
            const freeSpaceGB = Number.parseInt(freeSpace, 10) / (1024 * 1024 * 1024);
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
        const availableSpace = Number.parseInt(stdout.split('\n')[1].split(/\s+/)[3], 10);
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
    } catch {
      this.spinner.fail('Failed to check disk space');
      // Continue anyway as this is not critical
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

  async checkMemory(): Promise<void> {
    this.spinner.start('Checking system memory...');
    try {
      if (this.platform === 'win32') {
        // Windows memory check
        const { stdout } = await execa('wmic', ['computersystem', 'get', 'TotalPhysicalMemory'], { stdio: 'pipe' });
        const totalMemory = Number.parseInt(stdout.split('\n')[1].trim(), 10) / (1024 * 1024 * 1024);
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
        const totalMemory = Number.parseInt(stdout.split('\n')[1].split(/\s+/)[1], 10);
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
    } catch {
      this.spinner.fail('Failed to check memory');
      // Continue anyway as this is not critical
    }
  }

  async checkPorts(): Promise<void> {
    this.spinner.start('Checking ports...');
    const ports = Object.values(DEFAULT_PORTS);
    let portsChanged = false;
    
    // Track conflicts for all ports up front
    const portConflicts = new Map<number, boolean>();
    const portReplacements = new Map<number, number>();
    const usedPorts = new Set<number>();
    
    // Check all ports first and store results
    for (const port of ports) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const available = await this.isPortAvailable(port);
        portConflicts.set(port, !available);
        
        // If port is not available, find next available port immediately
        if (!available) {
          // eslint-disable-next-line no-await-in-loop
          let nextPort = await this.findNextAvailablePort(port, usedPorts);
          // Keep searching until we find a port that's not already assigned
          while (usedPorts.has(nextPort)) {
            // eslint-disable-next-line no-await-in-loop
            nextPort = await this.findNextAvailablePort(nextPort, usedPorts);
          }
          
          portReplacements.set(port, nextPort);
          usedPorts.add(nextPort);
          
          // Update docker-compose immediately to ensure consistent state
          // eslint-disable-next-line no-await-in-loop
          await this.updateDockerComposePorts(port, nextPort);
          portsChanged = true;
          console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
        } else {
          // If the port is available, mark it as used so we don't assign it elsewhere
          usedPorts.add(port);
        }
      } catch (error) {
        this.spinner.warn(`Error checking port ${port}: ${error instanceof Error ? error.message : String(error)}`);
        // Assume port is unavailable if we can't check it properly
        // eslint-disable-next-line no-await-in-loop
        const nextPort = await this.findNextAvailablePort(port + 1, usedPorts);
        portReplacements.set(port, nextPort);
        usedPorts.add(nextPort);
        // eslint-disable-next-line no-await-in-loop
        await this.updateDockerComposePorts(port, nextPort);
        portsChanged = true;
        console.log(chalk.yellow(`Port ${port} couldn't be checked properly, using port ${nextPort} instead`));
      }
    }
    
    // Handle interactive and non-interactive environments
    if (process.env.NODE_ENV?.includes('test') || !process.stdin.isTTY) {
      // Skip interactive prompts in test environments or non-interactive terminals
    } else {
      // Handle conflicts with user prompts for each port
      for (const [port, isConflict] of portConflicts.entries()) {
        if (isConflict && !portReplacements.has(port)) {
          // eslint-disable-next-line no-await-in-loop
          const nextPort = await this.findNextAvailablePort(port, usedPorts);
          usedPorts.add(nextPort);
          
          // Check if Docker is using the port
          let processInfo;
          try {
            // Try to get Docker container info first
            // eslint-disable-next-line no-await-in-loop
            const { stdout: dockerOutput } = await execa('docker', ['ps', '--format', '{{.Names}} ({{.Image}})', '--filter', `publish=${port}`], { reject: false, stdio: 'pipe' });
            
            if (dockerOutput && dockerOutput.trim()) {
              processInfo = `Docker container: ${dockerOutput.trim()}`;
            } else {
              // If not Docker, try to get general process info
              if (this.platform === 'darwin' || this.platform === 'linux') {
                // For macOS and Linux
                // eslint-disable-next-line no-await-in-loop
                const { stdout: lsofOutput } = await execa('lsof', ['-i', `:${port}`], { reject: false, stdio: 'pipe' });
                if (lsofOutput) {
                  const lines = lsofOutput.split('\n').filter(Boolean);
                  if (lines.length > 1) {
                    const parts = lines[1].split(/\s+/);
                    processInfo = `Process: ${parts[0]} (PID: ${parts[1]})`;
                  }
                }
              } else if (this.platform === 'win32') {
                // For Windows
                // eslint-disable-next-line no-await-in-loop
                const { stdout: netstatOutput } = await execa('netstat', ['-ano', '|', 'findstr', `:${port}`], { reject: false, shell: true, stdio: 'pipe' });
                if (netstatOutput) {
                  const lines = netstatOutput.split('\n').filter(Boolean);
                  if (lines.length > 0) {
                    const parts = lines[0].trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    processInfo = `Process with PID: ${pid}`;
                  }
                }
              }
            }
          } catch {
            // If we can't get process info, just continue with generic message
            processInfo = 'unknown process';
          }
          
          // In non-test environment, prompt user for action
          let action: 'next' | 'stop' | 'cancel' = 'next';
          
          try {
            // Ask user what to do about the port conflict
            const choices = [
              { name: `Use next available port (${nextPort})`, value: 'next' },
              { name: 'Cancel operation', value: 'cancel' }
            ];
            
            // Only add stop option if we found a Docker container
            if (processInfo && processInfo.includes('Docker container')) {
              choices.splice(1, 0, { name: `Stop the process using port ${port} (${processInfo})`, value: 'stop' });
            }
            
            const responses = await inquirer.prompt([
              {
                choices,
                message: `Port ${port} is already in use${processInfo ? ` by ${processInfo}` : ''}. What would you like to do?`,
                name: 'action',
                type: 'list',
              },
            ]);
            
            action = responses.action;
          } catch {
             // If inquirer fails for any reason, use default action
             console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
             action = 'next';
          }
  
          switch (action) {
            case 'next': {
              // eslint-disable-next-line no-await-in-loop
              await this.updateDockerComposePorts(port, nextPort);
              portsChanged = true;
              console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
              break;
            }
  
            case 'stop': {
              try {
                // eslint-disable-next-line no-await-in-loop
                const { stdout } = await execa('docker', ['ps', '--format', '{{.ID}}', '--filter', `publish=${port}`]);
                const containerId = stdout.trim();
                if (containerId) {
                  this.spinner.start(`Stopping container ${containerId} using port ${port}...`);
                  // eslint-disable-next-line no-await-in-loop
                  await execa('docker', ['stop', containerId]);
                  this.spinner.succeed(`Stopped container ${containerId} using port ${port}`);
                  
                  // Verify the port is now available
                  // eslint-disable-next-line no-await-in-loop
                  const isNowAvailable = await this.isPortAvailable(port);
                  if (isNowAvailable) {
                    // Port is now available, so we can use it
                    usedPorts.add(port);
                  } else {
                    console.log(chalk.yellow(`Port ${port} is still in use after stopping the container. Using port ${nextPort} instead.`));
                    // eslint-disable-next-line no-await-in-loop
                    await this.updateDockerComposePorts(port, nextPort);
                    portsChanged = true;
                  }
                } else {
                  console.log(chalk.yellow(`No Docker container found using port ${port}. Using port ${nextPort} instead.`));
                  // eslint-disable-next-line no-await-in-loop
                  await this.updateDockerComposePorts(port, nextPort);
                  portsChanged = true;
                }
              } catch (error) {
                this.spinner.fail(`Failed to stop container on port ${port}`);
                console.log(chalk.yellow(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
                console.log(chalk.yellow(`Using port ${nextPort} instead.`));
                // eslint-disable-next-line no-await-in-loop
                await this.updateDockerComposePorts(port, nextPort);
                portsChanged = true;
              }
              break;
            }
  
            case 'cancel': {
              this.spinner.fail('Operation cancelled by user');
              throw new Error('Operation cancelled by user');
            }
  
            default: {
              this.spinner.fail('Invalid action selected');
              throw new Error('Invalid action selected');
            }
          }
        }
      }
    }

    if (portsChanged) {
      this.spinner.succeed('Ports reconfigured');
      console.log(chalk.blue('\nUpdated port mappings:'));
      for (const [original, newPort] of Object.entries(this.portMappings)) {
        console.log(chalk.blue(`  ${original} -> ${newPort}`));
      }
    } else {
      this.spinner.succeed('Ports are available');
    }
  }

  async checkProjectExists(): Promise<boolean> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    try {
      await readFile(dockerComposePath);
      return true;
    } catch {
      return false;
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

  async shell(): Promise<void> {
    try {
      // Use the service name (wordpress) instead of container name to avoid conflicts
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

  private async createDockerCompose(): Promise<void> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    const wordpressPath = './wordpress'; // Use relative path
    const images = this.getPlatformSpecificImages();
    const isArm = this.architecture === 'arm64';
    
    // Get WordPress port (use mapping if available or default)
    const wordpressPort = this.portMappings[DEFAULT_PORTS.WORDPRESS] || DEFAULT_PORTS.WORDPRESS;
    
    // Get phpMyAdmin port (use mapping if available or default)
    const phpmyadminPort = this.portMappings[DEFAULT_PORTS.PHPMYADMIN] || DEFAULT_PORTS.PHPMYADMIN;
    
    // Get MySQL port (use mapping if available or default)
    const mysqlPort = this.portMappings[DEFAULT_PORTS.MYSQL] || DEFAULT_PORTS.MYSQL;
    
    const compose = {
      services: {
        mysql: {
          environment: {
            MYSQL_DATABASE: 'wordpress',
            MYSQL_PASSWORD: 'wordpress',
            MYSQL_ROOT_PASSWORD: 'root',
            MYSQL_USER: 'wordpress',
          },
          image: images.mysql,
          volumes: ['mysqlData:/var/lib/mysql'],
        },
        phpmyadmin: {
          dependsOn: ['mysql'],
          environment: {
            MYSQL_ROOT_PASSWORD: 'root',
            PMA_HOST: 'mysql',
          },
          image: images.phpmyadmin,
          platform: 'linux/amd64',
          ports: [`${phpmyadminPort}:80`],
        },
        wordpress: {
          dependsOn: ['mysql'],
          environment: {
            WORDPRESS_DB_HOST: 'mysql',
            WORDPRESS_DB_NAME: 'wordpress',
            WORDPRESS_DB_PASSWORD: 'wordpress',
            WORDPRESS_DB_USER: 'wordpress',
          },
          image: images.wordpress,
          ports: [`${wordpressPort}:80`],
          volumes: [
            `${wordpressPath}:/var/www/html`,
          ],
        },
      },
      version: '3',
      volumes: {
        mysqlData: {},
      },
    };

    try {
      const yamlContent = JSON.stringify(compose, null, 2)
        .replaceAll(/"([^"]+)":/g, '$1:') // Remove quotes from keys
        .replaceAll('undefined', ''); // Remove undefined values
      
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

  private async findNextAvailablePort(port: number, usedPorts = new Set<number>()): Promise<number> {
    let nextPort = port + 1;
    
    // Check ports sequentially to avoid multiple awaits in loop
    while (nextPort < 65_535) {
      // Skip if we've already decided to use this port for another service
      if (usedPorts.has(nextPort)) {
        nextPort += 1;
        continue;
      }
      
      // eslint-disable-next-line no-await-in-loop
      const isAvailable = await this.isPortAvailable(nextPort);
      
      if (isAvailable) {
        return nextPort;
      }
      
      nextPort += 1;
    }
    
    throw new Error('No available ports found');
  }

  private getDockerPath(): string {
    return './wordpress';
  }

  private getPlatformSpecificImages(): { mysql: string; phpmyadmin: string; wordpress: string } {
    const isArm = this.architecture === 'arm64';
    return {
      // For ARM64 architecture, use mariadb instead of mysql which has better ARM compatibility
      mysql: isArm ? 'mariadb:10.6' : 'mysql:8.0',
      phpmyadmin: 'phpmyadmin:latest',
      wordpress: isArm ? 'arm64v8/wordpress:latest' : 'wordpress:latest'
    };
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
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

  private async updateDockerComposeImages(): Promise<void> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    let content = await fs.readFile(dockerComposePath, 'utf8');
    const images = this.getPlatformSpecificImages();

    // Update image references in docker-compose.yml
    content = content.replaceAll(
      'image: wordpress:latest',
      `image: ${images.wordpress}`
    );
    content = content.replaceAll(
      /image: mysql:5.7/g,
      `image: ${images.mysql}`
    );

    await fs.writeFile(dockerComposePath, content);
  }

  public async updateDockerComposePorts(originalPort: number, newPort: number): Promise<void> {
    try {
      const dockerComposeFile = join(this.projectPath, 'docker-compose.yml');
      
      // First record port mapping regardless of file existence
      this.portMappings[originalPort] = newPort;
      
      // If the file exists, update it
      try {
        const content = await fs.readFile(dockerComposeFile, 'utf8');
        const updatedContent = content.replaceAll(`${originalPort}:`, `${newPort}:`);
        await fs.writeFile(dockerComposeFile, updatedContent);
      } catch {
        // Just log that we're storing the mapping for later use
        console.log(chalk.blue(`Port mapping stored: ${originalPort} -> ${newPort}`));
      }
    } catch (error) {
      console.error(`Failed to update Docker Compose ports: ${error}`);
      throw error;
    }
  }

  private async waitForMySQL(): Promise<void> {
    this.spinner.start('Waiting for MySQL to be ready...');
    let attempts = 0;
    const maxAttempts = 30;
    
    // Get the project name for the MySQL container
    const projectName = this.projectPath.split('/').pop() || 'wp-spin';
    const mysqlContainer = `${projectName}_mysql`;
    
    // Use a loop with explicit eslint disable for waiting
    while (attempts < maxAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await execa('docker-compose', ['exec', '-T', 'mysql', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'root', '-proot'], {
          cwd: this.projectPath,
          stdio: 'ignore',
        });
        this.spinner.succeed('MySQL is ready');
        return;
      } catch {
        attempts++;
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>(resolve => {
          setTimeout(resolve, 1000);
        });
      }
    }
    
    this.spinner.fail('MySQL failed to start');
    this.prettyError(
      'MySQL Error',
      'MySQL failed to start within the expected time.',
      'Please check your Docker configuration and try again.'
    );
  }

  public getPortMappings(): Record<number, number> {
    return { ...this.portMappings };
  }

  /**
   * Returns the current project path
   * @returns The absolute path to the project root directory
   */
  public getProjectPath(): string {
    return this.projectPath;
  }
} 