import { Config } from '@oclif/core';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

/**
 * Container status command - shows the status of all Docker containers for this project
 */
export default class ContainerStatus extends BaseCommand {
  static aliases = ['containers', 'status'];
  static description = 'Show status of Docker containers for this project';
  static examples = [
    '$ wp-spin ps',
    '$ wp-spin ps --site=my-site',
    '$ wp-spin ps --site=/path/to/my-site',
  ];
  static flags = {
    ...BaseCommand.baseFlags,
  };
  static hidden = false;
  protected docker: DockerService;
  protected siteDirectory?: string;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const spinner = ora();
    
    try {
      // Find the project root directory
      const projectRoot = this.findProjectRoot();
      
      if (!projectRoot) {
        this.error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or specify a valid site path with --site.');
      }
      
      // Update docker service with the correct project path
      this.docker = new DockerService(projectRoot);
      
      // Get project name from directory name
      const projectName = projectRoot.split('/').pop() || 'unknown';
      
      console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
      spinner.start('Fetching container status...');

      // Check Docker environment
      await this.checkDockerEnvironment();

      // Get container status using docker ps
      try {
        // Get all containers (including stopped ones) for this project
        const allContainersOutput = execSync(`docker ps -a --format "{{.Names}},{{.Status}},{{.Ports}}" | grep ${projectName}`, { encoding: 'utf8' }).toString();
        
        spinner.succeed('Container status retrieved');
        
        if (!allContainersOutput) {
          console.log(chalk.yellow('No containers found for this project.'));
          return;
        }
        
        // Parse the output and format it nicely
        console.log(chalk.bold('\nCONTAINER STATUS:'));
        console.log('───────────────────────────────────────────────────────');
        
        const containers = allContainersOutput.trim().split('\n');
        
        for (const container of containers) {
          const [name, status, ports] = container.split(',');
          
          // Determine the type of container
          let type = 'Unknown';
          let icon = '🔄';
          
          if (name.includes('wordpress')) {
            type = 'WordPress';
            icon = '🌐';
          } else if (name.includes('mysql') || name.includes('mariadb')) {
            type = 'Database';
            icon = '💾';
          } else if (name.includes('phpmyadmin')) {
            type = 'PHPMyAdmin';
            icon = '🔧';
          }
          
          // Colorize the status
          const statusColor = status.includes('Up') ? chalk.green : chalk.red;
          
          console.log(`${icon} ${chalk.bold(type)} (${chalk.cyan(name)})`);
          console.log(`   Status: ${statusColor(status)}`);
          
          if (ports && ports.trim()) {
            console.log(`   Ports: ${chalk.blue(ports)}`);
          }
          
          console.log('───────────────────────────────────────────────────────');
        }
        
        // Print WordPress site URL if containers are running
        if (containers.some(container => container.includes('wordpress') && container.includes('Up'))) {
          const wordpressPort = this.extractWordPressPort(containers);
          if (wordpressPort) {
            console.log(`\n${chalk.bold('WordPress site:')} ${chalk.blue(`http://localhost:${wordpressPort}`)}`);
          }
        }
        
      } catch (error) {
        // No containers found or other error
        if ((error as Error).message.includes('Command failed')) {
          spinner.info('No containers found for this project.');
        } else {
          spinner.fail('Failed to fetch container status');
          throw error;
        }
      }
      
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
  
  /**
   * Extract the WordPress port from container output
   */
  private extractWordPressPort(containers: string[]): null | string {
    const wordpressContainer = containers.find(c => c.includes('wordpress'));
    if (!wordpressContainer) return null;
    
    const ports = wordpressContainer.split(',')[2];
    if (!ports) return null;
    
    // Format is typically like "0.0.0.0:8083->80/tcp"
    const portMatch = ports.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
    return portMatch ? portMatch[1] : null;
  }
} 