import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import { createPromptModule } from 'inquirer';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import ora from 'ora';

import { getSiteByName } from '../config/sites.js';
import { DockerService } from '../services/docker.js';

interface SiteInfo {
  isMultisite: boolean;
  multisiteType?: string;
  siteTitle: string;
  siteUrl: string;
}

export default class Db extends Command {
  static args = {
    action: Args.string({
      description: 'Database action to perform',
      options: ['export', 'import', 'reset', 'snapshot'],
      required: true,
    }),
    target: Args.string({
      description: 'Target file for import/export or snapshot name',
      required: false,
    }),
  };
static description = 'Manage WordPress database operations';
  static examples = [
    '$ wp-spin db export',
    '$ wp-spin db export backup.sql',
    '$ wp-spin db import backup.sql',
    '$ wp-spin db import backup.sql --search-replace=oldsite.com,newsite.com',
    '$ wp-spin db import backup.sql --skip-url-update',
    '$ wp-spin db reset',
    '$ wp-spin db snapshot create dev-state',
    '$ wp-spin db snapshot restore dev-state',
    '$ wp-spin db snapshot list',
  ];
  static flags = {
    'exclude-tables': Flags.string({
      description: 'Comma-separated list of tables to exclude from export',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force operation without confirmation prompts',
    }),
    'search-replace': Flags.string({
      description: 'Search and replace URLs during import (format: old.com,new.com)',
    }),
    site: Flags.string({
      char: 's',
      description: 'Site path or site name to operate on',
      env: 'WP_SPIN_SITE_PATH',
    }),
    'skip-themes-plugins': Flags.boolean({
      default: false,
      description: 'Skip themes and plugins tables during import',
    }),
    'skip-url-update': Flags.boolean({
      default: false,
      description: 'Skip automatic URL updates during import',
    }),
  };
  static hidden = false;
  protected docker!: DockerService;

  protected async checkDockerEnvironment(): Promise<void> {
    try {
      await this.docker.checkDockerInstalled();
      await this.docker.checkDockerRunning();
      await this.docker.checkDockerComposeInstalled();
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }

  protected getContainerNames(): { mailhog: string; mysql: string; phpmyadmin: string; wordpress: string } {
    const projectPath = this.docker.getProjectPath();
    const projectName = projectPath.split('/').pop() || 'wp-spin';
    return {
      mailhog: `${projectName}-mailhog-1`,
      mysql: `${projectName}-mysql-1`,
      phpmyadmin: `${projectName}-phpmyadmin-1`,
      wordpress: `${projectName}-wordpress-1`,
    };
  }

  async init(): Promise<void> {
    // Initialize Docker service
    const projectPath = process.cwd();
    this.docker = new DockerService(projectPath, this);
  }

  protected resolveSitePath(siteInput: string): string {
    // Try to resolve as site alias first
    const siteByName = getSiteByName(siteInput);
    if (siteByName) {
      return siteByName.path;
    }

    // If it's an absolute path, use it as-is
    if (siteInput.startsWith('/')) {
      return siteInput;
    }

    // Otherwise, resolve relative to current directory
    return join(process.cwd(), siteInput);
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Db);
    
    // Handle site resolution if --site flag is provided
    if (flags.site) {
      await this.resolveSite(flags.site as string);
    }
    
    // Ensure Docker environment is running
    await this.checkDockerEnvironment();
    
    const action = args.action!;
    
    switch (action) {
      case 'export': {
        await this.handleExport(args.target, flags);
        break;
      }

      case 'import': {
        await this.handleImport(args.target, flags);
        break;
      }

      case 'reset': {
        await this.handleReset(flags);
        break;
      }

      case 'snapshot': {
        await this.handleSnapshot(args.target, flags);
        break;
      }

      default: {
        this.error(`Unknown action: ${action}`);
      }
    }
  }

