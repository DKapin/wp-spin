import { Command } from '@oclif/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { execa, execaSync } from 'execa';
import { createPromptModule } from 'inquirer';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import ora from 'ora';

import { DEFAULT_PORTS } from '../config/ports.js';
import { IDockerService } from './docker-interface.js';

export class DockerService implements IDockerService {
  private architecture = arch();
  private command?: Command;
  private dockerComposeCommand: string[] = ['docker-compose'];
  private platform = platform();
  private portMappings: Record<number, number> = {};
  private projectPath: string;
  private spinner = ora();

  constructor(projectPath: string, command?: Command) {
    this.projectPath = projectPath;
    if (command) {
      this.command = command;
    }
  }

  private async detectDockerComposeCommand(): Promise<void> {
    // Try docker compose (new plugin) first
    try {
      await execa('docker', ['compose', '--version'], { stdio: 'ignore' });
      this.dockerComposeCommand = ['docker', 'compose'];
      return;
    } catch {
      // Fall back to docker-compose (legacy)
      try {
        await execa('docker-compose', ['--version'], { stdio: 'ignore' });
        this.dockerComposeCommand = ['docker-compose'];
        return;
      } catch {
        // Neither available
        throw new Error('Neither docker compose nor docker-compose is available');
      }
    }
  }

  async checkDiskSpace(): Promise<void> {
    this.spinner.start('Checking disk space...');
    try {
      if (this.platform === 'win32') {
        // Windows disk space check
        await this.checkWindowsDiskSpace();
      } else {
        // Unix-like systems (macOS, Linux)
        const { stdout } = await execa('df', ['-h', this.projectPath]);
        const availableSpace = Number.parseInt(stdout.split('\n')[1].split(/\s+/)[3], 10);
        if (availableSpace < 1) {
          this.spinner.fail('Insufficient disk space');
          this.prettyError(
            'Insufficient Disk Space',
            'Less than 1GB of disk space available.',
            'Please free up some disk space and try again.'
          );
        }
      }

      this.spinner.succeed('Sufficient disk space available');
    } catch {
      this.spinner.fail('Failed to check disk space');
      // Continue anyway as this is not critical
    }
  }

  async checkDockerComposeInstalled(): Promise<void> {
    this.spinner.start('Checking Docker Compose installation...');
    try {
      await this.detectDockerComposeCommand();
      const commandName = this.dockerComposeCommand.join(' ');
      this.spinner.succeed(`Docker Compose is installed (using ${commandName})`);
    } catch {
      this.spinner.fail('Docker Compose is not installed');
      this.prettyError(
        'Docker Compose Not Found',
        'Docker Compose is not installed on your system.',
        'Please install Docker Compose from https://docs.docker.com/compose/install/ or enable Docker Compose plugin in Docker Desktop.'
      );
    }
  }

  async checkDockerInstalled(): Promise<void> {
    this.spinner.start('Checking Docker installation...');
    try {
      await execa('docker', ['--version'], { stdio: 'ignore' });
      this.spinner.succeed('Docker is installed');
    } catch {
      this.spinner.fail('Docker is not installed');
      this.prettyError(
        'Docker Not Found',
        'Docker is not installed on your system.',
        'Please install Docker from https://www.docker.com/get-started'
      );
    }
  }

  async checkDockerRunning(): Promise<void> {
    this.spinner.start('Checking Docker...');
    try {
      await execa('docker', ['info'], { stdio: 'ignore' });
      this.spinner.succeed('Docker is running');
    } catch {
      this.spinner.fail('Docker is not running');
      this.prettyError(
        'Docker Not Running',
        'Docker daemon is not running on your system.',
        'Please start Docker Desktop and try again.'
      );
    }
  }

