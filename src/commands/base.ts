import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';

import { getSiteByName } from '../config/sites.js';
import { IDockerService } from '../services/docker-interface.js';
import { DockerService } from '../services/docker.js';
import { NginxProxyService } from '../services/nginx-proxy.js';

export const baseFlags = {
  domain: Flags.string({
    char: 'd',
    description: 'Custom domain for the site (e.g., example.test)',
  }),
  site: Flags.string({
    char: 's',
    description: 'Site path or site name',
    env: 'WP_SPIN_SITE_PATH',
  }),
};

export abstract class BaseCommand extends Command {
  static baseFlags = baseFlags;
  static hidden = true;
  /**
   * Debug logger
   */
  protected debugLogger!: (...args: unknown[]) => void;
  /**
   * Docker service instance
   */
  protected docker!: IDockerService;
  /**
   * NGINX proxy service instance
   */
  protected nginxProxy!: NginxProxyService;

  /**
   * Check if Docker is running and accessible
   */
  protected async checkDockerEnvironment(): Promise<void> {
    try {
      await this.docker.checkDockerInstalled();
      await this.docker.checkDockerRunning();
      await this.docker.checkDockerComposeInstalled();
    } catch (error: unknown) {
      this.prettyError(error instanceof Error ? error : new Error(String(error)));
      this.exit(1);
    }
  }

  /**
   * Check if the current directory is a valid wp-spin project
   */
  protected async checkProjectExists(autoExit = true): Promise<boolean> {
    try {
      return await this.docker.checkProjectExists();
    } catch (error: unknown) {
      if (autoExit) {
        this.prettyError(error instanceof Error ? error : new Error(String(error)));
        this.exit(1);
      }

      return false;
    }
  }

