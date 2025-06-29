import { Args, Command } from '@oclif/core';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { addSite, getSiteByAlias, getSiteByName, getSiteByPath, getSites, isAliasInUse, removeSite, updateSite } from '../config/sites.js';

export default class Sites extends Command {
  static args = {
    action: Args.string({
      description: 'Action to perform: list, name, update, remove',
      options: ['list', 'name', 'update', 'remove'],
      required: true,
    }),
    name: Args.string({
      description: 'Site name/alias',
      required: false,
    }),
    path: Args.string({
      description: 'Site path (for name/update actions)',
      required: false,
    }),
  };
  static description = 'Manage WordPress site aliases';
  static examples = [
    '$ wp-spin sites list',
    '$ wp-spin sites name my-site ./path/to/site',
    '$ wp-spin sites remove my-site',
    '$ wp-spin sites update my-site /new/path/to/site',
  ];

  /**
   * Execute the command
   */
  public async run(): Promise<void> {
    const { args } = await this.parse(Sites);
    
    switch (args.action) {
      case 'list': {
        await this.listSites();
        break;
      }
      
      case 'name': {
        if (!args.name) {
          this.error('Site name is required for name action');
        }
        
        if (!args.path) {
          this.error('Site path is required for name action');
        }
        
        await this.nameSite(args.name, args.path);
        break;
      }
      
      case 'remove': {
        if (!args.name) {
          this.error('Site name is required for remove action');
        }
        
        await this.removeSite(args.name);
        break;
      }
      
      case 'update': {
        if (!args.name) {
          this.error('Site name is required for update action');
        }
        
        if (!args.path) {
          this.error('Site path is required for update action');
        }
        
        await this.updateSite(args.name, args.path);
        break;
      }
    }
  }

  /**
   * Check if a file or directory exists (re-implemented)
   */
  private _existsSync(checkPath: string): boolean {
    return fs.existsSync(checkPath);
  }

  /**
   * Check if directory is a valid wp-spin project (re-implemented)
   */
  private _isWpSpinProject(dir: string): boolean {
    if (!dir) {
      return false;
    }

    const dockerComposePath = path.join(dir, 'docker-compose.yml');
    return fs.existsSync(dockerComposePath);
  }

  /**
   * Resolve site path (re-implemented)
   */
  private _resolveSitePath(sitePathInput: string): string {
    if (!sitePathInput) {
      // This shouldn't happen if called from name/update actions which require path
      throw new Error('Site path cannot be empty.');
    }

    // Check if path is absolute or relative
    if (path.isAbsolute(sitePathInput)) {
      if (!this._isWpSpinProject(sitePathInput)) {
        throw new Error(`${sitePathInput} is not a valid wp-spin project.`);
      }

      return sitePathInput;
    }
    
    // Relative path
    const absolutePath = path.resolve(process.cwd(), sitePathInput);
    if (!this._isWpSpinProject(absolutePath)) {
      throw new Error(`${absolutePath} is not a valid wp-spin project.`);
    }

    return absolutePath;
  }

  /**
   * List all registered sites
   */
  private async listSites(): Promise<void> {
    const sites = getSites();
    
    if (sites.length === 0) {
      console.log('No sites registered. Use `wp-spin sites name <n> <path>` to name a site.');
      return;
    }
    
    console.log('\n📋 Registered WordPress sites:\n');
    
    let removedCount = 0;
    
    // Import execSync once outside the loop
    const { execSync } = await import('node:child_process');
    
    for (const site of sites) {
      const pathExists = this._existsSync(site.path);
      const isValidProject = pathExists && this._isWpSpinProject(site.path);
      
      if (!pathExists || !isValidProject) {
        // Remove invalid site
        const success = removeSite(site.name);
        if (success) {
          removedCount++;
        }

        continue;
      }
      
      // Format dates
      const addedDate = new Date(site.createdAt);
      
      // Get all aliases for this path
      const aliases = sites
        .filter(s => s.path === site.path)
        .map(s => s.name);

      // Check Docker container status using site name
      let containerStatus = 'Stopped';
      try {
        const result = execSync(`docker ps --filter "name=${site.name}" --format "{{.Names}}"`, { encoding: 'utf8' });
        const runningContainers = result.trim().split('\n').filter(Boolean);
        if (runningContainers.length > 0) {
          containerStatus = chalk.green('Running');
        }
      } catch {
        // If docker command fails, assume containers are stopped
        containerStatus = chalk.red('Stopped');
      }
      
      // Display site info
      console.log(`${chalk.blue(site.name)}`);

      if (aliases.length > 1) {
        console.log(`  Aliases: ${chalk.yellow(aliases.join(', '))}`);
      }

      console.log(`  Path: ${chalk.green(site.path)}`);
      console.log(`  Added: ${addedDate.toLocaleDateString()}`);
      console.log(`  Status: ${containerStatus}`);
      console.log('');
    }
    
    if (removedCount > 0) {
      console.log(chalk.yellow(`\nRemoved ${removedCount} invalid site entries.`));
    }
    
    console.log(`Use ${chalk.blue('wp-spin start --site=<n>')} to start a specific site.`);
  }
  
