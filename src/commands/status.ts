import chalk from 'chalk';
import { execSync } from 'node:child_process';
import ora from 'ora';

import { BaseCommand } from './base.js';

export default class Status extends BaseCommand {
  static description = 'Show the status of the WordPress environment';
  static examples = [
    '$ wp-spin status',
    '$ wp-spin status --site=my-site',
    '$ wp-spin status --site=/path/to/my-site',
  ];
  static flags = {
    ...BaseCommand.baseFlags,
  };
  static hidden = false;

  async run(): Promise<void> {
    console.log('DEBUG: Status command running');
    const spinner = ora('Checking WordPress environment...');
    spinner.start();

    try {
      // The docker service is already initialized with the correct project path in BaseCommand.init()
      const projectRoot = this.docker.getProjectPath();
      
      // Log the actual project path being used
      console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
      
      // First check that Docker is running
      await this.checkDockerEnvironment();
      
      // Check container status
      const { running, containers } = await this.getContainerStatus(projectRoot);
      
      if (running) {
        console.log(chalk.green('✓ WordPress environment is running'));
        
        // Display container info
        console.log('\nContainer details:');
        for (const container of containers) {
          console.log(`${chalk.blue(container.name)}: ${container.status} (${container.ports})`);
        }
        
        // Display URLs
        const ports = this.getPortsFromContainers(containers);
        
        console.log('\n🌍 Access your site at:');
        console.log(chalk.blue(`   WordPress: http://localhost:${ports.wordpress}`));
        console.log(chalk.blue(`   phpMyAdmin: http://localhost:${ports.phpmyadmin}`));
      } else {
        console.log(chalk.red('✖ WordPress environment is not running'));
        console.log(chalk.yellow('  Use `wp-spin start` to start the environment.'));
      }
    } catch (error) {
      spinner.fail('Failed to check WordPress environment');
      this.error(error instanceof Error ? error.message : 'An unknown error occurred');
    }
  }
  
  private async getContainerStatus(projectPath: string): Promise<{running: boolean; containers: Array<{name: string; status: string; ports: string}>}> {
    try {
      // Get project name from path
      const projectName = projectPath.split('/').pop() || 'wp-spin';
      
      const containersOutput = execSync('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}"').toString().trim();
      const containerList = containersOutput.split('\n');
      
      const containers = [];
      let anyRunning = false;
      
      for (const containerInfo of containerList) {
        const [name, status, ports] = containerInfo.split('|');
        
        // Only include containers for this project
        if (name.includes(projectName)) {
          const isRunning = status.toLowerCase().includes('up');
          if (isRunning) anyRunning = true;
          
          containers.push({
            name,
            ports: ports || 'No ports exposed',
            status: isRunning ? 'Running' : 'Stopped',
          });
        }
      }
      
      return {
        containers,
        running: anyRunning,
      };
    } catch {
      return {
        containers: [],
        running: false,
      };
    }
  }
  
  private getPortsFromContainers(containers: Array<{name: string; status: string; ports: string}>): {wordpress: string; phpmyadmin: string} {
    let wordpressPort = '8080';
    let phpmyadminPort = '8081';
    
    for (const container of containers) {
      if (container.name.includes('wordpress') && container.ports) {
        const match = container.ports.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
        if (match && match[1]) {
          wordpressPort = match[1];
        }
      } else if (container.name.includes('phpmyadmin') && container.ports) {
        const match = container.ports.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
        if (match && match[1]) {
          phpmyadminPort = match[1];
        }
      }
    }
    
    return {
      phpmyadmin: phpmyadminPort,
      wordpress: wordpressPort,
    };
  }
}
