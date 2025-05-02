import { Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Start extends BaseCommand {
  static description = 'Start the WordPress environment';
  static examples = [
    '$ wp-spin start',
    '$ wp-spin start --site=my-site',
    '$ wp-spin start --site=/path/to/my-site',
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
      // Find the project root directory, starting from site directory if specified
      const startPath = this.siteDirectory || process.cwd();
      const projectRoot = this.findProjectRoot(startPath);
      
      if (!projectRoot) {
        this.error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or specify a valid site path with --site.');
      }
      
      // Update docker service with the correct project path
      this.docker = new DockerService(projectRoot);
      
      console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
      spinner.start('Starting WordPress environment...');

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

  private async getActualPorts(): Promise<{ phpmyadmin: string; wordpress: string; }> {
    try {
      // Get the project name from the Docker service's project path
      const projectName = this.docker.getProjectPath().split('/').pop() || 'wp-spin';
      
      const { stdout: containersOutput } = await execa('docker', ['ps', '--format', '{{.Names}}']);
      const containers = containersOutput.split('\n');
      
      // Find container names based on project name pattern
      const wordpressContainer = containers.find(c => c.includes(`${projectName}_wordpress`));
      const phpmyadminContainer = containers.find(c => c.includes(`${projectName}_phpmyadmin`));
      
      if (!wordpressContainer || !phpmyadminContainer) {
        // If containers not found, use configured ports from Docker service
        const portMappings = this.docker.getPortMappings();
        return {
          phpmyadmin: String(portMappings[8081] || 8081),
          wordpress: String(portMappings[8080] || 8080)
        };
      }
      
      const { stdout: wordpressPort } = await execa('docker', [
        'port',
        wordpressContainer,
        '80'
      ]);
      
      const { stdout: phpmyadminPort } = await execa('docker', [
        'port',
        phpmyadminContainer,
        '80'
      ]);
      
      return {
        phpmyadmin: phpmyadminPort.split(':')[1],
        wordpress: wordpressPort.split(':')[1]
      };
    } catch {
      // Fallback to default ports if there's an error
      console.log(chalk.yellow('Could not determine actual ports, using default values'));
      return {
        phpmyadmin: '8081',
        wordpress: '8080'
      };
    }
  }
}