  async checkMemory(): Promise<void> {
    this.spinner.start('Checking system memory...');
    try {
      if (this.platform === 'win32') {
        // Windows memory check
        const { stdout } = await execa('wmic', ['computersystem', 'get', 'TotalPhysicalMemory'], { stdio: 'pipe' });
        const totalMemory = Number.parseInt(stdout.split('\n')[1].trim(), 10) / (1024 * 1024 * 1024);
        if (totalMemory < 2) {
          this.spinner.fail('Insufficient memory');
          this.prettyError(
            'Insufficient Memory',
            'Less than 2GB of RAM available.',
            'Please upgrade your system memory and try again.'
          );
        }
      } else {
        // Unix-like systems (macOS, Linux)
        const { stdout } = await execa('free', ['-g'], { stdio: 'pipe' });
        const totalMemory = Number.parseInt(stdout.split('\n')[1].split(/\s+/)[1], 10);
        if (totalMemory < 2) {
          this.spinner.fail('Insufficient memory');
          this.prettyError(
            'Insufficient Memory',
            'Less than 2GB of RAM available.',
            'Please upgrade your system memory and try again.'
          );
        }
      }

      this.spinner.succeed('Sufficient memory available');
    } catch {
      this.spinner.fail('Failed to check memory');
      // Continue anyway as this is not critical
    }
  }

  async checkPorts(): Promise<void> {
    this.spinner.start('Checking ports...');
    const ports = Object.values(DEFAULT_PORTS);
    let portsChanged = false;
    
    // Track conflicts for all ports up front
    const portConflicts = new Map<number, boolean>();
    const portReplacements = new Map<number, number>();
    const usedPorts = new Set<number>();
    
    // Check all ports first and store results
    await this.checkAllPortsAvailability(ports, portConflicts, portReplacements, usedPorts);
    
    // Handle interactive and non-interactive environments
    if (!(process.env.NODE_ENV?.includes('test') || !process.stdin.isTTY)) {
      // Handle conflicts with user prompts for each port
      portsChanged = await this.handlePortConflictsInteractively(
        portConflicts, 
        portReplacements, 
        usedPorts
      );
    }

    this.displayPortResults(portsChanged);
  }

  async checkProjectExists(): Promise<boolean> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    try {
      await fs.readFile(dockerComposePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a command in a Docker container
   */
  async exec(containerName: string, command: string[]): Promise<string> {
    try {
      const { stdout } = await execa('docker', ['exec', containerName, ...command], {
        cwd: this.projectPath,
      });
      return stdout;
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Docker Exec Error',
          error.message,
          'Please check your Docker container and try again.'
        );
      }

      throw error;
    }
  }

  /**
   * Gets logs as a string instead of streaming to console
   * @returns The logs from all containers or empty string on error
   */
  async getLogs(): Promise<string> {
    try {
      // Ensure we have detected the Docker Compose command
      if (this.dockerComposeCommand[0] === 'docker-compose') {
        await this.detectDockerComposeCommand();
      }
      
      // Get logs without following (-f) to get just the current logs
      const { stdout } = await execa(this.dockerComposeCommand[0], [...this.dockerComposeCommand.slice(1), 'logs'], {
        cwd: this.projectPath,
        stdio: 'pipe',
      });
      
      return stdout;
    } catch (error) {
      console.error('Error getting logs:', error instanceof Error ? error.message : String(error));
      return '';
    }
  }

