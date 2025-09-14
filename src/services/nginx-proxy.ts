import { execa } from 'execa';
import { createPromptModule } from 'inquirer';
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

      await this.addHostsEntry(domain);
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

  private async addHostsEntry(domain: string): Promise<void> {
    const hostsEntry = `127.0.0.1 ${domain}`;
    const results: { error?: string; location: string; success: boolean; }[] = [];

    // Determine which hosts files to update
    const hostsFiles = this.getHostsFilesToUpdate();
    
    for (const { description, path: hostsFile } of hostsFiles) {
      try {
        if (!fs.existsSync(hostsFile)) {
          results.push({ error: 'Hosts file not found', location: description, success: false });
          continue;
        }

        const hostsContent = fs.readFileSync(hostsFile, 'utf8');
        if (hostsContent.includes(hostsEntry)) {
          results.push({ location: description, success: true });
          continue;
        }

        // Try to add the entry
        if (hostsFile.includes('/mnt/c/Windows/System32/drivers/etc/hosts')) {
          // This is the Windows hosts file accessed from WSL
          this.addWindowsHostsEntryFromWSL(hostsFile, hostsEntry);
        } else if (process.platform === 'win32') {
          this.addWindowsHostsEntry(hostsFile, hostsEntry);
        } else {
          // Linux/macOS hosts file
          execSync(`echo "${hostsEntry}" | sudo tee -a ${hostsFile}`, { stdio: 'inherit' });
        }
        
        results.push({ location: description, success: true });
        console.log(`✓ Added ${domain} to ${description}`);
        
        // Warn user about WSL hosts file limitations
        if (description.includes('temporary')) {
          console.warn(`  ⚠️  Note: This entry will be lost when WSL restarts. Consider using localhost with the assigned port instead.`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({ error: errorMessage, location: description, success: false });
      }
    }

    // Verify the entry was actually added by checking if the domain resolves
    const wasAdded = await this.verifyHostsEntry(domain);
    
    // Report results
    const successCount = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);
    
    if (successCount === 0) {
      // All failed - provide instructions
      console.warn('\n⚠️  Failed to update hosts files automatically. Please add this entry manually:');
      console.warn(`   ${hostsEntry}\n`);
      
      for (const failure of failures) {
        if (failure.location.includes('Windows')) {
          console.warn(`${failure.location}:`);
          console.warn(this.getWindowsHostsInstructions(hostsEntry, failure.location));
        } else {
          console.warn(`${failure.location}: Run "sudo echo '${hostsEntry}' >> ${failure.location.split(' ')[0]}"`);
        }

        console.warn('');
      }
      
      console.warn('💡 Your WordPress site will still work, but you\'ll need to use localhost or the IP address instead of the custom domain.');
    } else if (failures.length > 0) {
      // Partial success
      console.warn(`\n⚠️  Added ${domain} to ${successCount} hosts file(s), but failed to update:`);
      for (const failure of failures) {
        console.warn(`   ${failure.location}: ${failure.error}`);
      }

      console.warn(`\n💡 You may need to manually add "${hostsEntry}" to the failed locations for full compatibility.`);
    } else if (wasAdded) {
      console.log(`✓ Successfully added ${domain} to hosts file(s)`);
    } else {
      // Success reported but DNS verification failed - this is common in WSL2
      console.log(`✓ Hosts file updated successfully`);
      console.log(`   Note: DNS verification failed, but this is common in WSL2 environments.`);
      console.log(`   Your site should work correctly. If not, try flushing DNS cache.`);
    }
  }

  private addWindowsHostsEntry(hostsFile: string, hostsEntry: string): void {
    try {
      // Try direct file append first (will only work if already running as admin)
      fs.appendFileSync(hostsFile, `\n${hostsEntry}`);
    } catch {
      // Try using PowerShell with elevated privileges (UAC prompt)
      try {
        const powershellCommand = 
          `powershell -Command "Start-Process powershell ` +
          `-ArgumentList '-Command', 'Add-Content -Path ''${hostsFile}'' -Value ''${hostsEntry}''' ` +
          `-Verb RunAs -Wait"`;
        execSync(powershellCommand, { stdio: 'pipe' });
      } catch {
        // Fallback: Try PowerShell without explicit elevation (user might have admin terminal)
        try {
          const fallbackCommand = `powershell -Command "Add-Content -Path '${hostsFile}' -Value '${hostsEntry}'"`;
          execSync(fallbackCommand, { stdio: 'pipe' });
        } catch {
          // Try using echo command as final fallback
          try {
            execSync(`echo ${hostsEntry} >> "${hostsFile}"`, { stdio: 'pipe' });
          } catch {
            // Provide helpful instructions instead of throwing error
            console.warn(`⚠️  Could not automatically update Windows hosts file.`);
            console.warn(`   To access your site at the custom domain, please add this entry manually:`);
            console.warn(`   
   1. Open PowerShell as Administrator (right-click → "Run as administrator")
   2. Run: Add-Content -Path "${hostsFile}" -Value "${hostsEntry}"
   
   OR manually edit ${hostsFile} and add:
   ${hostsEntry}`);
            // Don't throw error, just warn and continue
          }
        }
      }
    }
  }

  private addWindowsHostsEntryFromWSL(_hostsFile: string, hostsEntry: string): void {
    try {
      
      const windowsPath = String.raw`C:\Windows\System32\drivers\etc\hosts`;
      const powershellCommand =
        `powershell.exe -Command "Start-Process powershell ` +
        `-ArgumentList '-Command', 'Add-Content -Path ''${windowsPath}'' -Value ''${hostsEntry}''' ` +
        `-Verb RunAs -Wait"`;
      execSync(powershellCommand, { stdio: 'pipe' });

    } catch {
      try {
        // Fallback: Try PowerShell without explicit elevation (user might have admin terminal)
        const windowsPath = String.raw`C:\Windows\System32\drivers\etc\hosts`;
        const fallbackCommand = `powershell.exe -Command "Add-Content -Path '${windowsPath}' -Value '${hostsEntry}'"`;
        execSync(fallbackCommand, { stdio: 'pipe' });
      } catch {
        try {
          // Try using cmd.exe as another fallback
          const windowsPath = String.raw`C:\Windows\System32\drivers\etc\hosts`;
          execSync(`cmd.exe /c "echo ${hostsEntry} >> ${windowsPath}"`, { stdio: 'pipe' });
        } catch {
          // Instead of throwing an error, provide helpful instructions
          console.warn(`⚠️  Could not automatically update Windows hosts file from WSL.`);
          console.warn(`   To access your site at the custom domain, please add this entry manually:`);
          console.warn(`   
   1. Open PowerShell as Administrator (right-click → "Run as administrator")
   2. Run: Add-Content -Path "C:\\Windows\\System32\\drivers\\etc\\hosts" -Value "${hostsEntry}"
   
   OR manually edit C:\\Windows\\System32\\drivers\\etc\\hosts and add:
   ${hostsEntry}`);
           // Don't throw error, just warn and continue
        }
      }
    }
  }

  private checkHostsFilesForDomain(domain: string): boolean {
    const hostsFiles = this.getHostsFilesToUpdate();
    const hostsEntry = `127.0.0.1 ${domain}`;
    
    for (const { path: hostsFile } of hostsFiles) {
      try {
        if (fs.existsSync(hostsFile)) {
          const content = fs.readFileSync(hostsFile, 'utf8');
          if (content.includes(hostsEntry)) {
            return true;
          }
        }
      } catch {
        // Ignore permission errors when checking
        continue;
      }
    }

    return false;
  }

  private createCertsDirUnix(): void {
    try {
      fs.mkdirSync(this.certsDir, { recursive: true });
    } catch {
      this.createCertsDirWithSudo();
    }
  }

  private createCertsDirWithSudo(): void {
    execSync(`sudo mkdir -p ${this.certsDir}`, { stdio: 'inherit' });

    const username = process.env.USER || process.env.USERNAME || 'root';
    const group = this.getSystemGroup(username);

    execSync(`sudo chown -R ${username}:${group} ${this.certsDir}`, { stdio: 'inherit' });
  }

  private ensureCertsDir(): void {
    if (fs.existsSync(this.certsDir)) return;

    if (process.platform === 'win32') {
      fs.mkdirSync(this.certsDir, { recursive: true });
      return;
    }

    this.createCertsDirUnix();
  }

  private ensureConfigDir(): void {
    let needsPermissionFix = false;
    
    if (!fs.existsSync(this.configDir)) {
      if (process.platform === 'win32') {
        fs.mkdirSync(this.configDir, { recursive: true });
      } else {
        try {
          // Try creating without sudo first
          fs.mkdirSync(this.configDir, { recursive: true });
        } catch {
          // Only use sudo if regular mkdir fails
          execSync(`sudo mkdir -p ${this.configDir}`, { stdio: 'inherit' });
          needsPermissionFix = true;
        }
      }
    }

    const nginxConfPath = join(this.configDir, 'nginx.conf');
    if (!fs.existsSync(nginxConfPath)) {
      if (process.platform === 'win32') {
        fs.writeFileSync(nginxConfPath, this.defaultConfig);
      } else {
        try {
          fs.writeFileSync(nginxConfPath, this.defaultConfig);
        } catch {
          execSync(`echo '${this.defaultConfig}' | sudo tee ${nginxConfPath}`, { stdio: 'inherit' });
          needsPermissionFix = true;
        }
      }
    }

    const confDir = join(this.configDir, 'conf.d');
    if (!fs.existsSync(confDir)) {
      if (process.platform === 'win32') {
        fs.mkdirSync(confDir, { recursive: true });
      } else {
        try {
          fs.mkdirSync(confDir, { recursive: true });
        } catch {
          execSync(`sudo mkdir -p ${confDir}`, { stdio: 'inherit' });
          needsPermissionFix = true;
        }
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

    // Only run chown on Unix-like systems and only if we needed sudo
    if (process.platform !== 'win32' && needsPermissionFix) {
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

  private getHostsFilesToUpdate(): { description: string; isWSL: boolean; path: string; }[] {
    const files: { description: string; isWSL: boolean; path: string; }[] = [];
    
    if (this.isRunningInWSL()) {
      // In WSL, only update the Windows hosts file since WSL's /etc/hosts is auto-generated and ephemeral
      const windowsHostsPath = '/mnt/c/Windows/System32/drivers/etc/hosts';
      if (fs.existsSync(windowsHostsPath)) {
        files.push({
          description: 'Windows hosts file (via WSL)',
          isWSL: true,
          path: windowsHostsPath
        });
      } else {
        // Fallback to WSL hosts if Windows hosts not accessible, but warn user
        files.push({
          description: 'WSL hosts file (temporary - will reset on WSL restart)',
          isWSL: false,
          path: '/etc/hosts'
        });
      }
    } else if (process.platform === 'win32') {
      // Native Windows
      files.push({
        description: 'Windows hosts file',
        isWSL: false,
        path: String.raw`C:\Windows\System32\drivers\etc\hosts`
      });
    } else {
      // Native Linux/macOS
      files.push({
        description: 'System hosts file',
        isWSL: false,
        path: '/etc/hosts'
      });
    }
    
    return files;
  }

  private getPortMap(): Record<string, number> {
    try {
      return JSON.parse(fs.readFileSync(this.portMapFile, 'utf8'));
    } catch {
      return {};
    }
  }

  private getSystemGroup(username: string): string {
    switch (process.platform) {
      case 'darwin': { return 'staff';
      }

      case 'linux': {
        try {
          return execSync(`id -gn ${username}`, { encoding: 'utf8' }).trim();
        } catch {
          return username;
        }
      }

      default: { return username;
      }
    }
  }

  private getWindowsHostsInstructions(hostsEntry: string, hostsFile: string): string {
    const isWSL = this.isRunningInWSL();
    const hostsPath = isWSL 
      ? String.raw`C:\Windows\System32\drivers\etc\hosts`
      : hostsFile;
    const domain = hostsEntry.split(' ')[1];

    return `
🔧 Manual Setup Required:

${isWSL ? '📋 WSL/Windows Setup:' : '📋 Windows Setup:'}

Option 1 - PowerShell (Recommended):
  1️⃣  Press Win+X, select "Windows PowerShell (Admin)" or "Terminal (Admin)"
  2️⃣  Run: Add-Content -Path "${hostsPath}" -Value "${hostsEntry}"
  3️⃣  Press Enter when prompted by UAC

Option 2 - Notepad:
  1️⃣  Press Win+R, type: notepad
  2️⃣  Right-click Notepad in taskbar → "Run as administrator"  
  3️⃣  File → Open → Navigate to: ${hostsPath}
  4️⃣  Add this line at the end: ${hostsEntry}
  5️⃣  Save the file (Ctrl+S)

Option 3 - Command Prompt:
  1️⃣  Press Win+X, select "Command Prompt (Admin)"
  2️⃣  Run: echo ${hostsEntry} >> "${hostsPath}"

${isWSL ? '💡 Note: You\'re using WSL, so changes must be made to the Windows hosts file.' : ''}
🔍 To verify: ping ${domain} should show 127.0.0.1`;
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
        // If both package managers fail, download and install manually
        try {
          await this.installMkcertWindowsManual();
        } catch {
          throw new Error('Failed to install mkcert. Please install Chocolatey or Scoop first, or download mkcert manually from https://github.com/FiloSottile/mkcert/releases');
        }
      }
    }
  }

  private async installMkcertWindowsManual(): Promise<void> {
    console.log('Package managers not found, downloading mkcert directly...');
    
    // Determine architecture
    const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'ia32' ? '386' : 'amd64';
    const url = `https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-windows-${arch}.exe`;
    
    // Create a local bin directory if it doesn't exist
    const localBinDir = join(os.homedir(), 'AppData', 'Local', 'wp-spin', 'bin');
    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }
    
    const mkcertPath = join(localBinDir, 'mkcert.exe');
    
    // Download mkcert using PowerShell
    console.log('Downloading mkcert...');
    const downloadCommand = `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${mkcertPath}'"`;
    execSync(downloadCommand, { stdio: 'inherit' });
    
    // Add to PATH for current session by creating a batch script wrapper
    const batchWrapperPath = join(localBinDir, 'mkcert.bat');
    const batchContent = `@echo off\n"${mkcertPath}" %*`;
    fs.writeFileSync(batchWrapperPath, batchContent);
    
    // Add to PATH environment variable for current process
    process.env.PATH = `${localBinDir};${process.env.PATH}`;
    
    console.log(`✓ mkcert downloaded to ${mkcertPath}`);
    console.log(`✓ Added to PATH for current session`);
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

  private isRunningInWSL(): boolean {
    try {
      // Check for WSL indicators
      if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
        return true;
      }
      
      // Check /proc/version for Microsoft
      if (fs.existsSync('/proc/version')) {
        const version = fs.readFileSync('/proc/version', 'utf8');
        return version.toLowerCase().includes('microsoft') || version.toLowerCase().includes('wsl');
      }
      
      return false;
    } catch {
      return false;
    }
  }

  private async promptInstallMkcert(): Promise<boolean> {
    const prompt = createPromptModule();
    const { shouldInstall } = await prompt({
      default: true,
      message: 'Would you like wp-spin to install mkcert automatically?',
      name: 'shouldInstall',
      type: 'confirm',
    });
    return shouldInstall;
  }

  private async reloadNginx(): Promise<void> {
    try {
      execSync(`docker exec ${this.containerName} nginx -s reload`, { stdio: 'inherit' });
    } catch (error) {
      throw new Error(`Failed to reload NGINX: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private removeHostsEntry(domain: string): void {
    const hostsEntry = `127.0.0.1 ${domain}`;
    const hostsFiles = this.getHostsFilesToUpdate();
    const results: { error?: string; location: string; success: boolean; }[] = [];

    for (const { description, isWSL, path: hostsFile } of hostsFiles) {
      try {
        if (!fs.existsSync(hostsFile)) {
          results.push({ location: description, success: true }); // Not an error if file doesn't exist
          continue;
        }

        const hostsContent = fs.readFileSync(hostsFile, 'utf8');
        if (!hostsContent.includes(hostsEntry)) {
          results.push({ location: description, success: true }); // Entry doesn't exist, nothing to remove
          continue;
        }

        const newContent = hostsContent
          .split('\n')
          .filter(line => !line.includes(hostsEntry))
          .join('\n');

        if (isWSL || process.platform !== 'win32') {
          execSync(`echo "${newContent}" | sudo tee ${hostsFile}`, { stdio: 'inherit' });
        } else {
          fs.writeFileSync(hostsFile, newContent);
        }
        
        results.push({ location: description, success: true });
        console.log(`✓ Removed ${domain} from ${description}`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({ error: errorMessage, location: description, success: false });
      }
    }

    // Report failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.warn(`\n⚠️  Failed to remove ${domain} from some hosts files:`);
      for (const failure of failures) {
        console.warn(`   ${failure.location}: ${failure.error}`);
      }

      console.warn(`\n💡 You may need to manually remove "${hostsEntry}" from the failed locations.`);
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
        execSync(`echo '${config}' | sudo tee ${configPath} > /dev/null`);
      }
    }
  }

  private async verifyHostsEntry(domain: string): Promise<boolean> {
    try {
      const dns = await import('node:dns');
      const { promisify } = await import('node:util');
      const lookup = promisify(dns.lookup);
      
      const result = await lookup(domain);
      return result.address === '127.0.0.1';
    } catch {
      // If DNS lookup fails, check hosts files directly
      return this.checkHostsFilesForDomain(domain);
    }
  }
} 