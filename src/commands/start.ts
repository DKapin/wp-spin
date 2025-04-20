import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'node:path';
import { Config } from '@oclif/core';
import { BaseCommand } from './base.js';
import { DockerService } from '../services/docker.js';

export default class Start extends BaseCommand {
  static description = 'Start the WordPress environment';

  static examples = [
    '$ wp-spin start',
  ];

  static hidden = false;

  protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  private async getActualPorts(): Promise<{ wordpress: string; phpmyadmin: string }> {
    const { stdout: wordpressPort } = await execa('docker', [
      'port',
      'test-site-wordpress-1',
      '80'
    ]);
    const { stdout: phpmyadminPort } = await execa('docker', [
      'port',
      'test-site-phpmyadmin-1',
      '80'
    ]);

    return {
      wordpress: wordpressPort.split(':')[1],
      phpmyadmin: phpmyadminPort.split(':')[1]
    };
  }

  async run(): Promise<void> {
    const spinner = ora();
    const projectPath = process.cwd();

    try {
      // Check if project exists
      if (!this.existsSync(join(projectPath, 'docker-compose.yml'))) {
        this.error('No WordPress project found in current directory');
      }

      // Check Docker environment
      await this.checkDockerEnvironment();

      // Check and configure ports before starting
      await this.docker.checkPorts();

      await this.docker.start();
      spinner.succeed('WordPress environment started');

      // Get actual running ports
      const ports = await this.getActualPorts();

      console.log('\n🌍 Your WordPress site is ready!');
      console.log(chalk.blue(`   WordPress: http://localhost:${ports.wordpress}`));
      console.log(chalk.blue(`   phpMyAdmin: http://localhost:${ports.phpmyadmin}`));
      console.log('\n📝 Next steps:');
      console.log(`   1. Please give the container a minute to start up before accessing http://localhost:${ports.wordpress}`);
      console.log('   2. Use `wp-spin stop` to stop the environment when done');
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
