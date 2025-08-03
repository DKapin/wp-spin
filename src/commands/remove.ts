import { Config } from '@oclif/core';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { removeSite } from '../config/sites.js';
import { DockerService } from '../services/docker.js';
import { NginxProxyService } from '../services/nginx-proxy.js';
import { PortManagerService } from '../services/port-manager.js';
import { BaseCommand } from './base.js';

export default class Remove extends BaseCommand {
  static description = 'Remove a WordPress development environment';
  static examples = [
    '$ wp-spin remove mysite',
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

      // Read project configuration
      const configPath = path.join(projectPath, '.wp-spin');
      if (!fs.existsSync(configPath)) {
        spinner.info('No project configuration found');
        // Remove containers without domain cleanup
        await this.docker.stop();
        spinner.succeed('WordPress environment removed successfully');
        return;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const { domain } = config;

      if (!domain) {
        spinner.info('No domain configuration found for this site');
        // Remove containers without domain cleanup
        await this.docker.stop();
        spinner.succeed('WordPress environment removed successfully');
        return;
      }

      // Initialize nginx proxy if not already initialized
      if (!this.nginxProxy) {
        this.nginxProxy = new NginxProxyService();
      }

      // Initialize port manager
      const portManager = new PortManagerService();

      // Remove domain from nginx configuration
      spinner.text = 'Removing domain from nginx configuration...';
      await this.nginxProxy.removeDomain(domain);

      // Release the port
      spinner.text = 'Releasing port...';
      await portManager.releasePort(domain);

      // Remove containers
      spinner.text = 'Removing containers...';
      await this.docker.stop();

      // Remove project directory
      spinner.text = 'Removing project directory...';
      fs.rmSync(projectPath, { force: true, recursive: true });

      // Remove site from config
      removeSite(projectPath);

      spinner.succeed('WordPress environment removed successfully');
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }
} 