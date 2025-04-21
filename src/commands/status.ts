import { Config } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Status extends BaseCommand {
  static description = 'Show the status of the WordPress environment';
  static examples = [
    '$ wp-spin status',
  ];
  static hidden = false;
  protected docker: DockerService;

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
        this.error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project.');
      }
      
      // Update docker service with the correct project path
      this.docker = new DockerService(projectRoot);
      
      console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
      spinner.start('Checking WordPress environment status...');

      // Check Docker environment
      await this.checkDockerEnvironment();

      await this.docker.status();
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