  /**
   * Name a WordPress site for easy reference
   */
  private async nameSite(name: string, sitePath: string): Promise<void> {
    const spinner = ora(`Naming site "${name}"...`).start();
    
    let resolvedPath: string;
    try {
      // Resolve the path using the new helper
      resolvedPath = this._resolveSitePath(sitePath);
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : String(error));
      this.error(error instanceof Error ? error.message : 'Failed to resolve or validate path');
    }
    
    // Check if the path exists
    if (!this._existsSync(resolvedPath)) {
      spinner.fail(`Path does not exist: ${resolvedPath}`);
      this.error(`Site path does not exist: ${resolvedPath}`);
    }
    
    // Check if it's a valid WordPress project
    if (!this._isWpSpinProject(resolvedPath)) {
      spinner.fail(`Not a valid WordPress project: ${resolvedPath}`);
      this.error(`Not a valid WordPress project at: ${resolvedPath}`);
    }
    
    // Check if this alias is already in use
    const existingSite = isAliasInUse(name);
    if (existingSite) {
      spinner.fail(`Alias "${name}" is already in use`);
      this.error(`Alias "${name}" is already in use by site at: ${existingSite.path}`);
    }
    
    // Check if this path is already registered
    const existingPath = getSiteByPath(resolvedPath);
    if (existingPath) {
      spinner.warn(`This site path is already registered with name: ${existingPath.name}`);
      
      console.log(`You can already use ${chalk.blue(`--site=${existingPath.name}`)} with any wp-spin command.`);
      console.log(`If you want to add another alias, use:`);
      console.log(`  ${chalk.blue(`wp-spin sites name ${name} ${sitePath}`)}`);
      return;
    }
    
    // Add the site with current timestamp
    const success = addSite(name, resolvedPath);
    
    if (success) {
      spinner.succeed(`Site "${name}" named successfully`);
      
      console.log(`You can now use ${chalk.blue(`--site=${name}`)} with any wp-spin command.`);
    } else {
      spinner.fail(`Failed to name site "${name}"`);
      
      const existingSite = getSiteByName(name);
      if (existingSite) {
        console.log(`A site with the name "${name}" already exists at: ${existingSite.path}`);
        console.log(`Use ${chalk.blue(`wp-spin sites update ${name} <path>`)}`);
      }
    }
  }
  
  /**
   * Remove a site
   */
  private async removeSite(name: string): Promise<void> {
    const spinner = ora(`Removing site "${name}"...`).start();
    
    // Check if the site exists
    const existingSite = getSiteByName(name);
    if (!existingSite) {
      spinner.fail(`Site "${name}" not found`);
      this.error(`Site "${name}" not found`);
    }
    
    // Remove the site
    const success = removeSite(name);
    
    if (success) {
      spinner.succeed(`Site "${name}" removed successfully`);
    } else {
      spinner.fail(`Failed to remove site "${name}"`);
    }
  }
  
  /**
   * Update an existing site
   */
  private async updateSite(name: string, sitePath: string): Promise<void> {
    const spinner = ora(`Updating site "${name}"...`).start();
    
    // Check if the site exists
    const existingSite = getSiteByAlias(name);
    if (!existingSite) {
      spinner.fail(`Site "${name}" not found`);
      this.error(`Site "${name}" not found. Use \`wp-spin sites name ${name} <path>\` to name it.`);
    }
    
    let resolvedPath: string;
    try {
      // Resolve the path using the new helper
      resolvedPath = this._resolveSitePath(sitePath);
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : String(error));
      this.error(error instanceof Error ? error.message : 'Failed to resolve or validate path');
    }
    
    // Check if the path exists
    if (!this._existsSync(resolvedPath)) {
      spinner.fail(`Path does not exist: ${resolvedPath}`);
      this.error(`Site path does not exist: ${resolvedPath}`);
    }
    
    // Check if it's a valid WordPress project
    if (!this._isWpSpinProject(resolvedPath)) {
      spinner.fail(`Not a valid WordPress project: ${resolvedPath}`);
      this.error(`Not a valid WordPress project at: ${resolvedPath}`);
    }
    
    // Check if this path is already registered with a different name
    const existingPath = getSiteByPath(resolvedPath);
    if (existingPath && existingPath.name !== name) {
      spinner.warn(`This site path is already registered with name: ${existingPath.name}`);
      
      console.log(`You can already use ${chalk.blue(`--site=${existingPath.name}`)} to access this site.`);
      console.log(`If you want to update to this path, please remove the existing name first:`);
      console.log(`  ${chalk.blue(`wp-spin sites remove ${existingPath.name}`)}`);
      return;
    }
    
    // Update the site with current timestamp
    const success = updateSite(name, resolvedPath);
    
    if (success) {
      spinner.succeed(`Site "${name}" updated successfully`);
      
      console.log(`You can now use ${chalk.blue(`--site=${name}`)} with any wp-spin command.`);
    } else {
      spinner.fail(`Failed to update site "${name}"`);
    }
  }
} 