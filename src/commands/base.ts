import { Command } from '@oclif/core';
import boxen from 'boxen';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { join } from 'node:path';

import { DockerService } from '../services/docker.js';

export class BaseCommand extends Command {
  static hidden = true;
  protected dockerService: DockerService = new DockerService('');
  protected projectPath: string = '';

  protected async checkDockerEnvironment(): Promise<void> {
    try {
      // Check if Docker is running
      execSync('docker info', {stdio: 'ignore'});
    } catch {
      this.error('Docker is not running or not installed. Please start Docker and try again.');
    }
  }

  protected async checkProjectExists(): Promise<void> {
    if (!await this.dockerService.checkProjectExists()) {
      this.error('No WordPress project found. Please run `wp-spin init` first.');
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

  protected async ensureProjectDirectory(): Promise<void> {
    const requiredFiles = ['docker-compose.yml', '.env'];
    for (const file of requiredFiles) {
      if (!this.existsSync(join(process.cwd(), file))) {
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

  protected async handlePortConflict(port: number): Promise<number> {
    try {
      // Find the next available port
      let nextPort = port + 1;
      while (nextPort < 65_535) {
        try {
          execSync(`lsof -i :${nextPort}`, {stdio: 'ignore'});
          nextPort++;
        } catch {
          // Port is available
          break;
        }
      }

      // Auto-select next available port in test environment
      if (process.env.NODE_ENV === 'test') {
        console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
        return nextPort;
      }

      // In non-test environment, use a simple console message for now
      console.log(chalk.yellow(`Port ${port} is already in use. Options:`));
      console.log(`1. Use next available port (${nextPort})`);
      console.log('2. Stop the current instance');
      console.log('3. Cancel operation');
      console.log('Using option 1 by default (automatic port selection)');
      
      // Return the next port - this just simulates what would happen
      // when the user selects option 1
      return nextPort;
    } catch (error) {
      this.error(`Failed to handle port conflict: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async init() {
    const homeDir = os.homedir();
    this.projectPath = join(homeDir, '.wp-spin');
    this.dockerService = new DockerService(this.projectPath);
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

  async run(): Promise<void> {
    // Base implementation does nothing
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
