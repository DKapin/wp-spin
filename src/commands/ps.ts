import { Config } from '@oclif/core';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

/**
 * Container status command - shows the status of all Docker containers for this project
 */
export default class ContainerStatus extends BaseCommand {
  static aliases = ['containers', 'status'];
  static description = 'Show status of Docker containers for this project';
  static examples = [
    '$ wp-spin ps',
    '$ wp-spin ps --site=my-site',
    '$ wp-spin ps --site=/path/to/my-site',
  ];
  static flags = {
    ...BaseCommand.baseFlags,
  };
  static hidden = false;
  protected docker: DockerService;
  protected siteDirectory?: string;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const spinner = ora();

    try {
      const { projectName, projectRoot } = await this.setupProject(spinner);
      const containers = await this.getContainerStatus(spinner, projectName);

      if (containers.length === 0) {
        console.log(chalk.yellow('No containers found for this project.'));
        return;
      }

      this.displayContainerStatus(containers);
      await this.displayServiceUrls(containers, projectRoot);

    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }

  private displayContainerStatus(containers: string[]): void {
    console.log(chalk.bold('\nCONTAINER STATUS:'));
    console.log('───────────────────────────────────────────────────────');

    for (const container of containers) {
      const [name, status, ports] = container.split(',');
      const { icon, type } = this.getContainerTypeInfo(name);
      const statusColor = status.includes('Up') ? chalk.green : chalk.red;

      console.log(`${icon} ${chalk.bold(type)} (${chalk.cyan(name)})`);
      console.log(`   Status: ${statusColor(status)}`);

      if (ports && ports.trim()) {
        console.log(`   Ports: ${chalk.blue(ports)}`);
      }

      console.log('───────────────────────────────────────────────────────');
    }
  }

