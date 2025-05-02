import { Command, Flags } from '@oclif/core';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import debugFactory from 'debug';
import { IDockerService } from '../services/docker-interface.js';
import { DockerService } from '../services/docker.js';
import { getSiteByName } from '../config/sites.js';

export const baseFlags = {
  site: Flags.string({
    char: 's',
    description: 'Site path or site name',
    env: 'WP_SPIN_SITE_PATH',
  }),
};

export abstract class BaseCommand extends Command {
  static baseFlags = baseFlags;

  /**
   * Debug logger
   */
  protected debugLogger!: debugFactory.Debugger;

  /**
   * Docker service instance
   */
  protected docker!: IDockerService;

  /**
   * Initialize the command
   */
  public async init(): Promise<void> {
    await super.init();
    const { flags } = await this.parse(this.constructor as typeof Command);
    
    // Initialize the debugger
    this.debugLogger = debugFactory('wp-spin:base');

    try {
      // Resolve the site path
      const resolvedPath = this.resolveSitePath(flags.site);

      
      // Pass this command instance to DockerService
      this.docker = new DockerService(resolvedPath, this);
    } catch (error) {
      this.prettyError(error instanceof Error ? error : new Error(String(error)));
      this.exit(1);
    }
  }

  /**
   * Execute the command
   */
  public async run(): Promise<void> {
    // this is a base class designed to be extended
    // so this method doesn't do anything
  }

  /**
   * Check if Docker is installed and running
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
   * Check if a file or directory exists
   */
  protected existsSync(path: string): boolean {
    return fs.existsSync(path);
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
   * Find project root by walking up the directory tree
   */
  protected findProjectRoot(startPath?: string): null | string {

    let dockerPath: string | undefined;
    if (this.docker) {
      dockerPath = this.docker.getProjectPath();
    }

    // Force use of Docker service path if it exists, otherwise use startPath, otherwise use cwd
    const effectiveStartPath = dockerPath || startPath || process.cwd();
    let currentPath = effectiveStartPath;

    
    // Walk up the directory tree
    while (currentPath !== path.parse(currentPath).root) {
      if (this.isWpSpinProject(currentPath)) {
        return currentPath;
      }
      
      currentPath = path.dirname(currentPath);
    }
    
    // Check root directory
    if (this.isWpSpinProject(currentPath)) {
      return currentPath;
    }
    
    return null;
  }

  /**
   * Get container names for the current project
   */
  protected getContainerNames(): { mysql: string; wordpress: string } {
    const projectName = path.basename(this.docker.getProjectPath());
    return {
      mysql: `${projectName}_mysql_1`,
      wordpress: `${projectName}_wordpress_1`,
    };
  }

  /**
   * Handle port conflict by finding a free port and updating the docker-compose file
   */
  protected async handlePortConflict(originalPort: number): Promise<number> {
    // Find a free port and update docker-compose file
    const newPort = this.findFreePort(originalPort);
    // Update docker-compose file
    await this.docker.updateDockerComposePorts(originalPort, newPort);
    return newPort;
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
    if (debug) {
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
   * Resolve site path
   */
  protected resolveSitePath(sitePath?: string): string {
    if (sitePath) {
      
      // First, check if sitePath is a registered site name
      try {
        const site = getSiteByName(sitePath);

        if (site) {
          if (!this.isWpSpinProject(site.path)) {
            this.prettyError(new Error(`Registered site "${sitePath}" path (${site.path}) is not a valid wp-spin project.`));
            this.exit(1);
          }

          return site.path;
        }
      } catch (error) {
        this.logDebug(`Error resolving site by name: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Check if path is absolute or relative
      if (path.isAbsolute(sitePath)) {
        if (!this.isWpSpinProject(sitePath)) {
          this.prettyError(new Error(`${sitePath} is not a valid wp-spin project.`));
          this.exit(1);
        }
        
        return sitePath;
      }
      
      // Relative path
      const absolutePath = path.resolve(process.cwd(), sitePath);
      if (!this.isWpSpinProject(absolutePath)) {
        this.prettyError(new Error(`${absolutePath} is not a valid wp-spin project.`));
        this.exit(1);
      }
      
      return absolutePath;
    }
    
    // Use current directory or walk up to find a project
    const projectRoot = this.findProjectRoot();
    if (projectRoot) {
      return projectRoot;
    }
    
    // If no project root was found, just return the current directory
    // This will likely fail later with a more specific error
    this.prettyError(new Error('No WordPress project found in this directory or any parent directory. Make sure you are inside a wp-spin project or specify a valid site path with --site.'));
    this.exit(1);
    return process.cwd(); // This line will never be reached due to this.exit(1) above
  }
}