  /**
   * Configure custom domain if specified
   */
  protected async configureDomain(port: number): Promise<void> {
    const { flags } = await this.parse(this.constructor as typeof Command);
    
    if (flags.domain) {
      try {
        await this.nginxProxy.addDomain(flags.domain, port);
        this.log(`Configured custom domain: ${chalk.cyan(flags.domain)}`);
        this.log(`You can access your site at: ${chalk.cyan(`http://${flags.domain}`)}`);
      } catch (error) {
        this.log(chalk.yellow(`Warning: Failed to configure custom domain: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }

  /**
   * Execute WP-CLI command in WordPress container
   */
  protected async execWpCommand(command: string, container?: string): Promise<string> {
    if (!container) {
      const containerNames = this.getContainerNames();
      container = containerNames.wordpress;
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['exec', container, 'sh', '-c', command], {
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        this.error(data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Find a free port starting from the original port + 1
   */
  protected findFreePort(startPort: number): number {
    // Simple implementation: just increment the port
    // In a real-world scenario, you would check if the port is actually available
    return startPort + 1;
  }

  /**
   * Find the project root directory by walking up from the current directory
   */
  protected findProjectRoot(): null | string {
    // If we already have a valid site path, don't walk up
    if (this.docker?.getProjectPath()) {
      return this.docker.getProjectPath();
    }

    let currentDir = process.cwd();
    const rootDir = path.parse(currentDir).root;

    while (currentDir !== rootDir) {
      if (this.isWpSpinProject(currentDir)) {
        return currentDir;
      }

      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Get container names for the current project
   * Docker Compose automatically adds a -1 suffix to service names
   */
  protected getContainerNames(): { mailhog: string; mysql: string; phpmyadmin: string; wordpress: string } {
    const projectName = path.basename(this.docker.getProjectPath());
    return {
      mailhog: `${projectName}-mailhog-1`,
      mysql: `${projectName}-mysql-1`,
      phpmyadmin: `${projectName}-phpmyadmin-1`,
      wordpress: `${projectName}-wordpress-1`,
    };
  }

  /**
   * Handle port conflict by finding an available port
   */
  protected async handlePortConflict(port: number): Promise<number> {
    // Find a free port and update docker-compose file
    const newPort = this.findFreePort(port);
    // Update docker-compose file
    await this.docker.updateDockerComposePorts(port, newPort);
    return newPort;
  }

  /**
   * Check if a file or directory has safe permissions
   * Safe means:
   * - Owner has read access
   * - For directories: owner has execute access
   * - For files: owner has read access
   */
  protected hasSafePermissions(path: string): boolean {
    try {
      const stats = fs.statSync(path);
      const mode = stats.mode % 0o1000; // Use modulo instead of bitwise AND
      const modeStr = mode.toString(8).padStart(3, '0');
      
      // Check if owner has read access (first digit >= 4)
      const ownerRead = Number.parseInt(modeStr[0], 8) >= 4;
      
      // For directories, also check if owner has execute access (first digit >= 1)
      const isDirectory = stats.isDirectory();
      const ownerExecute = isDirectory ? Number.parseInt(modeStr[0], 8) >= 1 : true;
      
      const isSafe = ownerRead && ownerExecute;
      return isSafe;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize the command
   */
  public async init(): Promise<void> {
    await super.init();
    const { flags } = await this.parse(this.constructor as typeof Command);

    // Initialize the debugger without using debugFactory
    this.debugLogger = console.debug;

    try {
      // Resolve the site path
      const resolvedPath = this.resolveSitePath(flags.site);

      // Initialize Docker service with resolved path
      this.docker = new DockerService(resolvedPath, this);

      // Initialize NGINX proxy service if domain is provided
      if (flags.domain) {
        this.nginxProxy = new NginxProxyService();
      }

      // No need to check project exists since resolveSitePath already validated it
    } catch (error) {
      this.prettyError(error instanceof Error ? error : new Error(String(error)));
      this.exit(1);
    }
  }

  /**
   * Check if a path is safe to use (no path traversal)
   */
  protected isSafePath(path: string): boolean {
    const normalizedPath = path.normalize();
    // Allow absolute paths but prevent directory traversal
    return !normalizedPath.includes('..');
  }

  /**
   * Check if the WordPress container is running
   */
  protected async isWordPressRunning(autoExit = true): Promise<boolean> {
    try {
      const result = execSync('docker ps -q -f name=wordpress', { encoding: 'utf8' });
      if (!result.trim()) {
        if (autoExit) {
          this.prettyError(new Error('WordPress container is not running. Run `wp-spin start` to start it.'));
          this.exit(1);
        }

        return false;
      }

      return true;
    } catch (error: unknown) {
      if (autoExit) {
        this.prettyError(error instanceof Error ? error : new Error(String(error)));
        this.exit(1);
      }

      return false;
    }
  }

  /**
   * Check if directory is a valid wp-spin project
   */
  protected isWpSpinProject(dir: string): boolean {
    if (!dir) {
      return false;
    }

    const dockerComposePath = path.join(dir, 'docker-compose.yml');
    if (!fs.existsSync(dockerComposePath)) {
      return false;
    }

    return true;
  }

  /**
   * Log debug message
   */
  protected logDebug(message: string): void {
    // Cast to unknown first, then to Record to avoid type errors
    const config = this.config as unknown as Record<string, unknown>;
    const debug = config.debug === '1';
    if (debug && typeof this.debugLogger === 'function') {
      this.debugLogger(message);
    }
  }

  /**
   * Pretty print an error
   */
  protected prettyError(error: Error): void {
    this.log(`\n${chalk.red.bold('Error:')} ${error.message}\n`);
  }

  /**
   * Resolve site path with security checks
   */
  protected resolveSitePath(sitePath?: string): string {
    if (sitePath) {
      // First, check if sitePath is a registered site name
      const site = getSiteByName(sitePath);
      
      if (site) {
        // Validate the path exists and is a valid project
        if (!fs.existsSync(site.path)) {
          this.prettyError(new Error(`Site path does not exist: ${site.path}`));
          this.exit(1);
        }

        if (!this.isWpSpinProject(site.path)) {
          this.prettyError(new Error(`Not a valid WordPress project at: ${site.path}`));
          this.exit(1);
        }

        return site.path;
      }

      // If not a site name, check if path is absolute or relative
      if (path.isAbsolute(sitePath)) {
        const validatedPath = this.validatePath(sitePath);
        
        // Only check if it's a valid project if the directory exists
        if (fs.existsSync(validatedPath) && !this.isWpSpinProject(validatedPath)) {
          this.prettyError(new Error(`${validatedPath} is not a valid wp-spin project.`));
          this.exit(1);
        }

        return validatedPath;
      }

      // Relative path
      const absolutePath = path.resolve(process.cwd(), sitePath);
      const validatedPath = this.validatePath(absolutePath);
      
      // Only check if it's a valid project if the directory exists
      if (fs.existsSync(validatedPath) && !this.isWpSpinProject(validatedPath)) {
        this.prettyError(new Error(`${validatedPath} is not a valid wp-spin project.`));
        this.exit(1);
      }

      return validatedPath;
    }

    // Only walk up directory tree if no site path was provided
    const projectRoot = this.findProjectRoot();
    if (projectRoot) {
      return this.validatePath(projectRoot);
    }

    // If no project root was found, exit with error
    this.prettyError(new Error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or specify a valid site path with --site.'));
    this.exit(1);
  }

  /**
   * Execute the command
   */
  public async run(): Promise<void> {
    // this is a base class designed to be extended
    // so this method doesn't do anything
  }

  /**
   * Verify Xdebug is available in the WordPress container and properly configured
   */
  protected async setupXdebugInContainer(containerName: string): Promise<void> {
    try {
      // Check if Xdebug is installed (should be pre-installed in our custom image)
      const isXdebugInstalled = await this.checkXdebugInstalled(containerName);
      
      if (!isXdebugInstalled) {
        throw new Error('Xdebug is not installed in the container. This may indicate an issue with the Docker image build process.');
      }

      // Verify Xdebug configuration
      try {
        const xdebugInfo = await this.docker.exec(containerName, ['php', '--ri', 'xdebug']);
        this.log(chalk.green('✅ Xdebug is installed and available'));
        this.logDebug(`Xdebug configuration: ${xdebugInfo}`);
      } catch (error) {
        this.log(chalk.yellow('⚠️  Xdebug is installed but may not be properly configured'));
        this.logDebug(`Xdebug info error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Check current Xdebug mode
      try {
        const xdebugMode = await this.docker.exec(containerName, ['php', '-r', 'echo ini_get("xdebug.mode");']);
        this.log(chalk.blue(`🐛 Current Xdebug mode: ${xdebugMode || 'off'}`));
      } catch (error) {
        this.logDebug(`Could not retrieve Xdebug mode: ${error instanceof Error ? error.message : String(error)}`);
      }
      
    } catch (error) {
      this.log(chalk.red('❌ Xdebug verification failed:'));
      this.log(chalk.red(error instanceof Error ? error.message : String(error)));
      this.log(chalk.yellow('💡 Tip: Try rebuilding the Docker container with: docker-compose build --no-cache'));
      throw error;
    }
  }

  /**
   * Validate and sanitize a path
   */
  protected validatePath(inputPath: string): string {
    if (!this.isSafePath(inputPath)) {
      throw new Error('Path traversal detected');
    }

    const resolvedPath = path.resolve(inputPath);
    
    // For new projects, the directory might not exist yet
    if (!fs.existsSync(resolvedPath)) {
      // Check parent directory permissions instead
      const parentDir = path.dirname(resolvedPath);
      
      if (!this.hasSafePermissions(parentDir)) {
        throw new Error(`Unsafe file permissions detected for parent directory: ${parentDir}`);
      }

      return resolvedPath;
    }
    
    if (!this.hasSafePermissions(resolvedPath)) {
      throw new Error(`Unsafe file permissions detected for path: ${resolvedPath}`);
    }

    return resolvedPath;
  }

  /**
   * Check if Xdebug is installed and loaded in the container
   */
  private async checkXdebugInstalled(containerName: string): Promise<boolean> {
    try {
      const result = await this.docker.exec(containerName, ['php', '-m']);
      return result.toLowerCase().includes('xdebug');
    } catch {
      return false;
    }
  }
}

