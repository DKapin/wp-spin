import { Config, Flags } from '@oclif/core';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'node:path';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Logs extends BaseCommand {
  static description = 'View logs from a specific container (wordpress, mysql, or phpmyadmin)';
  static examples = [
    '$ wp-spin logs',
    '$ wp-spin logs --container=mysql',
    '$ wp-spin logs --container=phpmyadmin',
    '$ wp-spin logs --container=wordpress',
    '$ wp-spin logs --container=mysql --site=my-wp-site',
  ];
  static flags = {
    ...BaseCommand.baseFlags,
    container: Flags.string({
      char: 'c',
      default: 'wordpress',
      description: 'Container to target (wordpress, mysql, phpmyadmin)',
      options: ['wordpress', 'mysql', 'phpmyadmin'],
    }),
  };
  static hidden = false
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
    const { flags } = await this.parse(Logs);
    await this.ensureProjectDirectory();
    await this.checkDockerEnvironment();
    const containerType = flags.container || 'wordpress';
    const containerNames = this.getContainerNames();
    let containerName = containerNames.wordpress;
    if (containerType === 'mysql') containerName = containerNames.mysql;
    if (containerType === 'phpmyadmin') containerName = containerNames.phpmyadmin;

    // Show logs from the selected container
    await execa('docker', ['logs', containerName], { stdio: 'inherit' });
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
