import { Config } from '@oclif/core';
import fs from 'fs-extra';
import path from 'node:path';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Logs extends BaseCommand {
  static description = 'View logs from the WordPress environment';
  static examples = [
    '$ wp-spin logs',
  ];
  static hidden = false;
protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  protected async ensureProjectDirectory(): Promise<void> {
    const requiredFiles = ['docker-compose.yml', '.env'];
    const missingFiles = [];

    for (const file of requiredFiles) {
      if (!this.checkFileExists(file)) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(
        'Not a WordPress project directory. Missing ' + missingFiles.join(', ') + '\n' +
        'Make sure you are in the correct directory or run `wp-spin init` to create a new project.'
      );
    }
  }

  public async run(): Promise<void> {
    await this.ensureProjectDirectory();
    await this.checkDockerEnvironment();
    await this.docker.logs();
  }

  private checkFileExists(filePath: string): boolean {
    try {
      fs.accessSync(path.join(process.cwd(), filePath));
      return true;
    } catch {
      return false;
    }
  }
}
