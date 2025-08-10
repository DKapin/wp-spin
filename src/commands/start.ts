import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { createPromptModule } from 'inquirer';
import * as fs from 'node:fs';
import { basename, join } from 'node:path';

import { BaseCommand, baseFlags } from './base.js';

export default class Start extends BaseCommand {
  static default = Start;
  static description = 'Start a WordPress development environment';
  static flags = {
    ...baseFlags,
    ide: Flags.string({
      dependsOn: ['xdebug'],
      description: 'IDE to configure for debugging (vscode, phpstorm, sublime, vim)',
      options: ['vscode', 'phpstorm', 'sublime', 'vim'],
    }),
    port: Flags.integer({
      char: 'p',
      description: 'Port to run WordPress on (if not specified, an available port will be found)',
    }),
    ssl: Flags.boolean({
      default: false,
      description: 'Enable SSL for custom domain',
    }),
    xdebug: Flags.boolean({
      default: false,
      description: 'Enable Xdebug for PHP debugging',
    }),
  };
  static hidden = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);

    // Check Docker environment
    await this.checkDockerEnvironment();

    // Check if project exists
    await this.checkProjectExists();

    try {
      // Initialize nginx proxy if domain is provided
      this.nginxProxy = flags.domain && !this.nginxProxy ? new (await import('../services/nginx-proxy.js')).NginxProxyService() : this.nginxProxy;

      // Handle Xdebug configuration
      await this.configureXdebug(flags.xdebug, flags.ide);

      // Start containers
      await this.docker.start();

      // Setup Xdebug if enabled
      if (flags.xdebug) {
        const containerNames = this.getContainerNames();
        
        try {
          await this.setupXdebugInContainer(containerNames.wordpress);
        } catch {
          this.log(chalk.yellow('⚠️  Xdebug setup failed, but container is running. You can install Xdebug manually if needed.'));
        }
      }

      // Get the actual port (might be different if there was a port conflict)
      const port = await this.docker.getPort('wordpress');

      // Configure custom domain if specified
      if (flags.domain) {
        // Check if domain is already configured
        const existingPort = this.nginxProxy.getPortForDomain(flags.domain);
        const shouldUpdatePort = existingPort && existingPort !== port;
        // eslint-disable-next-line unicorn/prefer-ternary -- Cannot use ternary with await
        if (shouldUpdatePort) {
          // Port has changed, update nginx config
          await this.nginxProxy.updateSitePort(flags.domain, port);
        } else {
          // New domain or same port, add/update domain
          await this.nginxProxy.addDomain(flags.domain, port, flags.ssl);
        }
      }

      this.log(`\n${chalk.green('WordPress development environment started successfully!')}`);

      this.log(`\nYou can access your site at:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}`)}`);
      if (flags.domain) {
        const protocol = flags.ssl ? 'https' : 'http';
        this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}`)}`);
      }

      this.log(`\nWordPress admin:`);
      this.log(`  ${chalk.cyan(`http://localhost:${port}/wp-admin`)}`);
      if (flags.domain) {
        const protocol = flags.ssl ? 'https' : 'http';
        this.log(`  ${chalk.cyan(`${protocol}://${flags.domain}/wp-admin`)}`);
      }

      this.log(`\nDefault credentials:`);
      this.log(`  Username: ${chalk.cyan('admin')}`);
      this.log(`  Password: ${chalk.cyan('password')}`);
    } catch (error) {
      this.error(`Failed to start WordPress environment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Configure Xdebug by setting environment variable in .env file
   */
  private async configureXdebug(enableXdebug: boolean, ideFlag?: string): Promise<void> {
    const envPath = join(process.cwd(), '.env');
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
      this.log(chalk.yellow('🐛 Xdebug enabled for debugging'));
      
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
    } else {
      this.log(chalk.gray('Xdebug disabled for optimal performance'));
    }
  }
  
  /**
   * Show IDE-specific setup instructions
   */
  private async showIdeInstructions(ide: string): Promise<void> {
    const projectPath = process.cwd();
    const projectName = basename(projectPath);
    
    this.log(chalk.cyan('\n📋 IDE Setup Instructions:'));
    
    switch (ide) {
      case 'phpstorm': {
        this.log(chalk.green('\n🎯 PhpStorm/IntelliJ IDEA Xdebug Setup:'));
        this.log(chalk.white('1. Configure PHP Server:'));
        this.log(chalk.cyan('   • Go to File → Settings → PHP → Servers'));
        this.log(chalk.cyan(`   • Click '+' to add server: Name="${projectName}"`));
        this.log(chalk.cyan('   • Host: "localhost", Port: 80'));
        this.log(chalk.cyan('   • Check "Use path mappings"'));
        this.log(chalk.cyan(`   • Map: /var/www/html → ${projectPath}`));
        
        this.log(chalk.white('\n2. Configure Xdebug:'));
        this.log(chalk.cyan('   • Go to Settings → PHP → Debug'));
        this.log(chalk.cyan('   • Set Xdebug port to 9003'));
        this.log(chalk.cyan('   • Check "Can accept external connections"'));
        
        this.log(chalk.white('3. Start Debug Listener:'));
        this.log(chalk.cyan('   • Click the phone icon in toolbar (Start Listening)'));
        this.log(chalk.cyan('   • Or go to Run → Start Listening for PHP Debug Connections'));
        this.log(chalk.cyan('   • Icon should turn green when listening'));
        
        this.log(chalk.white('4. Set Breakpoints & Debug:'));
        this.log(chalk.cyan('   • Click in the gutter next to line numbers to set breakpoints'));
        this.log(chalk.cyan('   • Access your WordPress site to trigger debugging'));
        this.log(chalk.cyan('   • PhpStorm will pause at breakpoints and show variables'));
        break;
      }
        
      case 'sublime': {
        this.log(chalk.white('1. Install "Xdebug Client" package via Package Control'));
        this.log(chalk.white('2. Add to your project settings:'));
        this.log(chalk.gray(`
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
        this.log(chalk.white('3. Tools → Xdebug → Start Debugging'));
        break;
      }
        
      case 'vim': {
        this.log(chalk.white('1. Install Vdebug plugin'));
        this.log(chalk.white('2. Add to your .vimrc:'));
        this.log(chalk.gray(`
let g:vdebug_options = {
    "port": 9003,
    "path_maps": {"/var/www/html": "${projectPath}"}
}
        `));
        this.log(chalk.white('3. Press <F5> to start debugging'));
        break;
      }
        
      case 'vscode': {
        this.log(chalk.green('\n🆚 VS Code Xdebug Setup:'));
        this.log(chalk.white('1. Open Project in VS Code:'));
        this.log(chalk.cyan(`   • Run: cd ${projectName} && code .`));
        this.log(chalk.cyan('   • Make sure VS Code opens the wp-spin project directory, not a parent folder'));
        
        this.log(chalk.white('\n2. Install PHP Debug Extension:'));
        this.log(chalk.cyan('   • Open VS Code Extensions (Ctrl+Shift+X)'));
        this.log(chalk.cyan('   • Search for "PHP Debug" by Xdebug'));
        this.log(chalk.cyan('   • Click Install on the extension by Xdebug'));
        
        this.log(chalk.white('\n3. Create Debug Configuration:'));
        this.log(chalk.cyan('   • Create .vscode folder in your project root if it doesn\'t exist'));
        this.log(chalk.cyan('   • Create .vscode/launch.json with this content:'));
        this.log(chalk.gray(`
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
        
        this.log(chalk.white('4. Start Debugging:'));
        this.log(chalk.cyan('   • Press F5 or click Run → Start Debugging'));
        this.log(chalk.cyan('   • You should see "Listening for Xdebug" in the debug console'));
        this.log(chalk.cyan('   • Set breakpoints by clicking left of line numbers'));
        
        this.log(chalk.white('5. Trigger Debugging:'));
        this.log(chalk.cyan('   • Open your WordPress site in a browser'));
        this.log(chalk.cyan('   • Navigate to pages/trigger code with breakpoints'));
        this.log(chalk.cyan('   • VS Code will pause execution at breakpoints'));
        break;
      }
        
      default: {
        this.log(chalk.white('Generic Xdebug setup:'));
        this.log(chalk.white('• Port: 9003'));
        this.log(chalk.white('• Host: localhost'));
        this.log(chalk.white(`• Path mapping: /var/www/html → ${projectPath}`));
        this.log(chalk.white('• IDE Key: docker'));
        break;
      }
    }
    
    this.log(chalk.green('\n✅ Xdebug is ready! Set breakpoints and refresh your browser.'));
    this.log(chalk.yellow('💡 Tip: Access your site and trigger the code you want to debug.'));
  }
}
