import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';
import path from 'node:path';
import ora from 'ora';

export default class Shell extends BaseCommand {
  static description = 'Open a shell in the WordPress container';
  static examples = [
    '$ wp-spin shell',
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

      await this.docker.shell();
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
