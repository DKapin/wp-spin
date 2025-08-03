import { Config } from '@oclif/core';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

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

      // Initialize nginx proxy if domain is configured
      if (!this.nginxProxy) {
        this.nginxProxy = new (await import('../services/nginx-proxy.js')).NginxProxyService();
      }

      // Read project configuration
      const configPath = path.join(projectPath, '.wp-spin');
      if (!fs.existsSync(configPath)) {
        spinner.info('No project configuration found');
        // Restart containers without domain updates
        await this.docker.restart();
        spinner.succeed('WordPress environment restarted successfully');
        return;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { domain } = config;

      if (!domain) {
        spinner.info('No domain configuration found for this site');
        // Restart containers without domain updates
        await this.docker.restart();
        spinner.succeed('WordPress environment restarted successfully');
        return;
      }
      
      // Check if this domain is configured
      const currentPort = this.nginxProxy.getPortForDomain(domain);
      if (!currentPort) {
        spinner.info('No nginx configuration found for this domain');
        // Restart containers without domain updates
        await this.docker.restart();
        spinner.succeed('WordPress environment restarted successfully');
        return;
      }

      // Restart containers
      await this.docker.restart();

      // Get the actual port after restart
      const newPort = await this.docker.getPort('wordpress');

      // If the port has changed, update nginx configuration
      if (currentPort !== newPort) {
        spinner.text = 'Updating nginx configuration...';
        await this.nginxProxy.updateSitePort(domain, newPort);
        spinner.succeed('Nginx configuration updated');
      }

      spinner.succeed('WordPress environment restarted successfully');
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
}