  private displayCustomDomainUrl(projectRoot: string, useCustomUrl: boolean): void {
    if (useCustomUrl) {
      return;
    }

    const configPath = path.join(projectRoot, '.wp-spin');
    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.domain) {
        const protocol = config.ssl ? 'https' : 'http';
        console.log(`   ${chalk.cyan('Custom Domain:')} ${protocol}://${config.domain}`);
      }
    } catch {
      // Ignore config read errors
    }
  }

  private displayMailHogUrl(ports: { mailhog?: string; phpmyadmin?: string; wordpress?: string }): void {
    if (ports.mailhog) {
      console.log(`   ${chalk.yellow('MailHog:')} http://localhost:${ports.mailhog}`);
    }
  }

  private displayPhpMyAdminUrl(ports: { mailhog?: string; phpmyadmin?: string; wordpress?: string }): void {
    if (ports.phpmyadmin) {
      console.log(`   ${chalk.blue('phpMyAdmin:')} http://localhost:${ports.phpmyadmin}`);
    }
  }

  private async displayServiceUrls(containers: string[], projectRoot: string): Promise<void> {
    if (!containers.some(container => container.includes('Up'))) {
      return;
    }

    console.log(`\n${chalk.bold('🌍 Access your services at:')}`);

    const ports = this.extractAllPorts(containers);
    const configuredUrls = await this.getWordPressUrls();
    const useCustomUrl = configuredUrls.siteurl && !configuredUrls.siteurl.includes('localhost');

    this.displayWordPressUrl(Boolean(useCustomUrl), configuredUrls, ports);
    this.displayPhpMyAdminUrl(ports);
    this.displayMailHogUrl(ports);
    this.displayCustomDomainUrl(projectRoot, Boolean(useCustomUrl));
  }

  private displayWordPressUrl(useCustomUrl: boolean, configuredUrls: { home?: string; siteurl?: string }, ports: { mailhog?: string; phpmyadmin?: string; wordpress?: string }): void {
    if (useCustomUrl && configuredUrls.siteurl) {
      console.log(`   ${chalk.blue('WordPress:')} ${configuredUrls.siteurl}`);
    } else if (ports.wordpress) {
      console.log(`   ${chalk.blue('WordPress:')} http://localhost:${ports.wordpress}`);
    }
  }

  /**
   * Extract all service ports from container output
   */
  private extractAllPorts(containers: string[]): { mailhog?: string; phpmyadmin?: string; wordpress?: string } {
    const ports: { mailhog?: string; phpmyadmin?: string; wordpress?: string } = {};

    for (const container of containers) {
      const parts = container.split(',');
      const name = parts[0];
      // The port info is everything after the second comma (name, status, ports...)
      const portInfo = parts.slice(2).join(',');

      if (name.includes('wordpress') && portInfo) {
        const match = portInfo.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
        if (match && match[1]) {
          ports.wordpress = match[1];
        }
      } else if (name.includes('phpmyadmin') && portInfo) {
        const match = portInfo.match(/0\.0\.0\.0:(\d+)->80\/tcp/);
        if (match && match[1]) {
          ports.phpmyadmin = match[1];
        }
      } else if (name.includes('mailhog') && portInfo) {
        // MailHog web UI - look for HTTP port (8025 internal)
        const httpMatch = portInfo.match(/0\.0\.0\.0:(\d+)->8025\/tcp/);
        if (httpMatch && httpMatch[1]) {
          ports.mailhog = httpMatch[1];
        }
      }
    }

    return ports;
  }

  private async getContainerStatus(spinner: ReturnType<typeof ora>, projectName: string): Promise<string[]> {
    try {
      const allContainersOutput = execSync(`docker ps -a --format "{{.Names}},{{.Status}},{{.Ports}}" | grep ${projectName}`, { encoding: 'utf8' }).toString();
      spinner.succeed('Container status retrieved');

      if (!allContainersOutput) {
        return [];
      }

      return allContainersOutput.trim().split('\n');
    } catch (error) {
      if ((error as Error).message.includes('Command failed')) {
        spinner.info('No containers found for this project.');
        return [];
      }

      spinner.fail('Failed to fetch container status');
      throw error;
    }
  }

  private getContainerTypeInfo(name: string): { icon: string; type: string } {
    if (name.includes('wordpress')) {
      return { icon: '🌐', type: 'WordPress' };
    }

    if (name.includes('mysql') || name.includes('mariadb')) {
      return { icon: '💾', type: 'Database' };
    }

    if (name.includes('phpmyadmin')) {
      return { icon: '🔧', type: 'PHPMyAdmin' };
    }

    if (name.includes('mailhog')) {
      return { icon: '📧', type: 'MailHog' };
    }

    return { icon: '🔄', type: 'Unknown' };
  }

  /**
   * Get WordPress URLs from the database
   */
  private async getWordPressUrls(): Promise<{ home?: string; siteurl?: string }> {
    try {
      const projectRoot = this.findProjectRoot();
      if (!projectRoot) return {};

      const projectName = projectRoot.split('/').pop() || 'unknown';

      // Try to get WordPress URLs from the container
      const { execSync } = await import('node:child_process');

      try {
        const siteurl = execSync(`docker exec ${projectName}-wordpress-1 wp option get siteurl --allow-root 2>/dev/null`, { encoding: 'utf8' }).trim();
        const home = execSync(`docker exec ${projectName}-wordpress-1 wp option get home --allow-root 2>/dev/null`, { encoding: 'utf8' }).trim();

        return { home, siteurl };
      } catch {
        // If WordPress CLI fails, fall back to direct database query
        try {
          const siteurl = execSync(`docker exec ${projectName}-mysql-1 mysql -u wordpress -pwordpress wordpress -e "SELECT option_value FROM wp_options WHERE option_name='siteurl'" --silent --raw 2>/dev/null`, { encoding: 'utf8' }).trim();
          const home = execSync(`docker exec ${projectName}-mysql-1 mysql -u wordpress -pwordpress wordpress -e "SELECT option_value FROM wp_options WHERE option_name='home'" --silent --raw 2>/dev/null`, { encoding: 'utf8' }).trim();

          return { home, siteurl };
        } catch {
          return {};
        }
      }
    } catch {
      return {};
    }
  }

  private async setupProject(spinner: ReturnType<typeof ora>): Promise<{ projectName: string; projectRoot: string }> {
    const projectRoot = this.findProjectRoot();

    if (!projectRoot) {
      this.error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or specify a valid site path with --site.');
    }

    this.docker = new DockerService(projectRoot);
    const projectName = projectRoot.split('/').pop() || 'unknown';

    console.log(chalk.blue(`Found WordPress project at: ${projectRoot}`));
    spinner.start('Fetching container status...');
    await this.checkDockerEnvironment();

    return { projectName, projectRoot };
  }
} 