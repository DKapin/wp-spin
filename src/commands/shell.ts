import { Config, Flags } from '@oclif/core';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

export default class Shell extends BaseCommand {
  static description = 'Open a shell in a specific container (wordpress, mysql, or phpmyadmin)';
  static examples = [
    '$ wp-spin shell',
    '$ wp-spin shell --container=mysql',
    '$ wp-spin shell --container=phpmyadmin',
    '$ wp-spin shell --container=wordpress',
    '$ wp-spin shell --container=mysql --site=my-wp-site',
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
  protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Shell);
    const spinner = ora();
    const projectPath = process.cwd();
    const containerType = flags.container || 'wordpress';
    const containerNames = this.getContainerNames();
    let containerName = containerNames.wordpress;
    if (containerType === 'mysql') containerName = containerNames.mysql;
    if (containerType === 'phpmyadmin') containerName = containerNames.phpmyadmin;

    try {
      // Check if project exists
      if (!fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        this.error('No WordPress project found in current directory');
      }

      // Check Docker environment
      await this.checkDockerEnvironment();

      spinner.stop();
      console.log(`Opening shell in ${containerType} container (${containerName})...`);
      // Try 'sh' first, then fallback to 'bash' if 'sh' fails
      const tryShell = (shellCmd: string) => {
        const shellProcess = spawn('docker', ['exec', '-it', containerName, shellCmd], {
          shell: true,
          stdio: 'inherit',
        });
        shellProcess.on('exit', (code) => {
          if (code === 127 && shellCmd === 'sh') {
            // 'sh' not found, try 'bash'
            console.log("'sh' not found, trying 'bash'...");
            tryShell('bash');
          } else if (code === 127 && shellCmd === 'bash') {
            console.log("Neither 'sh' nor 'bash' found in the container. No shell available.");
            process.exit(127);
          } else {
            console.log('Shell session ended.');
            process.exit(code ?? 0);
          }
        });
      };
      tryShell('sh');

    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
