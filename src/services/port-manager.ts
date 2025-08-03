import * as fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

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
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.portMapping, null, 2));
    } catch (error) {
      console.warn('Failed to save port mapping:', error);
    }
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

  private getUsedPorts(): Set<number> {
    return new Set(Object.values(this.portMapping).map(mapping => mapping.port));
  }

  async findAvailablePort(startPort: number = 8080): Promise<number> {
    const usedPorts = this.getUsedPorts();
    let port = startPort;

    while (usedPorts.has(port) || await this.isPortInUse(port)) {
      port++;
    }

    return port;
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

  getPortForDomain(domain: string): number | undefined {
    return this.portMapping[domain]?.port;
  }

  getDomainForPort(port: number): string | undefined {
    return Object.entries(this.portMapping).find(([_, mapping]) => mapping.port === port)?.[0];
  }

  async releasePort(domain: string): Promise<void> {
    if (this.portMapping[domain]) {
      delete this.portMapping[domain];
      this.savePortMapping();
    }
  }

  async cleanupStalePorts(): Promise<void> {
    const currentMapping = { ...this.portMapping };
    
    for (const [domain, mapping] of Object.entries(currentMapping)) {
      // Check if project directory still exists
      if (!fs.existsSync(mapping.projectPath)) {
        await this.releasePort(domain);
      }
    }
  }

  getAllPortMappings(): PortMapping {
    return { ...this.portMapping };
  }
} 