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
      description: 'Port to run WordPress on (if not specified, an available port will be found)',
    }),
    ssl: Flags.boolean({
      default: false,
      description: 'Enable SSL for custom domain',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);

    // Check Docker environment
    await this.checkDockerEnvironment();

    // Check if project exists
    await this.checkProjectExists();

    try {
      // Initialize nginx proxy if domain is provided
      if (flags.domain && !this.nginxProxy) {
        this.nginxProxy = new (await import('../services/nginx-proxy.js')).NginxProxyService();
      }

      // Start containers
      await this.docker.start();

      // Get the actual port (might be different if there was a port conflict)
      const port = await this.docker.getPort('wordpress');

      // Configure custom domain if specified
      if (flags.domain) {
        // Check if domain is already configured
        const existingPort = this.nginxProxy.getPortForDomain(flags.domain);
        if (existingPort && existingPort !== port) {
          // Port has changed, update nginx config
          await this.nginxProxy.updateSitePort(flags.domain, port);
        } else {
          // New domain or same port, add/update domain
          await this.nginxProxy.addDomain(flags.domain, port, flags.ssl);
        }
      }

      this.log(`\n${chalk.green('WordPress development environment started successfully!')}`);

      this.log(`\nYou can access your site at:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}`)}`);
      if (flags.domain) {
        const protocol = flags.ssl ? 'https' : 'http';
        this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}`)}`);
      }

      this.log(`\nWordPress admin:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}/wp-admin`)}`);
      if (flags.domain) {
        const protocol = flags.ssl ? 'https' : 'http';
        this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}/wp-admin`)}`);
      }

      this.log(`\nDefault credentials:`);
      this.log(`  Username: ${chalk.cyan('admin')}`);
      this.log(`  Password: ${chalk.cyan('password')}`);
    } catch (error) {
      this.error(`Failed to start WordPress environment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
