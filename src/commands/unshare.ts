import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';

import { BaseCommand } from './base.js';

export default class Unshare extends BaseCommand {
  static description = 'Stop sharing your WordPress site through ngrok';
  
  static examples = [
    '$ wp-spin unshare',
    '$ wp-spin unshare --force',
    '$ wp-spin unshare --site=my-site',
  ];

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
        // Try one more time with more force
        if (process.platform === 'win32') {
          await execa('taskkill', ['/F', '/IM', 'ngrok.exe', '/T']);
        } else {
          await execa('pkill', ['-9', '-f', 'ngrok']);
        }
        
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
   * Restore the WordPress config from backup
   */
  private async restoreWordPressConfig(
    container: string,
    spinner: ReturnType<typeof ora>
  ): Promise<void> {
    try {
      // Try to find the WordPress config file and backup using several strategies
      let wpConfigPath = '';
      let wpConfigBackupPath = '';
      
      // Strategy 1: Project root
      const projectRoot = this.findProjectRoot();
      if (projectRoot) {
        const configPath = `${projectRoot}/wordpress/wp-config.php`;
        if (this.existsSync(`${configPath}.bak`)) {
          wpConfigPath = configPath;
          wpConfigBackupPath = `${configPath}.bak`;
        }
      }
      
      // Strategy 2: Docker volume path (only works with local volumes)
      if (!wpConfigPath) {
        try {
          const { stdout: inspectOutput } = await execa('docker', [
            'inspect',
            '--format',
            '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}',
            container
          ]);
          
          if (inspectOutput && inspectOutput.trim()) {
            const volPath = `${inspectOutput.trim()}/wp-config.php`;
            if (this.existsSync(`${volPath}.bak`)) {
              wpConfigPath = volPath;
              wpConfigBackupPath = `${volPath}.bak`;
            }
          }
        } catch {
          // Continue with other strategies
        }
      }
      
      // Check if we found the backup
      if (wpConfigBackupPath && this.existsSync(wpConfigBackupPath)) {
        // Restore from backup
        await execa('cp', [wpConfigBackupPath, wpConfigPath]);
        await execa('rm', [wpConfigBackupPath]);
        spinner.succeed(`WordPress configuration restored from backup at ${wpConfigPath}`);
      } else if (projectRoot) {
        // If no backup found, try to remove ngrok configuration block
        const possiblePaths = [
          `${projectRoot}/wordpress/wp-config.php`,
        ];
        
        for (const path of possiblePaths) {
          if (this.existsSync(path)) {
            try {
              // Read the file
              const fs = await import('node:fs/promises');
              const configContent = await fs.readFile(path, 'utf8');
              
              // Remove the ngrok-specific configuration pattern
              const pattern = /\/\/ Begin ngrok-specific URL configuration[\s\S]*?\/\/ End ngrok-specific URL configuration\n?/;
              const updatedContent = configContent.replace(pattern, '');
              
              // Write the updated config back to the file
              await fs.writeFile(path, updatedContent);
              spinner.succeed(`WordPress configuration restored by removing ngrok block at ${path}`);
              break;
            } catch {
              // Continue to the next path if this one fails
            }
          }
        }
      }
    } catch (error) {
      spinner.fail('Failed to restore WordPress configuration');
      throw error;
    }
  }
} 