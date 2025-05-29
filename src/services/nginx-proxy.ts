import { execa } from 'execa';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import net from 'node:net';
import * as os from 'node:os';
import { join } from 'node:path';

export class NginxProxyService {
  private readonly certsDir: string;
  private readonly configDir: string;
  private readonly containerName = 'wp-spin-nginx-proxy';
  private readonly defaultConfig = `
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;
    error_log   /var/log/nginx/error.log;

    sendfile        on;
    keepalive_timeout  65;

    include /etc/nginx/conf.d/*.conf;
}
`;

  constructor() {
    this.certsDir = join(os.homedir(), '.wp-spin', 'nginx-proxy', 'certs');
    this.configDir = join(os.homedir(), '.wp-spin', 'nginx-proxy');
    this.ensureCertsDir();
    this.ensureConfigDir();
  }

  public async addDomain(domain: string, port: number, ssl?: boolean): Promise<void> {
    try {
      this.addHostsEntry(domain);
      this.updateNginxConfig(domain, port, ssl);
      await this.ensureContainerRunning();
      await this.reloadNginx();
    } catch (error) {
      throw new Error(`Failed to configure domain ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async generateSSLCert(domain: string): Promise<{ cert: string, key: string }> {
    const hostCertPath = join(this.certsDir, `${domain}.pem`);
    const hostKeyPath = join(this.certsDir, `${domain}-key.pem`);
    if (!fs.existsSync(hostCertPath) || !fs.existsSync(hostKeyPath)) {
      // Run mkcert to generate cert and key in the host certs dir
      await execa('mkcert', ['-cert-file', hostCertPath, '-key-file', hostKeyPath, domain], { stdio: 'inherit' });
    }

    // Return container paths for nginx config
    return { cert: `/etc/nginx/certs/${domain}.pem`, key: `/etc/nginx/certs/${domain}-key.pem` };
  }

  public async removeDomain(domain: string): Promise<void> {
    try {
      const configPath = join(this.configDir, 'conf.d', `${domain}.conf`);
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      await this.ensureContainerRunning();
      this.removeHostsEntry(domain);
      await this.reloadNginx();
    } catch (error) {
      throw new Error(`Failed to remove domain ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private addHostsEntry(domain: string): void {
    try {
      const hostsEntry = `127.0.0.1 ${domain}`;
      const hostsFile = '/etc/hosts';
      const hostsContent = fs.readFileSync(hostsFile, 'utf8');
      if (hostsContent.includes(hostsEntry)) {
        return;
      }

      try {
        execSync(`echo "${hostsEntry}" | sudo tee -a ${hostsFile}`, { stdio: 'inherit' });
      } catch {
        throw new Error(
          `Failed to update /etc/hosts. You may need to run the command with sudo or manually add this line to /etc/hosts:\n${hostsEntry}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('sudo')) {
        throw error;
      }

      throw new Error(`Failed to update /etc/hosts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureCertsDir(): void {
    if (!fs.existsSync(this.certsDir)) {
      execSync(`sudo mkdir -p ${this.certsDir}`, { stdio: 'inherit' });
    }

    // Set permissions
    const username = process.env.USER || process.env.USERNAME || 'root';

    let group: string;
    switch (process.platform) {
      case 'darwin': { group = 'staff'; break; }
      case 'linux': {
        try { group = execSync(`id -gn ${username}`, { encoding: 'utf8' }).trim(); } catch { group = username; }
        break;
      }

      default: { group = username; }
    }

    if (process.platform !== 'win32') {
      execSync(`sudo chown -R ${username}:${group} ${this.certsDir}`, { stdio: 'inherit' });
    }
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      execSync(`sudo mkdir -p ${this.configDir}`, { stdio: 'inherit' });
    }

    const nginxConfPath = join(this.configDir, 'nginx.conf');
    if (!fs.existsSync(nginxConfPath)) {
      execSync(`echo '${this.defaultConfig}' | sudo tee ${nginxConfPath}`, { stdio: 'inherit' });
    }

    const confDir = join(this.configDir, 'conf.d');
    if (!fs.existsSync(confDir)) {
      execSync(`sudo mkdir -p ${confDir}`, { stdio: 'inherit' });
    }

    // Set proper permissions based on OS
    const username = process.env.USER || process.env.USERNAME || 'root';
    let group: string;

    switch (process.platform) {
    case 'darwin': {
      // On macOS, use the staff group
      group = 'staff';
    
    break;
    }

    case 'linux': {
      // On Linux, try to get the user's primary group
      try {
        group = execSync(`id -gn ${username}`, { encoding: 'utf8' }).trim();
      } catch {
        // Fallback to username if we can't get the group
        group = username;
      }
    
    break;
    }

    case 'win32': {
      // On Windows, we don't use groups in the same way
      // Just use the username for both user and group
      group = username;
      // On Windows, we need to ensure the directory is accessible
      try {
        execSync(`icacls "${this.configDir}" /grant "${username}:(OI)(CI)F"`, { stdio: 'inherit' });
      } catch (error) {
        console.warn('Warning: Failed to set Windows permissions:', error instanceof Error ? error.message : String(error));
      }
    
    break;
    }

    default: {
      // On other platforms, use the username as the group
      group = username;
    }
    }

    // Only run chown on Unix-like systems
    if (process.platform !== 'win32') {
      execSync(`sudo chown -R ${username}:${group} ${this.configDir}`, { stdio: 'inherit' });
    }
  }

  private async ensureContainerRunning(): Promise<void> {
    try {
      const containerExists = execSync(`docker ps -a --filter "name=${this.containerName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim() === this.containerName;
      
      if (containerExists) {
        const isRunning = execSync(`docker ps --filter "name=${this.containerName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim() === this.containerName;
        if (!isRunning) {
          execSync(`docker start ${this.containerName}`, { stdio: 'inherit' });
        }
      } else {
        // Start the container with ports 80 and 443 exposed, and mount certs
        execSync(`docker run -d --name ${this.containerName} \
          -p 80:80 -p 443:443 \
          -v ${this.configDir}/nginx.conf:/etc/nginx/nginx.conf:ro \
          -v ${this.configDir}/conf.d:/etc/nginx/conf.d:ro \
          -v ${this.certsDir}:/etc/nginx/certs:ro \
          --add-host=host.docker.internal:host-gateway \
          nginx:stable`, { stdio: 'inherit' });
      }
    } catch (error) {
      throw new Error(`Failed to ensure NGINX container is running: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port);
    });
  }

  private async reloadNginx(): Promise<void> {
    try {
      execSync(`docker exec ${this.containerName} nginx -s reload`, { stdio: 'inherit' });
    } catch (error) {
      throw new Error(`Failed to reload NGINX: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private removeHostsEntry(domain: string): void {
    const hostsFile = '/etc/hosts';
    const hostsEntry = `127.0.0.1 ${domain}`;
    const hostsContent = fs.readFileSync(hostsFile, 'utf8');
    const newContent = hostsContent
      .split('\n')
      .filter(line => !line.includes(hostsEntry))
      .join('\n');
    try {
      execSync(`echo "${newContent}" | sudo tee ${hostsFile}`, { stdio: 'inherit' });
    } catch {
      throw new Error(
        `Failed to update /etc/hosts. You may need to run the command with sudo or manually remove this line from /etc/hosts:\n${hostsEntry}`
      );
    }
  }

  private updateNginxConfig(domain: string, port: number, ssl?: boolean): void {
    const configPath = join(this.configDir, 'conf.d', `${domain}.conf`);
    const hostCertPath = join(this.certsDir, `${domain}.pem`);
    const hostKeyPath = join(this.certsDir, `${domain}-key.pem`);
    const containerCertPath = `/etc/nginx/certs/${domain}.pem`;
    const containerKeyPath = `/etc/nginx/certs/${domain}-key.pem`;
    let config = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://host.docker.internal:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
    if (ssl && fs.existsSync(hostCertPath) && fs.existsSync(hostKeyPath)) {
      config += `
server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate ${containerCertPath};
    ssl_certificate_key ${containerKeyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://host.docker.internal:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
    }

    const existingConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';

    if (existingConfig !== config) {
      execSync(`echo '${config}' | sudo tee ${configPath}`, { stdio: 'inherit' });
    }
  }
} 