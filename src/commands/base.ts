import { Command } from '@oclif/core';
import { DockerService } from '../services/docker.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import chalk from 'chalk';
import boxen from 'boxen';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';

export class BaseCommand extends Command {
  static hidden = true;
  protected dockerService: DockerService = new DockerService('');
  protected projectPath: string = '';

  async run(): Promise<void> {
    // Base implementation does nothing
  }

  protected async checkDockerEnvironment(): Promise<void> {
    try {
      // Check if Docker is running
      execSync('docker info', {stdio: 'ignore'});
    } catch {
      this.error('Docker is not running or not installed. Please start Docker and try again.');
    }
  }

  async init() {
    const homeDir = os.homedir();
    this.projectPath = path.join(homeDir, '.wp-spin');
    this.dockerService = new DockerService(this.projectPath);
  }

  protected async checkProjectExists(): Promise<void> {
    if (!await this.dockerService.checkProjectExists()) {
      this.error('No WordPress project found. Please run `wp-spin init` first.');
    }
  }

  protected async ensureProjectDirectory(): Promise<void> {
    const requiredFiles = ['docker-compose.yml', '.env'];
    for (const file of requiredFiles) {
      if (!this.existsSync(path.join(process.cwd(), file))) {
        this.prettyError(
          'Project Directory Error',
          `Not a WordPress project directory. Missing ${chalk.bold(file)}`,
          'Make sure you are in the correct directory or run `wp-spin init` to create a new project.'
        );
      }
    }
  }

  protected existsSync(filePath: string): boolean {
    try {
      fs.accessSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  protected prettyError(title: string, message: string, suggestion?: string): never {
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
    throw new Error(message);
  }

  protected async handlePortConflict(port: number): Promise<number> {
    try {
      // Try to find the next available port
      let nextPort = port + 1;
      while (nextPort < 65535) {
        try {
          execSync(`lsof -i :${nextPort}`, {stdio: 'ignore'});
          nextPort++;
        } catch {
          // Port is available
          break;
        }
      }

      const {action} = await inquirer.prompt([
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
          return nextPort;
        }
        case 'stop': {
          // Find the container using the port
          const containerId = execSync(`docker ps --format "{{.ID}}" --filter "publish=${port}"`).toString().trim();
          if (containerId) {
            execSync(`docker stop ${containerId}`, {stdio: 'inherit'});
            return port;
          }
          throw new Error('Could not find container using the port');
        }
        case 'cancel': {
          throw new Error('Operation cancelled by user');
        }
        default: {
          throw new Error('Invalid action selected');
        }
      }
    } catch (error) {
      this.error(`Failed to handle port conflict: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected async checkWordPressContainer(): Promise<void> {
    try {
      // Check if the WordPress container is running
      const containers = execSync('docker ps --format "{{.Names}}"').toString();
      if (!containers.includes('wordpress')) {
        this.error('WordPress container is not running. Please start your Docker environment first.');
      }
    } catch (error) {
      this.error(`Failed to check WordPress container: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected runWpCli(command: string): void {
    try {
      // Get the actual container name
      const containers = execSync('docker ps --format "{{.Names}}"').toString();
      const wordpressContainer = containers.split('\n').find(name => name.includes('wordpress'));
      
      if (!wordpressContainer) {
        this.error('WordPress container is not running. Please start your Docker environment first.');
      }

      execSync(`docker exec ${wordpressContainer} ${command}`, {stdio: 'inherit'});
    } catch (error) {
      this.error(`Failed to execute WP-CLI command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
