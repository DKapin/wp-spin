import { Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createPromptModule } from 'inquirer';
import * as fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';

import { detectAndMigrateSiteConfig, getSiteByPath, updateSiteConfigWithDetected } from '../config/sites.js';
import { DockerService } from '../services/docker.js';
import { BaseCommand, baseFlags } from './base.js';

export default class Restart extends BaseCommand {
  static description = 'Restart the WordPress environment';
  static examples = [
    '$ wp-spin restart',
  ];
  static flags = {
    ...baseFlags,
    ide: Flags.string({
      dependsOn: ['xdebug'],
      description: 'IDE to configure for debugging (vscode, phpstorm, sublime, vim)',
      options: ['vscode', 'phpstorm', 'sublime', 'vim'],
    }),
    xdebug: Flags.boolean({
      default: false,
      description: 'Enable Xdebug for PHP debugging',
    }),
  };
  static hidden = false;
  protected docker: DockerService;

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Restart);
    const spinner = ora();
    const projectPath = process.cwd();

    // Handle Xdebug configuration
    await this.configureXdebug(flags.xdebug, flags.ide);

    try {
      // Check if project exists
      if (!fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
        this.error('No WordPress project found in current directory');
      }

      // Check Docker environment
      await this.checkDockerEnvironment();

      // Get site configuration with auto-migration
      let siteConfig = getSiteByPath(projectPath);

      // Auto-migrate missing configuration if site exists but has incomplete config
      if (siteConfig && (!siteConfig.domain || siteConfig.ssl === undefined || siteConfig.multisite === undefined)) {
        spinner.text = 'Updating site configuration with detected settings...';

        // Detect missing configuration from fallback sources
        const detectedConfig = detectAndMigrateSiteConfig(projectPath);

        // Update the site config with detected settings
        if (Object.keys(detectedConfig).length > 0) {
          updateSiteConfigWithDetected(siteConfig.name, detectedConfig);

          // Re-fetch the updated config
          siteConfig = getSiteByPath(projectPath);
          spinner.succeed('Site configuration updated with detected settings');
        }
      }

      const domain = siteConfig?.domain;

      // Initialize nginx proxy if domain is configured
      if (domain && !this.nginxProxy) {
        this.nginxProxy = new (await import('../services/nginx-proxy.js')).NginxProxyService();
      }

      if (!domain) {
        spinner.info('No domain configuration found for this site');
        // Restart containers with environment reload to pick up XDEBUG_MODE changes
        await this.docker.restartWithEnvReload(false);
        spinner.succeed('WordPress environment restarted successfully');
        return;
      }

      // Ensure nginx-proxy container is running when we have a domain
      await this.nginxProxy!.ensureProxyRunning();
      
      // Check if this domain is configured
      const currentPort = this.nginxProxy.getPortForDomain(domain);
      if (!currentPort) {
        spinner.info('No nginx configuration found for this domain');
        // Restart containers with environment reload to pick up XDEBUG_MODE changes
        await this.docker.restartWithEnvReload(false);
        spinner.succeed('WordPress environment restarted successfully');
        return;
      }

      // Restart containers with environment reload to pick up XDEBUG_MODE changes
      await this.docker.restartWithEnvReload(false);

      // Setup Xdebug if enabled
      if (flags.xdebug) {
        const containerNames = this.getContainerNames();
        
        try {
          await this.setupXdebugInContainer(containerNames.wordpress);
        } catch {
          this.log(chalk.yellow('⚠️  Xdebug setup failed, but container is running. You can install Xdebug manually if needed.'));
        }
      }

      // Get the actual port after restart
      const newPort = await this.docker.getPort('wordpress');

      // If the port has changed, update nginx configuration
      if (currentPort !== newPort) {
        spinner.text = 'Updating nginx configuration...';
        await this.nginxProxy.updateSitePort(domain, newPort);
        spinner.succeed('Nginx configuration updated');
      }

      spinner.succeed('WordPress environment restarted successfully');
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : 'An unknown error occurred');
      throw error;
    }
  }

  /**
   * Configure Xdebug by setting environment variable in .env file
   */
  private async configureXdebug(enableXdebug: boolean, ideFlag?: string): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Set Xdebug mode based on flag
    const xdebugMode = enableXdebug ? 'debug' : 'off';
    
    // Update or add XDEBUG_MODE variable
    if (envContent.includes('XDEBUG_MODE=')) {
      envContent = envContent.replaceAll(/XDEBUG_MODE=.*/g, `XDEBUG_MODE=${xdebugMode}`);
    } else {
      envContent += `\nXDEBUG_MODE=${xdebugMode}\n`;
    }
    
    // Write updated .env file
    fs.writeFileSync(envPath, envContent);
    
    if (enableXdebug) {
      console.log(chalk.yellow('🐛 Xdebug enabled for debugging'));
      
      // Ask for IDE if not provided
      let selectedIde = ideFlag;
      if (!selectedIde) {
        const prompt = createPromptModule();
        const { ide } = await prompt({
          choices: [
            { name: '🆚 Visual Studio Code', value: 'vscode' },
            { name: '🎯 PhpStorm/IntelliJ IDEA', value: 'phpstorm' },
            { name: '🎨 Sublime Text', value: 'sublime' },
            { name: '⚡ Vim/Neovim', value: 'vim' },
            { name: '🔧 Other/Manual setup', value: 'other' },
          ],
          message: 'Which IDE/editor are you using for debugging?',
          name: 'ide',
          type: 'list',
        });
        selectedIde = ide;
      }
      
      // Provide IDE-specific instructions
      await this.showIdeInstructions(selectedIde || 'other');
    }
  }
  
  /**
   * Show IDE-specific setup instructions
   */
  private async showIdeInstructions(ide: string): Promise<void> {
    const projectPath = process.cwd();
    const projectName = path.basename(projectPath);
    
    console.log(chalk.cyan('\n📋 IDE Setup Instructions:'));
    
    switch (ide) {
      case 'phpstorm': {
        console.log(chalk.white('1. Go to Settings → PHP → Servers'));
        console.log(chalk.white(`2. Add server: Name="${projectName}", Host="localhost", Port=80`));
        console.log(chalk.white('3. Set path mapping: /var/www/html → {your project root}'));
        console.log(chalk.white('4. Run → Start Listening for PHP Debug Connections'));
        console.log(chalk.white('5. Set breakpoints and trigger your PHP code'));
        break;
      }
        
      case 'sublime': {
        console.log(chalk.white('1. Install "Xdebug Client" package via Package Control'));
        console.log(chalk.white('2. Add to your project settings:'));
        console.log(chalk.gray(`
{
  "settings": {
    "xdebug": {
      "port": 9003,
      "path_mapping": {
        "/var/www/html": "${projectPath}"
      }
    }
  }
}
        `));
        console.log(chalk.white('3. Tools → Xdebug → Start Debugging'));
        break;
      }
        
      case 'vim': {
        console.log(chalk.white('1. Install Vdebug plugin'));
        console.log(chalk.white('2. Add to your .vimrc:'));
        console.log(chalk.gray(`
let g:vdebug_options = {
    "port": 9003,
    "path_maps": {"/var/www/html": "${projectPath}"}
}
        `));
        console.log(chalk.white('3. Press <F5> to start debugging'));
        break;
      }
        
      case 'vscode': {
        console.log(chalk.green('\n🆚 VS Code Xdebug Setup:'));
        console.log(chalk.white('1. Open Project in VS Code:'));
        console.log(chalk.cyan(`   • Run: cd ${projectName} && code .`));
        console.log(chalk.cyan('   • Make sure VS Code opens the wp-spin project directory, not a parent folder'));
        
        console.log(chalk.white('\n2. Install PHP Debug Extension:'));
        console.log(chalk.cyan('   • Open VS Code Extensions (Ctrl+Shift+X)'));
        console.log(chalk.cyan('   • Search for "PHP Debug" by Xdebug'));
        console.log(chalk.cyan('   • Click Install on the extension by Xdebug'));
        
        console.log(chalk.white('\n3. Create Debug Configuration:'));
        console.log(chalk.cyan('   • Create .vscode folder in your project root if it doesn\'t exist'));
        console.log(chalk.cyan('   • Create .vscode/launch.json with this content:'));
        console.log(chalk.gray(`
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Listen for Xdebug",
      "type": "php",
      "request": "launch",
      "port": 9003,
      "pathMappings": {
        "/var/www/html/wp-content": "\${workspaceFolder}/wp-content"
      },
      "log": true
    }
  ]
}
        `));
        
        console.log(chalk.white('4. Start Debugging:'));
        console.log(chalk.cyan('   • Press F5 or click Run → Start Debugging'));
        console.log(chalk.cyan('   • You should see "Listening for Xdebug" in the debug console'));
        console.log(chalk.cyan('   • Set breakpoints by clicking left of line numbers'));
        
        console.log(chalk.white('5. Trigger Debugging:'));
        console.log(chalk.cyan('   • Open your WordPress site in a browser'));
        console.log(chalk.cyan('   • Navigate to pages/trigger code with breakpoints'));
        console.log(chalk.cyan('   • VS Code will pause execution at breakpoints'));
        break;
      }
        
      default: {
        console.log(chalk.white('Generic Xdebug setup:'));
        console.log(chalk.white('• Port: 9003'));
        console.log(chalk.white('• Host: localhost'));
        console.log(chalk.white(`• Path mapping: /var/www/html → ${projectPath}`));
        console.log(chalk.white('• IDE Key: docker'));
        break;
      }
    }
    
    console.log(chalk.green('\n✅ Xdebug is ready! Set breakpoints and refresh your browser.'));
    console.log(chalk.yellow('💡 Tip: Access your site and trigger the code you want to debug.'));
  }
}