  async getPort(service: string): Promise<number> {
    try {
      // Ensure we have detected the Docker Compose command
      if (this.dockerComposeCommand[0] === 'docker-compose') {
        await this.detectDockerComposeCommand();
      }
      
      const command = `${this.dockerComposeCommand.join(' ')} port ${service} 80`;
      const result = execSync(command, { cwd: this.projectPath }).toString();
      const port = Number.parseInt(result.split(':')[1], 10);
      return port;
    } catch (error) {
      throw new Error(`Failed to get port for ${service}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public getPortMappings(): Record<number, number> {
    return { ...this.portMappings };
  }

  /**
   * Returns the current project path
   * @returns The absolute path to the project root directory
   */
  public getProjectPath(): string {
    return this.projectPath;
  }

  async logs(): Promise<void> {
    try {
      await this.runDockerCompose(['logs', '-f']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Logs Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Logs Error',
        'Failed to view logs',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async restart(): Promise<void> {
    this.spinner.start('Restarting WordPress environment...');
    try {
      await this.runDockerCompose(['restart']);
      this.spinner.succeed('WordPress environment restarted');
    } catch (error) {
      this.spinner.fail('Failed to restart WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Restart Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Restart Error',
        'Failed to restart WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  /**
   * Restart containers with updated environment variables from .env file
   * This is necessary when environment variables change (like XDEBUG_MODE)
   */
  async restartWithEnvReload(): Promise<void> {
    this.spinner.start('Restarting WordPress environment with updated settings...');
    try {
      // Stop containers first
      await this.runDockerCompose(['down']);
      
      // Start containers with updated environment variables
      await this.runDockerCompose(['up', '-d']);
      
      // Wait for MySQL to be ready
      await this.waitForMySQL();
      
      this.spinner.succeed('WordPress environment restarted with updated settings');
    } catch (error) {
      this.spinner.fail('Failed to restart WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Restart Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Restart Error',
        'Failed to restart WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async shell(): Promise<void> {
    try {
      // Use the service name (wordpress) instead of container name to avoid conflicts
      await this.runDockerCompose(['exec', 'wordpress', 'bash']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Shell Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Shell Error',
        'Failed to open shell',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async start(): Promise<void> {
    this.spinner.start('Starting WordPress environment...');
    try {
      // Ensure WordPress directory exists with correct permissions
      await this.ensureWordPressDirectory();
      
      // Start the containers
      await this.runDockerCompose(['up', '-d']);
      
      // Wait for MySQL to be ready
      await this.waitForMySQL();
      
      this.spinner.succeed('WordPress environment started');
    } catch (error) {
      this.spinner.fail('Failed to start WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Start Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Start Error',
        'Failed to start WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async status(): Promise<void> {
    try {
      await this.runDockerCompose(['ps']);
    } catch (error) {
      if (error instanceof Error) {
        this.prettyError(
          'Status Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Status Error',
        'Failed to check status',
        'Please check your Docker installation and try again.'
      );
    }
  }

  async stop(): Promise<void> {
    this.spinner.start('Stopping WordPress environment...');
    try {
      await this.runDockerCompose(['down']);
      this.spinner.succeed('WordPress environment stopped');
    } catch (error) {
      this.spinner.fail('Failed to stop WordPress environment');
      if (error instanceof Error) {
        this.prettyError(
          'Stop Error',
          error.message,
          'Please check your Docker configuration and try again.'
        );
      }

      this.prettyError(
        'Stop Error',
        'Failed to stop WordPress environment',
        'Please check your Docker installation and try again.'
      );
    }
  }

  public async updateDockerComposePorts(originalPort: number, newPort: number): Promise<void> {
    try {
      const dockerComposeFile = join(this.projectPath, 'docker-compose.yml');
      
      // First record port mapping regardless of file existence
      this.portMappings[originalPort] = newPort;
      
      // If the file exists, update it
      try {
        const content = await fs.readFile(dockerComposeFile, 'utf8');
        const updatedContent = content.replaceAll(`${originalPort}:`, `${newPort}:`);
        await fs.writeFile(dockerComposeFile, updatedContent);
      } catch {
        // Just log that we're storing the mapping for later use
        console.log(chalk.blue(`Port mapping stored: ${originalPort} -> ${newPort}`));
      }
    } catch (error) {
      console.error(`Failed to update Docker Compose ports: ${error}`);
      throw error;
    }
  }

  /**
   * Check all ports for availability and find alternatives for unavailable ones
   */
  private async checkAllPortsAvailability(
    ports: number[],
    portConflicts: Map<number, boolean>,
    portReplacements: Map<number, number>,
    usedPorts: Set<number>
  ): Promise<boolean> {
    let portsChanged = false;
    
    for (const port of ports) {
      try {
        // Await in loop is necessary here - port checks must be sequential
        // eslint-disable-next-line no-await-in-loop
        const available = await this.isPortAvailable(port);
        portConflicts.set(port, !available);
        
        if (available) {
          // If the port is available, mark it as used
          usedPorts.add(port);
        } else {
          // Port is not available, find an alternative
          // eslint-disable-next-line no-await-in-loop
          portsChanged = await this.findAndSetAlternativePort(
            port, usedPorts, portReplacements
          );
        }
      } catch (error) {
        this.spinner.warn(`Error checking port ${port}: ${error instanceof Error ? error.message : String(error)}`);
        // Assume port is unavailable if we can't check it properly
        // eslint-disable-next-line no-await-in-loop
        portsChanged = await this.handlePortCheckError(port, usedPorts, portReplacements);
      }
    }
    
    return portsChanged;
  }

  /**
   * Checks available disk space on Windows systems
   * @private
   */
  private async checkWindowsDiskSpace(): Promise<void> {
    const { stdout } = await execa('wmic', ['logicaldisk', 'get', 'size,freespace,caption'], { stdio: 'pipe' });
    const lines = stdout.split('\n');
    this.checkWindowsDiskSpaceFromOutput(lines);
  }

  /**
   * Processes Windows disk space output and checks if there's enough free space
   * @param lines Output lines from wmic command
   * @private
   */
  private checkWindowsDiskSpaceFromOutput(lines: string[]): void {
    for (const line of lines) {
      if (!line.includes('C:')) continue;
      
      const parts = line.trim().split(/\s+/);
      const freeSpace = parts[1];
      const freeSpaceGB = Number.parseInt(freeSpace, 10) / (1024 * 1024 * 1024);
      
      if (freeSpaceGB < 1) {
        this.spinner.fail('Insufficient disk space');
        this.prettyError(
          'Insufficient Disk Space',
          'Less than 1GB of disk space available.',
          'Please free up some disk space and try again.'
        );
      }
    }
  }

  /**
   * Display the results of port checking
   */
  private displayPortResults(portsChanged: boolean): void {
    if (portsChanged) {
      this.spinner.succeed('Ports reconfigured');
      console.log(chalk.blue('\nUpdated port mappings:'));
      
      // Log all port mappings with for...of loop
      for (const [original, newPort] of Object.entries(this.portMappings)) {
        console.log(chalk.blue(`  ${original} -> ${newPort}`));
      }
    } else {
      this.spinner.succeed('Ports are available');
    }
  }

  private async ensureWordPressDirectory(): Promise<void> {
    const wordpressPath = join(this.projectPath, 'wordpress');
    
    try {
      // Create directory if it doesn't exist
      await fs.mkdir(wordpressPath, { recursive: true });
      
      // Set directory permissions to 755 (rwxr-xr-x) on Unix-like systems only
      if (process.platform !== 'win32') {
        await fs.chmod(wordpressPath, 0o755);
      }
      
      // Create a test file to verify write permissions
      const testFile = join(wordpressPath, '.test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      
      this.spinner.succeed('WordPress directory verified');
    } catch (error) {
      this.spinner.fail('Failed to create WordPress directory');
      if (error instanceof Error) {
        this.prettyError(
          'Directory Error',
          `Failed to create WordPress directory: ${error.message}`,
          'Please check your file permissions and try again.'
        );
      }

      throw error;
    }
  }

  /**
   * Find and set an alternative port when the original is unavailable
   */
  private async findAndSetAlternativePort(
    port: number, 
    usedPorts: Set<number>,
    portReplacements: Map<number, number>
  ): Promise<boolean> {
     
    let nextPort = await this.findNextAvailablePort(port, usedPorts);
    
    // Keep searching until we find a port that's not already assigned
    while (usedPorts.has(nextPort)) {
      // eslint-disable-next-line no-await-in-loop
      nextPort = await this.findNextAvailablePort(nextPort, usedPorts);
    }
    
    portReplacements.set(port, nextPort);
    usedPorts.add(nextPort);
    
    // Update docker-compose immediately to ensure consistent state
     
    await this.updateDockerComposePorts(port, nextPort);
    console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
    
    return true;
  }

  private async findNextAvailablePort(port: number, usedPorts = new Set<number>()): Promise<number> {
    let nextPort = port + 1;
    
    // Check ports sequentially to avoid multiple awaits in loop
    while (nextPort < 65_535) {
      // Skip if we've already decided to use this port for another service
      if (usedPorts.has(nextPort)) {
        nextPort += 1;
        continue;
      }
      
      // eslint-disable-next-line no-await-in-loop
      const isAvailable = await this.isPortAvailable(nextPort);
      
      if (isAvailable) {
        return nextPort;
      }
      
      nextPort += 1;
    }
    
    throw new Error('No available ports found');
  }

  private getDockerPath(): string {
    return './wordpress';
  }

  private getPlatformSpecificImages(): { mysql: string; phpmyadmin: string; wordpress: string } {
    const isArm = this.architecture === 'arm64';
    return {
      // For ARM64 architecture, use mariadb instead of mysql which has better ARM compatibility
      mysql: isArm ? 'mariadb:10.6' : 'mysql:8.0',
      phpmyadmin: 'phpmyadmin:latest',
      wordpress: isArm ? 'arm64v8/wordpress:latest' : 'wordpress:latest'
    };
  }

  /**
   * Get platform-specific process information
   */
  private getPlatformSpecificProcessInfo(port: number): string {
    if (this.platform === 'darwin' || this.platform === 'linux') {
      return this.getUnixProcessInfo(port);
    } 
    
    if (this.platform === 'win32') {
      return this.getWindowsProcessInfo(port);
    }
    
    return 'unknown process';
  }

  /**
   * Get information about what process is using a port
   */
  private async getProcessInfoForPort(port: number): Promise<string> {
    try {
      // Try to get Docker container info first
       
      const { stdout: dockerOutput } = await execa('docker', [
        'ps', 
        '--format', 
        '{{.Names}} ({{.Image}})', 
        '--filter', 
        `publish=${port}`
      ], { reject: false, stdio: 'pipe' });
      
      if (dockerOutput && dockerOutput.trim()) {
        return `Docker container: ${dockerOutput.trim()}`;
      } 
      
      return this.getPlatformSpecificProcessInfo(port);
    } catch {
      // If we can't get process info, just continue with generic message
      return 'unknown process';
    }
  }

  /**
   * Get process information on Unix systems
   */
  private getUnixProcessInfo(port: number): string {
    try {
      // Use execaSync for synchronous execution
      const result = execaSync('lsof', ['-i', `:${port}`], { 
        reject: false, 
        stdio: 'pipe' 
      });
      
      if (result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          return `Process: ${parts[0]} (PID: ${parts[1]})`;
        }
      }
    } catch {
      // If command fails, return generic info
    }
    
    return 'unknown process';
  }

  /**
   * Get process information on Windows systems
   */
  private getWindowsProcessInfo(port: number): string {
    try {
      // Use execaSync for synchronous execution
      const result = execaSync(
        'netstat', 
        ['-ano', '|', 'findstr', `:${port}`], 
        { reject: false, shell: true, stdio: 'pipe' }
      );
      
      if (result.stdout) {
        const lines = result.stdout.split('\n').filter(Boolean);
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          const pid = parts.at(-1);
          return `Process with PID: ${pid}`;
        }
      }
    } catch {
      // If command fails, return generic info
    }
    
    return 'unknown process';
  }

  /**
   * Handle errors during port checking by finding an alternative port
   */
  private async handlePortCheckError(
    port: number,
    usedPorts: Set<number>,
    portReplacements: Map<number, number>
  ): Promise<boolean> {
     
    const nextPort = await this.findNextAvailablePort(port + 1, usedPorts);
    portReplacements.set(port, nextPort);
    usedPorts.add(nextPort);
    
     
    await this.updateDockerComposePorts(port, nextPort);
    console.log(chalk.yellow(`Port ${port} couldn't be checked properly, using port ${nextPort} instead`));
    
    return true;
  }

  /**
   * Handle port conflicts in an interactive environment
   */
  private async handlePortConflictsInteractively(
    portConflicts: Map<number, boolean>,
    portReplacements: Map<number, number>,
    usedPorts: Set<number>
  ): Promise<boolean> {
    let portsChanged = false;
    
    for (const [port, isConflict] of portConflicts.entries()) {
      if (isConflict && !portReplacements.has(port)) {
        // eslint-disable-next-line no-await-in-loop
        const nextPort = await this.findNextAvailablePort(port, usedPorts);
        usedPorts.add(nextPort);
        
        // Get information about what's using the port
        // eslint-disable-next-line no-await-in-loop
        const processInfo = await this.getProcessInfoForPort(port);
        
        // Handle the conflict with user input
        // eslint-disable-next-line no-await-in-loop
        const result = await this.resolvePortConflict(port, nextPort, processInfo, usedPorts);
        
        if (result.changed) {
          portsChanged = true;
        }
        
        if (result.shouldCancel) {
          this.spinner.fail('Operation cancelled by user');
          throw new Error('Operation cancelled by user');
        }
      }
    }
    
    return portsChanged;
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private prettyError(title: string, message: string, suggestion?: string): never {
    const errorBox = boxen(
      `${chalk.red.bold(title)}\n\n${message}${suggestion ? `\n\n${chalk.yellow('💡 Suggestion:')} ${suggestion}` : ''}`,
      {
        borderColor: 'red',
        borderStyle: 'round',
        margin: 1,
        padding: 1,
        title: 'Error',
        titleAlignment: 'center',
      }
    );

    console.error(errorBox);
    throw new Error(`${title}: ${message}`);
  }

  /**
   * Prompt the user for action on port conflict
   */
  private async promptUserForPortAction(
    port: number, 
    nextPort: number, 
    processInfo: string
  ): Promise<'cancel' | 'next' | 'stop'> {
    const choices = [
      { name: `Use next available port (${nextPort})`, value: 'next' },
      { name: 'Cancel operation', value: 'cancel' }
    ];
    
    // Only add stop option if we found a Docker container
    if (processInfo && processInfo.includes('Docker container')) {
      choices.splice(1, 0, { 
        name: `Stop the process using port ${port} (${processInfo})`, 
        value: 'stop' 
      });
    }
    
    const prompt = createPromptModule();
     
    const responses = await prompt([
      {
        choices,
        message: `Port ${port} is already in use${processInfo ? ` by ${processInfo}` : ''}. What would you like to do?`,
        name: 'action',
        type: 'list',
      },
    ]);
    
    return responses.action;
  }

  /**
   * Resolve a port conflict by getting user input
   */
  private async resolvePortConflict(
    port: number, 
    nextPort: number, 
    processInfo: string,
    usedPorts: Set<number>
  ): Promise<{ changed: boolean; shouldCancel: boolean }> {
    let action: 'cancel' | 'next' | 'stop' = 'next';
    
    try {
       
      action = await this.promptUserForPortAction(port, nextPort, processInfo);
    } catch {
      // If inquirer fails for any reason, use default action
      console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
      action = 'next';
    }

    switch (action) {
    case 'cancel': {
      return { changed: false, shouldCancel: true };
    }
    
    case 'next': {
       
      await this.updateDockerComposePorts(port, nextPort);
      console.log(chalk.yellow(`Port ${port} is in use, using port ${nextPort} instead`));
      return { changed: true, shouldCancel: false };
    }

    case 'stop': {
      return this.stopContainerUsingPort(port, nextPort, usedPorts);
    }

    default: {
      this.spinner.fail('Invalid action selected');
      throw new Error('Invalid action selected');
    }
    }
  }

  private async runDockerCompose(args: string[]): Promise<void> {
    try {
      // Ensure we have detected the Docker Compose command
      if (this.dockerComposeCommand[0] === 'docker-compose') {
        await this.detectDockerComposeCommand();
      }
      
      await execa(this.dockerComposeCommand[0], [...this.dockerComposeCommand.slice(1), ...args], {
        cwd: this.projectPath,
        stdio: 'inherit',
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('command not found')) {
          this.prettyError(
            'Docker Compose Not Found',
            'Docker Compose is not installed on your system.',
            'Please install Docker Compose from https://docs.docker.com/compose/install/ or enable Docker Compose plugin in Docker Desktop.'
          );
        }

        this.prettyError(
          'Docker Compose Error',
          error.message,
          'Please check your Docker Compose configuration and try again.'
        );
      }

      this.prettyError(
        'Docker Compose Error',
        'An unknown error occurred while running Docker Compose.',
        'Please check your Docker installation and try again.'
      );
    }
  }

  /**
   * Stop a Docker container and check if port becomes available
   */
  private async stopContainerAndCheckPort(
    containerId: string, 
    port: number, 
    nextPort: number,
    usedPorts: Set<number>
  ): Promise<{ changed: boolean; shouldCancel: boolean }> {
    this.spinner.start(`Stopping container ${containerId} using port ${port}...`);
     
    await execa('docker', ['stop', containerId]);
    this.spinner.succeed(`Stopped container ${containerId} using port ${port}`);
    
    // Verify the port is now available
     
    const isNowAvailable = await this.isPortAvailable(port);
    if (isNowAvailable) {
      // Port is now available, so we can use it
      usedPorts.add(port);
      return { changed: false, shouldCancel: false };
    } 
    
    console.log(chalk.yellow(
      `Port ${port} is still in use after stopping the container. Using port ${nextPort} instead.`
    ));
     
    await this.updateDockerComposePorts(port, nextPort);
    return { changed: true, shouldCancel: false };
  }

  /**
   * Stop a Docker container using a port
   */
  private async stopContainerUsingPort(
    port: number, 
    nextPort: number,
    usedPorts: Set<number>
  ): Promise<{ changed: boolean; shouldCancel: boolean }> {
    try {
       
      const { stdout } = await execa('docker', [
        'ps', 
        '--format', 
        '{{.ID}}', 
        '--filter', 
        `publish=${port}`
      ]);
      
      const containerId = stdout.trim();
      if (!containerId) {
        console.log(chalk.yellow(
          `No Docker container found using port ${port}. Using port ${nextPort} instead.`
        ));
         
        await this.updateDockerComposePorts(port, nextPort);
        return { changed: true, shouldCancel: false };
      }
      
      // Stop the container and check if port is now available
      return await this.stopContainerAndCheckPort(containerId, port, nextPort, usedPorts);
    } catch (error) {
      this.spinner.fail(`Failed to stop container on port ${port}`);
      console.log(chalk.yellow(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
      console.log(chalk.yellow(`Using port ${nextPort} instead.`));
       
      await this.updateDockerComposePorts(port, nextPort);
      return { changed: true, shouldCancel: false };
    }
  }

  private async updateDockerComposeImages(): Promise<void> {
    const dockerComposePath = join(this.projectPath, 'docker-compose.yml');
    let content = await fs.readFile(dockerComposePath, 'utf8');
    const images = this.getPlatformSpecificImages();

    // Update image references in docker-compose.yml
    content = content.replaceAll(
      'image: wordpress:latest',
      `image: ${images.wordpress}`
    );
    content = content.replaceAll(
      /image: mysql:5.7/g,
      `image: ${images.mysql}`
    );

    await fs.writeFile(dockerComposePath, content);
  }

  private async waitForMySQL(): Promise<void> {
    this.spinner.start('Waiting for MySQL to be ready...');
    let attempts = 0;
    const maxAttempts = 30;
    
    // Ensure we have detected the Docker Compose command
    if (this.dockerComposeCommand[0] === 'docker-compose') {
      await this.detectDockerComposeCommand();
    }
    
    // Use a loop with explicit eslint disable for waiting
    while (attempts < maxAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await execa(this.dockerComposeCommand[0], [...this.dockerComposeCommand.slice(1), 'exec', '-T', 'mysql', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'root', '-proot'], {
          cwd: this.projectPath,
          stdio: 'ignore',
        });
        this.spinner.succeed('MySQL is ready');
        return;
      } catch {
        attempts++;
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>(resolve => {
          setTimeout(resolve, 1000);
        });
      }
    }
    
    this.spinner.fail('MySQL failed to start');
    this.prettyError(
      'MySQL Error',
      'MySQL failed to start within the expected time.',
      'Please check your Docker configuration and try again.'
    );
  }
} 