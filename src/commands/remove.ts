import { Config } from '@oclif/core';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import ora, { type Ora } from 'ora';

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
      const { flags } = await this.parse(Remove);
      const projectPath = this.resolveSitePath(flags.site);

      spinner.start('Removing WordPress environment...');
      await this.checkDockerEnvironment();

      const config = await this.loadProjectConfig(projectPath, spinner);
      await this.cleanupDomainConfiguration(config.domain, spinner);
      await this.removeContainersAndVolumes(projectPath, spinner);
      await this.removeProjectDirectory(projectPath, spinner);
      await this.removeSiteFromConfig(projectPath, spinner);

      spinner.succeed('WordPress environment removed successfully');
    } catch (error) {
      await this.handleRemovalError(error, spinner);
    }
  }

  private async cleanupDomainConfiguration(domain: string | undefined, spinner: Ora): Promise<void> {
    if (!domain) return;

    try {
      if (!this.nginxProxy) {
        this.nginxProxy = new NginxProxyService();
      }

      const portManager = new PortManagerService();

      spinner.text = 'Removing domain from nginx configuration...';
      await this.nginxProxy.removeDomain(domain);

      spinner.text = 'Releasing port...';
      await portManager.releasePort(domain);
    } catch (error) {
      spinner.warn(`Could not clean up domain configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleRemovalError(error: unknown, spinner: Ora): Promise<void> {
    if (error instanceof Error && error.message.includes('not a valid wp-spin project')) {
      this.warn('Directory may not be a complete wp-spin project, but attempting cleanup anyway...');
      const { flags } = await this.parse(Remove);
      const projectPath = flags.site ? path.resolve(flags.site) : process.cwd();

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

  private async loadProjectConfig(projectPath: string, spinner: Ora): Promise<{ domain?: string }> {
    const configPath = path.join(projectPath, '.wp-spin');
    let config: { domain?: string } = {};

    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch {
      spinner.info('Could not read project configuration, continuing with cleanup...');
    }

    return config;
  }

  private async removeContainersAndVolumes(projectPath: string, spinner: Ora): Promise<void> {
    spinner.text = 'Removing containers and volumes...';

    try {
      await (fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ? this.docker.stop() : this.removeLegacyContainers(projectPath));
    } catch (error) {
      spinner.warn(`Could not clean up containers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async removeLegacyContainers(projectPath: string): Promise<void> {
    const projectName = path.basename(projectPath);
    try {
      execSync(`docker ps -q --filter "name=${projectName}" | xargs -r docker stop`, { stdio: 'pipe' });
      execSync(`docker ps -aq --filter "name=${projectName}" | xargs -r docker rm`, { stdio: 'pipe' });
      execSync(`docker volume ls -q --filter "name=${projectName}" | xargs -r docker volume rm`, { stdio: 'pipe' });
    } catch {
      // Ignore errors - containers might not exist
    }
  }

  private async removeProjectDirectory(projectPath: string, spinner: Ora): Promise<void> {
    if (!fs.existsSync(projectPath)) return;

    spinner.text = 'Fixing file permissions...';
    await this.fixFilePermissions(projectPath);

    spinner.text = 'Removing project directory...';
    try {
      fs.rmSync(projectPath, { force: true, recursive: true });
    } catch (error) {
      spinner.fail(`Failed to remove directory: ${error instanceof Error ? error.message : String(error)}`);
      this.warn(`You may need to manually remove the directory with: sudo rm -rf "${projectPath}"`);
      throw error;
    }
  }

  private async removeSiteFromConfig(projectPath: string, spinner: Ora): Promise<void> {
    try {
      removeSite(projectPath);
    } catch (error) {
      spinner.warn(`Could not update sites configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 