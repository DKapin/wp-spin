import { Config } from '@oclif/core';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { removeSite } from '../config/sites.js';
import { DockerService } from '../services/docker.js';
import { NginxProxyService } from '../services/nginx-proxy.js';
import { PortManagerService } from '../services/port-manager.js';
import { BaseCommand, baseFlags } from './base.js';

export default class Remove extends BaseCommand {
  static description = 'Remove a WordPress development environment';
  static examples = [
    '$ wp-spin remove mysite',
  ];
  static flags = {
    ...baseFlags,
  };
  static hidden = false;
  protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const spinner = ora();
    
    try {
      // Use BaseCommand's site resolution logic
      const { flags } = await this.parse(Remove);
      const projectPath = this.resolveSitePath(flags.site);
      
      spinner.start('Removing WordPress environment...');

      // Check Docker environment
      await this.checkDockerEnvironment();

      // Try to read project configuration (but don't fail if missing)
      const configPath = path.join(projectPath, '.wp-spin');
      let config: { domain?: string } = {};
      
      try {
        if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
      } catch (error) {
        spinner.info('Could not read project configuration, continuing with cleanup...');
      }

      const { domain } = config;

      // Clean up domain configuration if available
      if (domain) {
        try {
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
        } catch (error) {
          spinner.warn(`Could not clean up domain configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Remove containers (using docker compose down if available)
      spinner.text = 'Removing containers and volumes...';
      try {
        // First try to stop with docker compose
        if (fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
          await this.docker.stop();
        } else {
          // Fallback: stop containers by project directory name
          const projectName = path.basename(projectPath);
          try {
            execSync(`docker ps -q --filter "name=${projectName}" | xargs -r docker stop`, { stdio: 'pipe' });
            execSync(`docker ps -aq --filter "name=${projectName}" | xargs -r docker rm`, { stdio: 'pipe' });
            execSync(`docker volume ls -q --filter "name=${projectName}" | xargs -r docker volume rm`, { stdio: 'pipe' });
          } catch {
            // Ignore errors - containers might not exist
          }
        }
      } catch (error) {
        spinner.warn(`Could not clean up containers: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Fix file permissions before removing directory
      if (fs.existsSync(projectPath)) {
        spinner.text = 'Fixing file permissions...';
        await this.fixFilePermissions(projectPath);

        // Remove project directory
        spinner.text = 'Removing project directory...';
        try {
          fs.rmSync(projectPath, { force: true, recursive: true });
        } catch (error) {
          spinner.fail(`Failed to remove directory: ${error instanceof Error ? error.message : String(error)}`);
          this.warn(`You may need to manually remove the directory with: sudo rm -rf "${projectPath}"`);
          return;
        }
      }

      // Remove site from config
      try {
        removeSite(projectPath);
      } catch (error) {
        // Don't fail if we can't update the sites config
        spinner.warn(`Could not update sites configuration: ${error instanceof Error ? error.message : String(error)}`);
      }

      spinner.succeed('WordPress environment removed successfully');
    } catch (error) {
      if (error instanceof Error && error.message.includes('not a valid wp-spin project')) {
        // More lenient handling - still try to clean up
        this.warn('Directory may not be a complete wp-spin project, but attempting cleanup anyway...');
        const { flags } = await this.parse(Remove);
        const projectPath = flags.site ? path.resolve(flags.site) : process.cwd();
        
        // Try basic cleanup
        await this.fixFilePermissions(projectPath);
        try {
          fs.rmSync(projectPath, { force: true, recursive: true });
          this.log('Directory removed successfully');
        } catch (rmError) {
          this.error(`Failed to remove directory: ${rmError instanceof Error ? rmError.message : String(rmError)}`);
        }
      } else {
        spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
        throw error;
      }
    }
  }
} 