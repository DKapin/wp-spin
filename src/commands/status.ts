import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';
import path from 'node:path';
import ora from 'ora';

export default class Status extends BaseCommand {
  static description = 'Show the status of the WordPress environment';
  static examples = [
    '$ wp-spin status',
  ];
  static hidden = false;

  protected docker: DockerService;

  constructor(argv: string[], config: any) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const spinner = ora();
    const projectPath = process.cwd();

    try {
      // Check if project exists
      if (!this.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        this.error('No WordPress project found in current directory');
      }

      // Check Docker environment
      await this.checkDockerEnvironment();

      await this.docker.status();
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