  private async createSnapshot(name: string | undefined, flags: Record<string, unknown>): Promise<void> {
    const snapshotName = name || this.generateTimestampedFilename('snapshot', 'sql');
    const projectPath = this.docker.getProjectPath();
    const snapshotsDir = join(projectPath, 'database-backups', 'snapshots');
    await fs.ensureDir(snapshotsDir);
    
    const snapshotPath = join(snapshotsDir, `${snapshotName}.sql`);
    
    // Check if snapshot already exists
    if (await fs.pathExists(snapshotPath) && !flags.force) {
      const prompt = createPromptModule();
      const { confirm } = await prompt({
        default: false,
        message: `Snapshot "${snapshotName}" already exists. Overwrite?`,
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('Snapshot creation cancelled');
        return;
      }
    }
    
    // Use the export functionality
    await this.handleExport(`snapshots/${snapshotName}.sql`, flags);
    
    // Store metadata about the snapshot
    const metadata = {
      created: new Date().toISOString(),
      name: snapshotName,
      siteInfo: await this.getCurrentSiteInfo(),
    };
    
    await fs.writeJSON(join(snapshotsDir, `${snapshotName}.meta.json`), metadata, { spaces: 2 });
    
    this.log(`Snapshot "${chalk.cyan(snapshotName)}" created successfully`);
  }

  private async deleteSnapshot(name: string | undefined, flags: Record<string, unknown>): Promise<void> {
    if (!name) {
      this.error('Snapshot name is required for delete');
    }
    
    const projectPath = this.docker.getProjectPath();
    const snapshotsDir = join(projectPath, 'database-backups', 'snapshots');
    const snapshotPath = join(snapshotsDir, `${name}.sql`);
    const metadataPath = join(snapshotsDir, `${name}.meta.json`);
    
    if (!await fs.pathExists(snapshotPath)) {
      this.error(`Snapshot "${name}" not found`);
    }
    
    if (!flags.force) {
      const prompt = createPromptModule();
      const { confirm } = await prompt({
        default: false,
        message: `Delete snapshot "${name}" permanently?`,
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('Snapshot deletion cancelled');
        return;
      }
    }
    
    // Remove snapshot and metadata files
    await fs.remove(snapshotPath);
    if (await fs.pathExists(metadataPath)) {
      await fs.remove(metadataPath);
    }
    
    this.log(`Snapshot "${chalk.cyan(name)}" deleted successfully`);
  }

  private displayPostImportInfo(siteInfo: SiteInfo): void {
    this.log('\n' + chalk.green('✅ Database import completed successfully!'));
    this.log('\nImportant notes:');
    this.log(`• Site URL has been updated to: ${chalk.cyan(siteInfo.siteUrl)}`);
    this.log(`• Admin credentials: admin / password`);
    
    if (siteInfo.isMultisite) {
      this.log(`• Multisite network (${siteInfo.multisiteType}) configuration preserved`);
    }
    
    this.log('\nNext steps:');
    this.log('• Verify your site is working correctly');
    this.log('• Update any hardcoded URLs in content if needed');
    this.log('• Check plugin/theme compatibility');
  }

  private formatFileSize(stats: { size: number }): string {
    const bytes = stats.size;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round(bytes / (1024 ** i) * 100) / 100} ${sizes[i]}`;
  }

  private generateTimestampedFilename(prefix: string, extension: string): string {
    const timestamp = new Date().toISOString()
      .replaceAll(/[:.]/g, '-')
      .replace('T', '_')
      .split('.')[0];
    return `${prefix}_${timestamp}.${extension}`;
  }

  private async getContainerStatus(projectPath: string): Promise<{
    containers: Array<{ name: string; ports: string; status: string }>;
    running: boolean;
  }> {
    try {
      // Get project name from path
      const projectName = projectPath.split('/').pop() || 'wp-spin';
      const containersOutput = execSync('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}"', { encoding: 'utf8' }).trim();
      const containerList = containersOutput.split('\n');
      const containers = [];
      let anyRunning = false;

      for (const containerInfo of containerList) {
        const [name, status, ports] = containerInfo.split('|');
        // Only include containers for this project
        if (name.includes(projectName)) {
          const isRunning = status.toLowerCase().includes('up');
          if (isRunning) anyRunning = true;
          containers.push({
            name,
            ports: ports || 'No ports exposed',
            status: isRunning ? 'Running' : 'Stopped',
          });
        }
      }

      return {
        containers,
        running: anyRunning,
      };
    } catch {
      return {
        containers: [],
        running: false,
      };
    }
  }

  private async getCurrentSiteInfo(): Promise<{
    isMultisite: boolean;
    multisiteType?: string;
    siteTitle: string;
    siteUrl: string;
  }> {
    const containerName = this.getContainerNames().wordpress;
    
    try {
      // Get basic site info
      const siteUrl = execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && wp option get siteurl --allow-root'`,
        { encoding: 'utf8' }
      ).trim();
      
      const siteTitle = execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && wp option get blogname --allow-root'`,
        { encoding: 'utf8' }
      ).trim();
      
