import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

interface PortMapping {
  [domain: string]: {
    port: number;
    projectPath: string;
  };
}

export class PortManagerService {
  private readonly configPath: string;
  private portMapping: PortMapping;

  constructor() {
    this.configPath = path.join(homedir(), '.wp-spin', 'port-mapping.json');
    this.portMapping = this.loadPortMapping();
  }

  async allocatePort(domain: string, projectPath: string): Promise<number> {
    // Check if domain already has a port
    if (this.portMapping[domain]) {
      return this.portMapping[domain].port;
    }

    // Find an available port
    const port = await this.findAvailablePort();
    
    // Store the mapping
    this.portMapping[domain] = {
      port,
      projectPath,
    };
    
    this.savePortMapping();
    return port;
  }

  async cleanupStalePorts(): Promise<void> {
    const currentMapping = { ...this.portMapping };
    
    // Collect domains to release first, then process them
    const domainsToRelease = Object.entries(currentMapping)
      .filter(([, mapping]) => !fs.existsSync(mapping.projectPath))
      .map(([domain]) => domain);
    
    // Process releases in parallel
    await Promise.all(domainsToRelease.map(domain => this.releasePort(domain)));
  }

  async findAvailablePort(startPort: number = 8080): Promise<number> {
    const usedPorts = this.getUsedPorts();
    
    // Generate list of candidate ports
    const candidatePorts = Array.from({ length: 1000 }, (_, i) => startPort + i)
      .filter(port => !usedPorts.has(port));
    
    // Check ports one by one using recursive approach to avoid await in loop
    const findFirstAvailable = async (ports: number[]): Promise<number> => {
      if (ports.length === 0) {
        throw new Error('No available ports found in range');
      }
      
      const [currentPort, ...remainingPorts] = ports;
      const inUse = await this.isPortInUse(currentPort);
      
      return inUse ? findFirstAvailable(remainingPorts) : currentPort;
    };
    
    return findFirstAvailable(candidatePorts);
  }

  getAllPortMappings(): PortMapping {
    return { ...this.portMapping };
  }

  getDomainForPort(port: number): string | undefined {
    return Object.entries(this.portMapping).find(([_, mapping]) => mapping.port === port)?.[0];
  }

  getPortForDomain(domain: string): number | undefined {
    return this.portMapping[domain]?.port;
  }

  async releasePort(domain: string): Promise<void> {
    if (this.portMapping[domain]) {
      delete this.portMapping[domain];
      this.savePortMapping();
    }
  }

  private createDirWithSudo(dir: string, originalError: Error): void {
    try {
      execSync(`sudo mkdir -p "${dir}"`, { stdio: 'inherit' });
      
      // Set proper permissions for the current user
      const { group, username } = this.getUserAndGroup();
      execSync(`sudo chown -R ${username}:${group} "${dir}"`, { stdio: 'inherit' });
    } catch {
      // If sudo fails, throw the original error
      throw originalError;
    }
  }

  private ensureConfigDir(dir: string): void {
    try {
      // Try to create directory with current user permissions first
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      // If it fails and we're not on Windows, try with sudo as fallback
      if (process.platform !== 'win32' && error instanceof Error && error.message.includes('EACCES')) {
        this.createDirWithSudo(dir, error);
      } else {
        // Re-throw the original error for Windows or other error types
        throw error;
      }
    }
  }

  private getUsedPorts(): Set<number> {
    return new Set(Object.values(this.portMapping).map(mapping => mapping.port));
  }

  private getUserAndGroup(): { group: string; username: string; } {
    const username = process.env.USER || process.env.USERNAME || 'root';
    let group: string;

    switch (process.platform) {
      case 'darwin': {
        group = 'staff';
        break;
      }

      case 'linux': {
        try {
          group = execSync(`id -gn ${username}`, { encoding: 'utf8' }).trim();
        } catch {
          group = username;
        }

        break;
      }

      default: {
        group = username;
      }
    }

    return { group, username };
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      let command: string;
      if (process.platform === 'win32') {
        command = `netstat -ano | findstr :${port}`;
      } else {
        // Try ss first (more modern), fallback to netstat, then lsof
        try {
          await execAsync(`ss -tulnp | grep ":${port}"`);
          return true;
        } catch {
          try {
            await execAsync(`netstat -tulnp 2>/dev/null | grep ":${port}"`);
            return true;
          } catch {
            // Fallback to lsof as last resort
            command = `lsof -i :${port}`;
          }
        }
      }

      if (command) {
        await execAsync(command);
      }
      return true;
    } catch {
      return false;
    }
  }

  private loadPortMapping(): PortMapping {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (error) {
      console.warn('Failed to load port mapping:', error);
    }

    return {};
  }

  private retryWithPermissionFix(originalError: Error): void {
    try {
      const { group, username } = this.getUserAndGroup();
      const dir = path.dirname(this.configPath);
      
      // Fix directory permissions first
      execSync(`sudo chown -R ${username}:${group} "${dir}"`, { stdio: 'inherit' });
      
      // Fix file permissions if it exists
      if (fs.existsSync(this.configPath)) {
        execSync(`sudo chown ${username}:${group} "${this.configPath}"`, { stdio: 'inherit' });
      }
      
      // Retry the write operation
      fs.writeFileSync(this.configPath, JSON.stringify(this.portMapping, null, 2));
    } catch (retryError) {
      console.error('Failed to save port mapping after permission fix:', retryError);
      throw originalError; // Throw original error to maintain backwards compatibility
    }
  }

  private savePortMapping(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        this.ensureConfigDir(dir);
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.portMapping, null, 2));
    } catch (error) {
      console.error('Failed to save port mapping:', error);
      
      // If we get a permission error, try to fix the file permissions and retry
      if (error instanceof Error && error.message.includes('EACCES') && process.platform !== 'win32') {
        this.retryWithPermissionFix(error);
      } else {
        throw error; // Throw original error for Windows or other error types
      }
    }
  }
} 