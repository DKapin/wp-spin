import { Config } from '@oclif/core';
import path from 'node:path';
import ora from 'ora';
import * as fs from 'node:fs';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Restart extends BaseCommand {
  static description = 'Restart the WordPress environment';
static examples = [
    '$ wp-spin restart',
  ];
static hidden = false;
protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const spinner = ora();
    const projectPath = process.cwd();

    try {
      // Check if project exists
      if (!fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        this.error('No WordPress project found in current directory');
      }

      // Check Docker environment
      await this.checkDockerEnvironment();

      await this.docker.restart();
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
