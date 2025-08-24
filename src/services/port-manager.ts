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

  private ensureConfigDir(dir: string): void {
    if (process.platform === 'win32') {
      fs.mkdirSync(dir, { recursive: true });
    } else {
      execSync(`sudo mkdir -p "${dir}"`, { stdio: 'inherit' });

      // Set proper permissions
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

      execSync(`sudo chown -R ${username}:${group} "${dir}"`, { stdio: 'inherit' });
    }
  }

  private getUsedPorts(): Set<number> {
    return new Set(Object.values(this.portMapping).map(mapping => mapping.port));
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const command = process.platform === 'win32'
        ? `netstat -ano | findstr :${port}`
        : `lsof -i :${port}`;

      await execAsync(command);
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

  private savePortMapping(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        this.ensureConfigDir(dir);
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.portMapping, null, 2));
    } catch (error) {
      console.warn('Failed to save port mapping:', error);
    }
  }
} 