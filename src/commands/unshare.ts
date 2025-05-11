import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import * as fs from 'node:fs';
import ora from 'ora';

import { BaseCommand } from './base.js';

export default class Unshare extends BaseCommand {
  static description = 'Stop sharing your WordPress site through ngrok';
  static examples = [
    '$ wp-spin unshare',
    '$ wp-spin unshare --force',
    '$ wp-spin unshare --site=my-site',
  ];
  static hidden = false
  static flags = {
    ...BaseCommand.baseFlags,
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Show debugging information',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force kill ngrok processes without restoring WordPress configuration',
    }),
  };

  async run(): Promise<void> {
    const spinner = ora('Checking for running ngrok tunnels...');
    spinner.start();

    try {
      const { flags } = await this.parse(Unshare);
      
      // Check if ngrok is running
      const ngrokRunning = await this.checkNgrokRunning();
      
      if (!ngrokRunning) {
        spinner.info('No active ngrok tunnels found');
        console.log('No WordPress sites are currently being shared through ngrok.');
        return;
      }
      
      spinner.text = 'Stopping ngrok processes...';
      
      // Find WordPress container if needed for restoring config
      let wordpressContainer = '';
      if (!flags.force) {
        try {
          wordpressContainer = await this.findWordPressContainer() || '';
        } catch {
          // Continue even if container isn't found
        }
      }
      
      // Kill the ngrok processes
      const killed = await this.killNgrokProcesses(spinner, flags.debug);
      
      if (!killed) {
        spinner.fail('Failed to stop all ngrok processes');
        this.error('Could not stop all ngrok processes. Try running with --force flag or manually kill the processes.');
      }
      
      // If WordPress container exists and we're not forcing, try to restore the config
      if (wordpressContainer && !flags.force) {
        try {
          spinner.text = 'Restoring WordPress configuration...';
          await this.restoreWordPressConfig(wordpressContainer, spinner);
          spinner.succeed('WordPress configuration has been restored');
        } catch (error) {
          spinner.warn('Could not restore WordPress configuration');
          if (flags.debug) {
            console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      spinner.succeed('Successfully stopped sharing WordPress site');
      console.log(chalk.green('\nYour site is no longer accessible through ngrok.'));
      
    } catch (error) {
      spinner.fail('Failed to stop ngrok sharing');
      this.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if ngrok is running by accessing its API
   */
  private async checkNgrokRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('curl', ['-s', 'http://localhost:4040/api/tunnels']);
      const tunnels = JSON.parse(stdout);
      return tunnels?.tunnels?.length > 0;
    } catch {
      // If curl fails or can't connect to ngrok API, ngrok is not running
      return false;
    }
  }
  
  /**
   * Find WordPress config file paths
   */
  private async findConfigPaths(container: string): Promise<{
    backup: string;
    main: string;
    projectRoot: string | undefined;
  }> {
    let wpConfigPath = '';
    let wpConfigBackupPath = '';
    const projectRoot = this.findProjectRoot();
    
    // Strategy 1: Project root
    if (projectRoot) {
      const configPath = `${projectRoot}/wordpress/wp-config.php`;
      if (fs.existsSync(`${configPath}.bak`)) {
        wpConfigPath = configPath;
        wpConfigBackupPath = `${configPath}.bak`;
      }
    }
    
    // Strategy 2: Docker volume path (only works with local volumes)
    if (!wpConfigPath) {
      const dockerVolumePath = await this.findDockerVolumePath(container);
      if (dockerVolumePath) {
        const volPath = `${dockerVolumePath}/wp-config.php`;
        if (fs.existsSync(`${volPath}.bak`)) {
          wpConfigPath = volPath;
          wpConfigBackupPath = `${volPath}.bak`;
        }
      }
    }
    
    return {
      backup: wpConfigBackupPath,
      main: wpConfigPath,
      projectRoot: projectRoot || undefined,
    };
  }
  
  /**
   * Get Docker volume path for WordPress
   */
  private async findDockerVolumePath(container: string): Promise<string | undefined> {
    try {
      const { stdout: inspectOutput } = await execa('docker', [
        'inspect',
        '--format',
        '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}',
        container
      ]);
      
      return inspectOutput && inspectOutput.trim() ? inspectOutput.trim() : undefined;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Find the WordPress container name
   */
  private async findWordPressContainer(): Promise<string | undefined> {
    try {
      const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}}']);
      const containerNames = stdout.split('\n');
      return containerNames.find(name => name.includes('wordpress'));
    } catch {
      return undefined;
    }
  }
  
  /**
   * Kill all running ngrok processes
   */
  private async killNgrokProcesses(spinner: ReturnType<typeof ora>, debug = false): Promise<boolean> {
    try {
      // Different kill commands based on OS
      const killCommand = process.platform === 'win32' 
        ? await execa('taskkill', ['/F', '/IM', 'ngrok.exe'])
        : await execa('pkill', ['-f', 'ngrok']);
      
      if (debug) {
        console.log(`Kill command output: ${killCommand.stdout || 'No output'}`);
      }
      
      // Wait a moment for processes to terminate
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });
      
      // Verify that ngrok is really stopped
      const stillRunning = await this.checkNgrokRunning();
      if (stillRunning) {
        // Try one more time with more force using ternary instead of if/else
        await (process.platform === 'win32' 
          ? execa('taskkill', ['/F', '/IM', 'ngrok.exe', '/T']) 
          : execa('pkill', ['-9', '-f', 'ngrok']));
        
        // Wait a bit longer
        await new Promise(resolve => {
          setTimeout(resolve, 1500);
        });
        
        // Final check
        const finalCheck = await this.checkNgrokRunning();
        if (finalCheck) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      // Even if the kill command fails, it might be because ngrok isn't running
      // So check if ngrok is actually running before returning failure
      if (debug) {
        console.log(`Error stopping ngrok: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      const stillRunning = await this.checkNgrokRunning();
      return !stillRunning;
    }
  }
  
  /**
   * Remove ngrok config block from WordPress config
   */
  private async removeNgrokConfigBlock(
    projectRoot: string, 
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    const possiblePaths = [`${projectRoot}/wordpress/wp-config.php`];
    const pattern = /\/\/ Begin ngrok-specific URL configuration[\s\S]*?\/\/ End ngrok-specific URL configuration\n?/;
    
    // Process all config files sequentially instead of with await in a loop
    const results = await Promise.all(
      possiblePaths.map(async (path) => {
        if (!fs.existsSync(path)) {
          return false;
        }
        
        try {
          const fs = await import('node:fs/promises');
          const configContent = await fs.readFile(path, 'utf8');
          const updatedContent = configContent.replace(pattern, '');
          await fs.writeFile(path, updatedContent);
          spinner.succeed(`WordPress configuration restored by removing ngrok block at ${path}`);
          return true;
        } catch {
          return false;
        }
      })
    );
    
    // If no files were processed successfully
    if (!results.some(Boolean)) {
      spinner.warn('Could not find WordPress configuration files to restore');
    }
  }
  
  /**
   * Restore WordPress config from backup file
   */
  private async restoreFromBackup(
    configPath: string, 
    backupPath: string, 
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    await execa('cp', [backupPath, configPath]);
    await execa('rm', [backupPath]);
    spinner.succeed(`WordPress configuration restored from backup at ${configPath}`);
  }
  
  /**
   * Restore the WordPress config from backup
   */
  private async restoreWordPressConfig(
    container: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    try {
      // Try to find the WordPress config file and backup using several strategies
      const configPaths = await this.findConfigPaths(container);
      
      // Check if we found the backup
      if (configPaths.backup && fs.existsSync(configPaths.backup)) {
        await this.restoreFromBackup(configPaths.main, configPaths.backup, spinner);
      } else if (configPaths.projectRoot) {
        await this.removeNgrokConfigBlock(configPaths.projectRoot, spinner);
      }
    } catch (error) {
      spinner.fail('Failed to restore WordPress configuration');
      throw error;
    }
  }
} 