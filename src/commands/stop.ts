import chalk from 'chalk';
import ora from 'ora';

import { BaseCommand } from './base.js';

export default class Stop extends BaseCommand {
  static description = 'Stop the WordPress environment';
  static examples = [
    '$ wp-spin stop',
    '$ wp-spin stop --site=./path/to/wordpress',
  ];
  static flags = {
    ...BaseCommand.baseFlags,
  };
  static hidden = false;

  async run(): Promise<void> {
    const spinner = ora();
    
    try {
      // The docker service is already initialized with the correct project path in BaseCommand.init()
      const projectRoot = this.docker.getProjectPath();
      console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
      
      spinner.start('Stopping WordPress environment...');

      // Check Docker environment
      await this.checkDockerEnvironment();

      await this.docker.stop();
      
      spinner.succeed('WordPress environment stopped');
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
