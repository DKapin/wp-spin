import { confirm } from '@inquirer/prompts';
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
  private readonly portMapFile: string;

  constructor() {
    this.certsDir = join(os.homedir(), '.wp-spin', 'nginx-proxy', 'certs');
    this.configDir = join(os.homedir(), '.wp-spin', 'nginx-proxy');
    this.portMapFile = join(this.configDir, 'port-map.json');
    this.ensureCertsDir();
    this.ensureConfigDir();
    this.ensurePortMapFile();
  }

  public async addDomain(domain: string, port?: number, ssl?: boolean): Promise<void> {
    try {
      const portMap = this.getPortMap();
      
      // If no port specified, find an available one
      const existingPort = portMap[domain];
      if (!port) {
        port = existingPort && !(await this.isPortInUse(existingPort)) ? existingPort : await this.findAvailablePort(8080);
      }
      
      // Only check for port conflicts if we're not using a provided port
      if (!port && await this.isPortInUse(port)) {
        // If specified port is in use, find a new one
        port = await this.findAvailablePort(port + 1);
      }

      // Store the port mapping
      portMap[domain] = port;
      this.savePortMap(portMap);

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
      try {
        // Run mkcert to generate cert and key in the host certs dir
        await execa('mkcert', ['-cert-file', hostCertPath, '-key-file', hostKeyPath, domain], { stdio: 'inherit' });
      } catch {
        // mkcert not available - offer to install it automatically
        console.log('\n⚠️  mkcert is required to generate SSL certificates but is not installed.');
        
        const shouldInstall = await this.promptInstallMkcert();
        if (shouldInstall) {
          await this.installMkcert();
          // Retry certificate generation after installation
          await execa('mkcert', ['-cert-file', hostCertPath, '-key-file', hostKeyPath, domain], { stdio: 'inherit' });
        } else {
          throw new Error('SSL certificate generation cancelled. Run the init command without the --ssl flag to continue without SSL.');
        }
      }
    }

    // Return container paths for nginx config
    return { cert: `/etc/nginx/certs/${domain}.pem`, key: `/etc/nginx/certs/${domain}-key.pem` };
  }

  public getPortForDomain(domain: string): number | undefined {
    const portMap = this.getPortMap();
    return portMap[domain];
  }

  public async removeDomain(domain: string): Promise<void> {
    try {
      const configPath = join(this.configDir, 'conf.d', `${domain}.conf`);
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      // Remove port mapping
      const portMap = this.getPortMap();
      delete portMap[domain];
      this.savePortMap(portMap);

      await this.ensureContainerRunning();
      this.removeHostsEntry(domain);
      await this.reloadNginx();
    } catch (error) {
      throw new Error(`Failed to remove domain ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async updateSitePort(domain: string, newPort: number): Promise<void> {
    try {
      const configPath = join(this.configDir, 'conf.d', `${domain}.conf`);
      if (!fs.existsSync(configPath)) {
        throw new Error(`No nginx config found for domain ${domain}`);
      }

      // Read current config
      let config = fs.readFileSync(configPath, 'utf8');
      
      // Update port in proxy_pass directives
      config = config.replaceAll(
        /proxy_pass http:\/\/host\.docker\.internal:\d+;/g,
        `proxy_pass http://host.docker.internal:${newPort};`
      );

      // Write updated config
      fs.writeFileSync(configPath, config);

      // Update port map
      const portMap = this.getPortMap();
      portMap[domain] = newPort;
      this.savePortMap(portMap);

      // Reload nginx
      await this.reloadNginx();
    } catch (error) {
      throw new Error(`Failed to update port for domain ${domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private addHostsEntry(domain: string): void {
    try {
      const hostsEntry = `127.0.0.1 ${domain}`;
      const hostsFile = process.platform === 'win32' ? String.raw`C:\Windows\System32\drivers\etc\hosts` : '/etc/hosts';
      const hostsContent = fs.readFileSync(hostsFile, 'utf8');
      if (hostsContent.includes(hostsEntry)) {
        return;
      }

      try {
        if (process.platform === 'win32') {
          // On Windows, try to append directly (requires admin privileges)
          fs.appendFileSync(hostsFile, `\n${hostsEntry}`);
        } else {
          execSync(`echo "${hostsEntry}" | sudo tee -a ${hostsFile}`, { stdio: 'inherit' });
        }
      } catch {
        const instruction = process.platform === 'win32' 
          ? `Failed to update hosts file. Please run as administrator or manually add this line to ${hostsFile}:\n${hostsEntry}`
          : `Failed to update /etc/hosts. You may need to run the command with sudo or manually add this line to /etc/hosts:\n${hostsEntry}`;
        throw new Error(instruction);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('sudo') || error.message.includes('administrator'))) {
        throw error;
      }

      throw new Error(`Failed to update hosts file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureCertsDir(): void {
    if (!fs.existsSync(this.certsDir)) {
      if (process.platform === 'win32') {
        fs.mkdirSync(this.certsDir, { recursive: true });
      } else {
        execSync(`sudo mkdir -p ${this.certsDir}`, { stdio: 'inherit' });
      }
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
      if (process.platform === 'win32') {
        fs.mkdirSync(this.configDir, { recursive: true });
      } else {
        execSync(`sudo mkdir -p ${this.configDir}`, { stdio: 'inherit' });
      }
    }

    const nginxConfPath = join(this.configDir, 'nginx.conf');
    if (!fs.existsSync(nginxConfPath)) {
      if (process.platform === 'win32') {
        fs.writeFileSync(nginxConfPath, this.defaultConfig);
      } else {
        execSync(`echo '${this.defaultConfig}' | sudo tee ${nginxConfPath}`, { stdio: 'inherit' });
      }
    }

    const confDir = join(this.configDir, 'conf.d');
    if (!fs.existsSync(confDir)) {
      if (process.platform === 'win32') {
        fs.mkdirSync(confDir, { recursive: true });
      } else {
        execSync(`sudo mkdir -p ${confDir}`, { stdio: 'inherit' });
      }
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

  private ensurePortMapFile(): void {
    if (!fs.existsSync(this.portMapFile)) {
      fs.writeFileSync(this.portMapFile, JSON.stringify({}, null, 2));
    }
  }

  private async findAvailablePort(startPort: number = 9000): Promise<number> {
    // Get ports from port map
    const usedPorts = new Set(Object.values(this.getPortMap()));
    
    // Also check all existing nginx configs for ports
    const confDir = join(this.configDir, 'conf.d');
    if (fs.existsSync(confDir)) {
      const configFiles = fs.readdirSync(confDir);
      for (const file of configFiles) {
        if (file.endsWith('.conf')) {
          const content = fs.readFileSync(join(confDir, file), 'utf8');
          const portMatch = content.match(/proxy_pass http:\/\/host\.docker\.internal:(\d+)/);
          if (portMatch) {
            usedPorts.add(Number.parseInt(portMatch[1], 10));
          }
        }
      }
    }

    const portsToCheck = Array.from({ length: 1000 }, (_, i) => startPort + i)
      .filter(port => !usedPorts.has(port));

    // Check ports in parallel
    const portChecks = await Promise.all(
      portsToCheck.map(async port => ({
        inUse: await this.isPortInUse(port),
        port
      }))
    );

    const availablePort = portChecks.find(check => !check.inUse)?.port;
    if (!availablePort) {
      throw new Error('No available ports found in range 9000-9999. Please free up some ports or specify a custom port.');
    }

    return availablePort;
  }

  private getPortMap(): Record<string, number> {
    try {
      return JSON.parse(fs.readFileSync(this.portMapFile, 'utf8'));
    } catch {
      return {};
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
    const hostsFile = process.platform === 'win32' ? String.raw`C:\Windows\System32\drivers\etc\hosts` : '/etc/hosts';
    const hostsEntry = `127.0.0.1 ${domain}`;
    const hostsContent = fs.readFileSync(hostsFile, 'utf8');
    const newContent = hostsContent
      .split('\n')
      .filter(line => !line.includes(hostsEntry))
      .join('\n');
    try {
      if (process.platform === 'win32') {
        fs.writeFileSync(hostsFile, newContent);
      } else {
        execSync(`echo "${newContent}" | sudo tee ${hostsFile}`, { stdio: 'inherit' });
      }
    } catch {
      const instruction = process.platform === 'win32'
        ? `Failed to update hosts file. Please run as administrator or manually remove this line from ${hostsFile}:\n${hostsEntry}`
        : `Failed to update /etc/hosts. You may need to run the command with sudo or manually remove this line from /etc/hosts:\n${hostsEntry}`;
      throw new Error(instruction);
    }
  }

  private savePortMap(portMap: Record<string, number>): void {
    fs.writeFileSync(this.portMapFile, JSON.stringify(portMap, null, 2));
  }

  private updateNginxConfig(domain: string, port: number, ssl?: boolean): void {
    const configPath = join(this.configDir, 'conf.d', `${domain}.conf`);
    const hostCertPath = join(this.certsDir, `${domain}.pem`);
    const hostKeyPath = join(this.certsDir, `${domain}-key.pem`);
    const containerCertPath = `/etc/nginx/certs/${domain}.pem`;
    const containerKeyPath = `/etc/nginx/certs/${domain}-key.pem`;
    let config = '';
    if (ssl && fs.existsSync(hostCertPath) && fs.existsSync(hostKeyPath)) {
      // HTTP to HTTPS redirect
      config += `
server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}
`;
      // HTTPS server
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
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port 443;
    }
}
`;
    } else {
      // HTTP only
      config += `
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
    }

    const existingConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';

    if (existingConfig !== config) {
      if (process.platform === 'win32') {
        fs.writeFileSync(configPath, config);
      } else {
        execSync(`echo '${config}' | sudo tee ${configPath}`, { stdio: 'inherit' });
      }
    }
  }

  private async promptInstallMkcert(): Promise<boolean> {
    const message = 'Would you like wp-spin to install mkcert automatically?';
    return confirm({ default: true, message });
  }

  private async installMkcert(): Promise<void> {
    console.log('Installing mkcert...');
    
    try {
      switch (process.platform) {
        case 'darwin': {
          await this.installMkcertMacOS();
          break;
        }

        case 'linux': {
          await this.installMkcertLinux();
          break;
        }

        case 'win32': {
          await this.installMkcertWindows();
          break;
        }

        default: {
          throw new Error(`Automatic installation not supported for ${process.platform}. Please install manually from https://github.com/FiloSottile/mkcert#installation`);
        }
      }
      
      // Install the local CA
      console.log('Setting up local certificate authority...');
      await execa('mkcert', ['-install'], { stdio: 'inherit' });
      console.log('✓ mkcert installed and configured successfully!');
      
    } catch (error) {
      throw new Error(`Failed to install mkcert: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async installMkcertMacOS(): Promise<void> {
    try {
      // Try Homebrew first
      await execa('brew', ['install', 'mkcert'], { stdio: 'inherit' });
    } catch {
      // If Homebrew fails, try MacPorts
      try {
        await execa('sudo', ['port', 'install', 'mkcert'], { stdio: 'inherit' });
      } catch {
        throw new Error('Failed to install mkcert. Please install Homebrew or MacPorts first, or install mkcert manually.');
      }
    }
  }

  private async installMkcertLinux(): Promise<void> {
    try {
      // Try apt (Ubuntu/Debian) first
      await execa('sudo', ['apt', 'update'], { stdio: 'pipe' });
      await execa('sudo', ['apt', 'install', '-y', 'libnss3-tools'], { stdio: 'inherit' });
      
      // Download and install mkcert binary
      const arch = process.arch === 'x64' ? 'amd64' : process.arch;
      const url = `https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-${arch}`;
      
      await execa('wget', ['-O', '/tmp/mkcert', url], { stdio: 'inherit' });
      await execa('chmod', ['+x', '/tmp/mkcert'], { stdio: 'inherit' });
      await execa('sudo', ['mv', '/tmp/mkcert', '/usr/local/bin/mkcert'], { stdio: 'inherit' });
      
    } catch {
      throw new Error('Failed to install mkcert on Linux. Please install manually or use your distribution\'s package manager.');
    }
  }

  private async installMkcertWindows(): Promise<void> {
    try {
      // Try Chocolatey first
      await execa('choco', ['install', 'mkcert', '-y'], { stdio: 'inherit' });
    } catch {
      // If Chocolatey fails, try Scoop
      try {
        await execa('scoop', ['bucket', 'add', 'extras'], { stdio: 'pipe' });
        await execa('scoop', ['install', 'mkcert'], { stdio: 'inherit' });
      } catch {
        throw new Error('Failed to install mkcert. Please install Chocolatey or Scoop first, or download mkcert manually from https://github.com/FiloSottile/mkcert/releases');
      }
    }
  }
} 