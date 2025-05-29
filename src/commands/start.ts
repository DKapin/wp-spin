import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { BaseCommand, baseFlags } from './base.js';

export default class Start extends BaseCommand {
  static default = Start;
  static description = 'Start a WordPress development environment';
static flags = {
    ...baseFlags,
    port: Flags.integer({
      char: 'p',
      default: 8080,
      description: 'Port to run WordPress on',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);

    // Check Docker environment
    await this.checkDockerEnvironment();

    // Check if project exists
    await this.checkProjectExists();

    try {
      // Start containers
      await this.docker.start();

      // Get the actual port (might be different if there was a port conflict)
      const port = await this.docker.getPort('wordpress');

      // Configure custom domain if specified
      await this.configureDomain(port);

      this.log(`\n${chalk.green('WordPress development environment started successfully!')}`);

      this.log(`\nYou can access your site at:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}`)}`);
      if (flags.domain) {
        this.log(`  ${chalk.cyan(`http://${flags.domain}`)}`);
      }

      this.log(`\nWordPress admin:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}/wp-admin`)}`);
      if (flags.domain) {
        this.log(`  ${chalk.cyan(`http://${flags.domain}/wp-admin`)}`);
      }

      this.log(`\nDefault credentials:`);
      this.log(`  Username: ${chalk.cyan('admin')}`);
      this.log(`  Password: ${chalk.cyan('password')}`);
    } catch (error) {
      this.prettyError(error instanceof Error ? error : new Error(String(error)));
      this.exit(1);
    }
  }
}