      // Check if multisite is enabled
      let isMultisite = false;
      let multisiteType;
      
      try {
        const multisiteCheck = execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp config get MULTISITE --allow-root 2>/dev/null'`,
          { encoding: 'utf8' }
        ).trim();
        
        isMultisite = multisiteCheck === 'true';
        
        if (isMultisite) {
          const subdomainInstall = execSync(
            `docker exec ${containerName} sh -c 'cd /var/www/html && wp config get SUBDOMAIN_INSTALL --allow-root 2>/dev/null'`,
            { encoding: 'utf8' }
          ).trim();
          
          multisiteType = subdomainInstall === 'true' ? 'subdomain' : 'path';
        }
      } catch {
        // Not a multisite or config not accessible
      }
      
      return {
        isMultisite,
        multisiteType,
        siteTitle,
        siteUrl,
      };
    } catch {
      // Return defaults if we can't get info
      return {
        isMultisite: false,
        siteTitle: 'WordPress Site',
        siteUrl: 'http://localhost',
      };
    }
  }

  private async handleExport(name: string | undefined, flags: Record<string, unknown>): Promise<void> {
    const spinner = ora('Exporting database...').start();
    
    try {
      const projectPath = this.docker.getProjectPath();
      const backupDir = join(projectPath, 'database-backups');
      await fs.ensureDir(backupDir);
      
      // Generate filename if not provided
      const exportFile = name || this.generateTimestampedFilename('backup', 'sql');
      const filePath = this.isAbsolutePath(exportFile) ? exportFile : join(backupDir, exportFile);
      
      const { mysql: mysqlContainer } = this.getContainerNames();
      
      // Build mysqldump command with table exclusions
      let mysqldumpCommand = 'mysqldump -u wordpress -pwordpress wordpress';
      
      // Add table exclusions if specified
      if (flags['exclude-tables']) {
        const excludeTables = (flags['exclude-tables'] as string).split(',').map(t => t.trim());
        const excludeOptions = excludeTables.map(table => `--ignore-table=wordpress.${table}`).join(' ');
        mysqldumpCommand += ` ${excludeOptions}`;
      }
      
      // Export database directly from MySQL container
      spinner.text = 'Exporting database from MySQL container...';
      const exportOutput = execSync(
        `docker exec ${mysqlContainer} sh -c '${mysqldumpCommand}'`,
        { encoding: 'utf8' }
      );
      
      // Write export to file
      spinner.text = 'Writing database export to file...';
      await fs.writeFile(filePath, exportOutput);
      
      // Compress if file is large (>10MB)
      const stats = await fs.stat(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        spinner.text = 'Compressing large database export...';
        execSync(`gzip "${filePath}"`, { stdio: 'pipe' });
        const compressedPath = `${filePath}.gz`;
        spinner.succeed(`Database exported and compressed to: ${chalk.cyan(compressedPath)}`);
        this.log(`File size: ${chalk.blue(this.formatFileSize(await fs.stat(compressedPath)))}`);
      } else {
        spinner.succeed(`Database exported to: ${chalk.cyan(filePath)}`);
        this.log(`File size: ${chalk.blue(this.formatFileSize(stats))}`);
      }
      
    } catch (error) {
      spinner.fail('Database export failed');
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async handleImport(filename: string | undefined, flags: Record<string, unknown>): Promise<void> {
    if (!filename) {
      this.error('Import filename is required. Usage: wp-spin db import <filename>');
    }
    
    const projectPath = this.docker.getProjectPath();
    const backupDir = join(projectPath, 'database-backups');
    const filePath = this.isAbsolutePath(filename) ? filename : join(backupDir, filename);
    
    // Check if file exists (handle both .sql and .sql.gz)
    let importFile = filePath;
    let isCompressed = false;
    
    if (!await fs.pathExists(filePath)) {
      if (await fs.pathExists(`${filePath}.gz`)) {
        importFile = `${filePath}.gz`;
        isCompressed = true;
      } else {
        this.error(`Import file not found: ${filePath}`);
      }
    }
    
    // Confirm import action unless forced
    if (!flags.force) {
      const prompt = createPromptModule();
      const { confirm } = await prompt({
        default: false,
        message: `This will replace the current database. Are you sure?`,
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('Import cancelled');
        return;
      }
    }
    
    const spinner = ora('Importing database...').start();
    
    try {
      // Decompress if needed
      let finalImportFile = importFile;
      if (isCompressed) {
        spinner.text = 'Decompressing database file...';
        const tempFile = join(projectPath, 'temp-import.sql');
        execSync(`gunzip -c "${importFile}" > "${tempFile}"`, { stdio: 'pipe' });
        finalImportFile = tempFile;
      }
      
      const { mysql: mysqlContainer } = this.getContainerNames();
      
      // Get current site information for URL replacement
      const currentSiteInfo = await this.getCurrentSiteInfo();
      
      // Import database directly to MySQL container
      spinner.text = 'Importing database...';
      const sqlContent = await fs.readFile(finalImportFile, 'utf8');
      
      // Use stdin to pipe the SQL content to mysql
      execSync(
        `docker exec -i ${mysqlContainer} mysql -u wordpress -pwordpress wordpress`,
        { input: sqlContent, stdio: 'pipe' }
      );
      
      // Handle WordPress-specific post-import tasks
      await this.handlePostImportTasks(currentSiteInfo, flags, spinner);
      
      // Clean up temporary files
      if (isCompressed) {
        await fs.remove(join(projectPath, 'temp-import.sql'));
      }
      
      spinner.succeed('Database imported successfully');
      
      // Display important post-import information
      this.displayPostImportInfo(currentSiteInfo);
      
    } catch (error) {
      spinner.fail('Database import failed');
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async handlePostImportTasks(
    currentSiteInfo: SiteInfo,
    flags: Record<string, unknown>,
    spinner: { text: string }
  ): Promise<void> {
    const containerName = this.getContainerNames().wordpress;
    
    // Handle URL replacement (skip if flag is set)
    if (flags['skip-url-update']) {
      spinner.text = 'Skipping URL updates (--skip-url-update flag provided)...';
    } else if (flags['search-replace']) {
      spinner.text = 'Performing URL search and replace...';
      const [oldUrl, newUrl] = (flags['search-replace'] as string).split(',');
      if (oldUrl && newUrl) {
        execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp search-replace "${oldUrl.trim()}" "${newUrl.trim()}" --all-tables --allow-root'`,
          { stdio: 'pipe' }
        );
      }
    } else {
      // Auto-replace URLs to match current environment
      spinner.text = 'Updating URLs for current environment...';
      try {
        // Get the old site URL from the imported database
        const oldSiteUrl = execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp option get siteurl --allow-root 2>/dev/null'`,
          { encoding: 'utf8' }
        ).trim();
        
        const oldHomeUrl = execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp option get home --allow-root 2>/dev/null'`,
          { encoding: 'utf8' }
        ).trim();
        
        // Replace old URLs with current environment URL
        if (oldSiteUrl && oldSiteUrl !== currentSiteInfo.siteUrl) {
          spinner.text = `Replacing URLs: ${oldSiteUrl} → ${currentSiteInfo.siteUrl}`;
          execSync(
            `docker exec ${containerName} sh -c 'cd /var/www/html && wp search-replace "${oldSiteUrl}" "${currentSiteInfo.siteUrl}" --all-tables --allow-root 2>/dev/null'`,
            { stdio: 'pipe' }
          );
        }
        
        if (oldHomeUrl && oldHomeUrl !== currentSiteInfo.siteUrl && oldHomeUrl !== oldSiteUrl) {
          spinner.text = `Replacing home URLs: ${oldHomeUrl} → ${currentSiteInfo.siteUrl}`;
          execSync(
            `docker exec ${containerName} sh -c 'cd /var/www/html && wp search-replace "${oldHomeUrl}" "${currentSiteInfo.siteUrl}" --all-tables --allow-root 2>/dev/null'`,
            { stdio: 'pipe' }
          );
        }
        
        // Also update the WordPress options directly to ensure they're set correctly
        execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp option update siteurl "${currentSiteInfo.siteUrl}" --allow-root 2>/dev/null'`,
          { stdio: 'pipe' }
        );
        
        execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp option update home "${currentSiteInfo.siteUrl}" --allow-root 2>/dev/null'`,
          { stdio: 'pipe' }
        );
        
      } catch {
        // Continue if URL replacement fails - fallback to basic option updates
        try {
          execSync(
            `docker exec ${containerName} sh -c 'cd /var/www/html && wp option update siteurl "${currentSiteInfo.siteUrl}" --allow-root 2>/dev/null'`,
            { stdio: 'pipe' }
          );
          execSync(
            `docker exec ${containerName} sh -c 'cd /var/www/html && wp option update home "${currentSiteInfo.siteUrl}" --allow-root 2>/dev/null'`,
            { stdio: 'pipe' }
          );
        } catch {
          // Final fallback - continue without URL updates
        }
      }
    }
    
    // Flush rewrite rules and caches
    spinner.text = 'Clearing WordPress caches...';
    try {
      execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && wp rewrite flush --allow-root'`,
        { stdio: 'pipe' }
      );
      execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && wp cache flush --allow-root'`,
        { stdio: 'pipe' }
      );
    } catch {
      // Continue if cache flush fails
    }
    
    // Update admin user if preserving current setup
    if (!flags['skip-user-update']) {
      spinner.text = 'Updating admin user settings...';
      try {
        execSync(
          `docker exec ${containerName} sh -c 'cd /var/www/html && wp user update admin --user_pass=password --allow-root'`,
          { stdio: 'pipe' }
        );
      } catch {
        // Continue if user update fails
      }
    }
  }

  private async handleReset(flags: Record<string, unknown>): Promise<void> {
    // Confirm reset action unless forced
    if (!flags.force) {
      const prompt = createPromptModule();
      const { confirm } = await prompt({
        default: false,
        message: 'This will completely reset the database to a fresh WordPress installation. Are you sure?',
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('Database reset cancelled');
        return;
      }
    }
    
    const spinner = ora('Resetting database...').start();
    
    try {
      const containerName = this.getContainerNames().wordpress;
      
      // Drop all tables
      spinner.text = 'Dropping existing database tables...';
      execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && wp db reset --yes --allow-root'`,
        { stdio: 'pipe' }
      );
      
      // Get current site configuration
      const currentSiteInfo = await this.getCurrentSiteInfo();
      
      // Reinstall WordPress with current settings
      spinner.text = 'Reinstalling WordPress...';
      const installCommand = `wp core install --url="${currentSiteInfo.siteUrl}" --title="${currentSiteInfo.siteTitle}" --admin_user=admin --admin_password=password --admin_email=admin@example.com --allow-root`;
      
      execSync(
        `docker exec ${containerName} sh -c 'cd /var/www/html && ${installCommand}'`,
        { stdio: 'pipe' }
      );
      
      // Handle multisite if it was previously configured
      if (currentSiteInfo.isMultisite) {
        spinner.text = 'Reconfiguring WordPress Multisite...';
        await this.reconfigureMultisite(currentSiteInfo);
      }
      
      spinner.succeed('Database reset completed');
      
      this.log('\nDefault credentials:');
      this.log(`  Username: ${chalk.cyan('admin')}`);
      this.log(`  Password: ${chalk.cyan('password')}`);
      
    } catch (error) {
      spinner.fail('Database reset failed');
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async handleSnapshot(target: string | undefined, flags: Record<string, unknown>): Promise<void> {
    if (!target) {
      this.error('Snapshot action required. Usage: wp-spin db snapshot <create|restore|list|delete> [name]');
    }
    
    const [action, snapshotName] = target.includes(' ') ? target.split(' ') : [target, undefined];
    
    switch (action) {
      case 'create': {
        await this.createSnapshot(snapshotName, flags);
        break;
      }

      case 'delete': {
        await this.deleteSnapshot(snapshotName, flags);
        break;
      }

      case 'list': {
        await this.listSnapshots();
        break;
      }

      case 'restore': {
        await this.restoreSnapshot(snapshotName, flags);
        break;
      }

      default: {
        this.error(`Unknown snapshot action: ${action}. Use create, restore, list, or delete.`);
      }
    }
  }

  private isAbsolutePath(filePath: string): boolean {
    return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
  }

  private async listSnapshots(): Promise<void> {
    const projectPath = this.docker.getProjectPath();
    const snapshotsDir = join(projectPath, 'database-backups', 'snapshots');
    
    if (!await fs.pathExists(snapshotsDir)) {
      this.log('No snapshots found');
      return;
    }
    
    const files = await fs.readdir(snapshotsDir);
    const snapshots = files
      .filter(file => file.endsWith('.sql'))
      .map(file => file.replace('.sql', ''));
    
    if (snapshots.length === 0) {
      this.log('No snapshots found');
      return;
    }
    
    this.log(`\nAvailable snapshots:\n`);
    
    const snapshotPromises = snapshots.map(async (snapshot) => {
      const snapshotPath = join(snapshotsDir, `${snapshot}.sql`);
      const metadataPath = join(snapshotsDir, `${snapshot}.meta.json`);
      
      const stats = await fs.stat(snapshotPath);
      let metadata = null;
      
      if (await fs.pathExists(metadataPath)) {
        metadata = await fs.readJSON(metadataPath);
      }
      
      return { metadata, snapshot, stats };
    });
    
    const snapshotData = await Promise.all(snapshotPromises);
    
    for (const { metadata, snapshot, stats } of snapshotData) {
      this.log(`  ${chalk.cyan(snapshot)}`);
      if (metadata) {
        this.log(`    Created: ${chalk.gray(new Date(metadata.created).toLocaleString())}`);
        if (metadata.siteInfo?.siteUrl) {
          this.log(`    Site URL: ${chalk.gray(metadata.siteInfo.siteUrl)}`);
        }
      }

      this.log(`    Size: ${chalk.gray(this.formatFileSize(stats))}`);
      
      this.log('');
    }
  }

  private async reconfigureMultisite(siteInfo: SiteInfo): Promise<void> {
    const containerName = this.getContainerNames().wordpress;
    
    const multisiteCommand = siteInfo.multisiteType === 'subdomain'
      ? `wp core multisite-convert --title="${siteInfo.siteTitle}" --subdomains --allow-root`
      : `wp core multisite-convert --title="${siteInfo.siteTitle}" --allow-root`;
    
    execSync(
      `docker exec ${containerName} sh -c 'cd /var/www/html && ${multisiteCommand}'`,
      { stdio: 'pipe' }
    );
  }

  private async resolveSite(siteInput: string): Promise<void> {
    try {
      // Use the BaseCommand's site resolution logic
      const sitePath = this.resolveSitePath(siteInput);
      
      // Reinitialize the docker service with the resolved path
      const { DockerService } = await import('../services/docker.js');
      this.docker = new DockerService(sitePath, this);
      
      // Check if this site is actually a wp-spin project
      const wpSpinConfigPath = join(sitePath, '.wp-spin');
      if (!await fs.pathExists(wpSpinConfigPath)) {
        this.error(`The specified path is not a wp-spin project: ${sitePath}`);
      }
      
      // Verify containers are running
      const { running } = await this.getContainerStatus(sitePath);
      if (!running) {
        this.error(`WordPress environment is not running for site: ${siteInput}. Run 'wp-spin start --site=${siteInput}' first.`);
      }
      
    } catch (error) {
      this.error(`Failed to resolve site '${siteInput}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async restoreSnapshot(name: string | undefined, flags: Record<string, unknown>): Promise<void> {
    if (!name) {
      this.error('Snapshot name is required for restore');
    }
    
    const projectPath = this.docker.getProjectPath();
    const snapshotsDir = join(projectPath, 'database-backups', 'snapshots');
    const snapshotPath = join(snapshotsDir, `${name}.sql`);
    
    if (!await fs.pathExists(snapshotPath)) {
      this.error(`Snapshot "${name}" not found`);
    }
    
    // Load snapshot metadata if available
    const metadataPath = join(snapshotsDir, `${name}.meta.json`);
    let metadata = null;
    if (await fs.pathExists(metadataPath)) {
      metadata = await fs.readJSON(metadataPath);
    }
    
    if (!flags.force) {
      const prompt = createPromptModule();
      const message = metadata 
        ? `Restore snapshot "${name}" created on ${new Date(metadata.created).toLocaleString()}?`
        : `Restore snapshot "${name}"?`;
        
      const { confirm } = await prompt({
        default: false,
        message,
        name: 'confirm',
        type: 'confirm',
      });
      
      if (!confirm) {
        this.log('Snapshot restore cancelled');
        return;
      }
    }
    
    // Use the import functionality
    await this.handleImport(`snapshots/${name}.sql`, { ...flags, force: true });
    
    this.log(`Snapshot "${chalk.cyan(name)}" restored successfully`);
  }
}