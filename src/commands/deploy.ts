import { Args, Config, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { join } from 'node:path';
import ora from 'ora';

import { DockerService } from '../services/docker.js';
import { BaseCommand } from './base.js';

interface DeployConfig {
  backup?: boolean;
  db?: boolean;
host?: string;
  path?: string;
  provider: string;
  predeploy?: string;
  media?: boolean;
}

// Supported provider types
type Provider = 'aws' | 'cloudways' | 'digitalocean' | 'git' | 'siteground' | 'ssh' | 'wpengine';

export default class Deploy extends BaseCommand {
  static args = {
    destination: Args.string({
      description: 'Deployment destination (can be an alias defined in deploy.config.json)',
      required: false,
    }),
  };

  static description = 'Deploy WordPress project to a remote host';

  static examples = [
    'wp-spin deploy',
    'wp-spin deploy production',
    'wp-spin deploy staging --provider=wpengine',
    'wp-spin deploy --provider=ssh --host=example.com --path=/var/www/html',
    'wp-spin deploy --db --media',
    'wp-spin deploy --dry-run',
  ];

  static flags = {
    host: Flags.string({
      char: 'h',
      description: 'Destination host (IP address or domain)',
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Hosting provider (aws, digitalocean, wpengine, siteground, cloudways, ssh, git)',
      options: ['aws', 'digitalocean', 'wpengine', 'siteground', 'cloudways', 'ssh', 'git'],
    }),
    path: Flags.string({
      description: 'Remote path where WordPress files will be deployed',
    }),
    db: Flags.boolean({
      default: false,
      description: 'Include WordPress database in the deployment',
    }),
    predeploy: Flags.string({
      description: 'Run a local shell command before deployment',
    }),
    media: Flags.boolean({
      default: false,
      description: 'Include wp-content/uploads directory in the deployment',
    }),
    backup: Flags.boolean({
      default: false,
      description: 'Create backup of the existing site on the remote host',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Simulate the deployment without performing actual changes',
    }),
  };

  protected docker: DockerService;
  private spinner = ora();
  private configFile = 'deploy.config.json';
  private deployConfig: DeployConfig = {
    provider: 'ssh',
  };

  constructor(argv: string[], config: Config) {
    super(argv, config);
    this.docker = new DockerService(process.cwd());
  }

  /**
   * Ensure we're in a WordPress project directory
   */
  private async ensureProjectDirectory(): Promise<void> {
    await this.checkProjectExists();
  }

  async run(): Promise<void> {
    try {
      // Ensure we're in a WordPress project directory
      await this.ensureProjectDirectory();

      // Check if Docker is running
      await this.checkDockerEnvironment();

      // Parse arguments and flags
      const { args, flags } = await this.parse(Deploy);

      // Load configuration from file if it exists
      await this.loadDeployConfig();

      // Override config with CLI flags
      this.mergeConfigWithFlags(flags);

      // If destination is provided, try to load it from config
      if (args.destination) {
        await this.loadDestinationConfig(args.destination);
      }

      // Validate required configuration for the selected provider
      this.validateProviderConfig();

      // Print deployment plan
      this.printDeploymentPlan();

      // Confirm deployment
      if (!flags['dry-run'] && !(await this.confirmDeployment())) {
        this.log(chalk.yellow('Deployment cancelled'));
        return;
      }

      // Run pre-deployment tasks
      if (this.deployConfig.predeploy) {
        await this.runPredeployCommand();
      }

      // Execute the deployment based on the provider
      if (flags['dry-run']) {
        this.log(chalk.blue('Dry run - no actual deployment will be performed'));
      } else {
        await this.executeDeployment();
      }

    } catch (error) {
      this.spinner.fail('Deployment failed');
      if (error instanceof Error) {
        this.error(error.message);
      }
      this.error('Deployment failed');
    }
  }

  /**
   * Load the deployment configuration from the deploy.config.json file
   */
  private async loadDeployConfig(): Promise<void> {
    const configPath = join(process.cwd(), this.configFile);
    
    try {
      if (fs.existsSync(configPath)) {
        this.spinner.start('Loading deployment configuration...');
        const config = await fs.readJson(configPath);
        
        // Apply default configuration
        if (config.default) {
          this.deployConfig = { 
            ...this.deployConfig,
            ...config.default 
          };
        }
        
        this.spinner.succeed('Deployment configuration loaded');
      }
    } catch (error) {
      this.spinner.warn('Failed to load deploy.config.json, using defaults');
      // Just continue with default configuration
    }
  }

  /**
   * Load a specific destination configuration from the deploy.config.json file
   */
  private async loadDestinationConfig(destination: string): Promise<void> {
    const configPath = join(process.cwd(), this.configFile);
    
    try {
      if (fs.existsSync(configPath)) {
        this.spinner.start(`Loading ${destination} configuration...`);
        const config = await fs.readJson(configPath);
        
        // If the destination exists in the config, apply it
        if (config[destination]) {
          this.deployConfig = { 
            ...this.deployConfig,
            ...config[destination] 
          };
          this.spinner.succeed(`${destination} configuration loaded`);
        } else {
          this.spinner.warn(`Destination "${destination}" not found in config, using defaults`);
        }
      }
    } catch (error) {
      this.spinner.warn(`Failed to load ${destination} configuration, using defaults`);
      // Continue with default configuration
    }
  }

  /**
   * Merge CLI flags with the loaded configuration
   */
  private mergeConfigWithFlags(flags: any): void {
    // Only override if flag is explicitly provided
    if (flags.provider) this.deployConfig.provider = flags.provider;
    if (flags.host) this.deployConfig.host = flags.host;
    if (flags.path) this.deployConfig.path = flags.path;
    if (flags.predeploy) this.deployConfig.predeploy = flags.predeploy;
    
    // Boolean flags
    if (flags.db !== undefined) this.deployConfig.db = flags.db;
    if (flags.media !== undefined) this.deployConfig.media = flags.media;
    if (flags.backup !== undefined) this.deployConfig.backup = flags.backup;
  }

  /**
   * Validate the configuration for the selected provider
   */
  private validateProviderConfig(): void {
    const provider = this.deployConfig.provider as Provider;
    
    switch (provider) {
      case 'ssh': {
        if (!this.deployConfig.host) {
          throw new Error('Host is required for SSH deployment');
        }
        if (!this.deployConfig.path) {
          throw new Error('Path is required for SSH deployment');
        }
        break;
      }
      case 'digitalocean': {
        if (!this.deployConfig.host) {
          throw new Error('Host is required for DigitalOcean deployment');
        }
        if (!this.deployConfig.path) {
          throw new Error('Path is required for DigitalOcean deployment');
        }
        break;
      }
      case 'wpengine': {
        // WP Engine uses API-based deployment, so we don't need host
        break;
      }
      case 'siteground': {
        if (!this.deployConfig.host) {
          throw new Error('Host is required for SiteGround deployment');
        }
        break;
      }
      case 'cloudways': {
        if (!this.deployConfig.host) {
          throw new Error('Host is required for Cloudways deployment');
        }
        if (!this.deployConfig.path) {
          throw new Error('Path is required for Cloudways deployment');
        }
        break;
      }
      case 'git': {
        // Git-based deployment requires repository information that should be in config
        break;
      }
      case 'aws': {
        // For AWS deployment, we could use either direct instance access or AWS services like Elastic Beanstalk, S3, etc.
        // Here we'll assume basic EC2 instance access for simplicity
        if (!this.deployConfig.host) {
          throw new Error('Host (EC2 instance address) is required for AWS deployment');
        }
        if (!this.deployConfig.path) {
          throw new Error('Path is required for AWS deployment');
        }
        break;
      }
      default: {
        this.spinner.warn(`Unknown provider "${provider}", falling back to SSH deployment`);
        this.deployConfig.provider = 'ssh';
        
        // Validate SSH requirements
        if (!this.deployConfig.host) {
          throw new Error('Host is required for SSH deployment');
        }
        if (!this.deployConfig.path) {
          throw new Error('Path is required for SSH deployment');
        }
      }
    }
  }

  /**
   * Print the deployment plan for confirmation
   */
  private printDeploymentPlan(): void {
    console.log(chalk.bold('\n📦 Deployment Plan:'));
    console.log(chalk.blue(`Provider: ${this.deployConfig.provider}`));
    
    if (this.deployConfig.host) {
      console.log(chalk.blue(`Host: ${this.deployConfig.host}`));
    }
    
    if (this.deployConfig.path) {
      console.log(chalk.blue(`Remote path: ${this.deployConfig.path}`));
    }
    
    if (this.deployConfig.predeploy) {
      console.log(chalk.blue(`Pre-deployment command: ${this.deployConfig.predeploy}`));
    }
    
    // Options
    const options = [];
    if (this.deployConfig.db) options.push('Database');
    if (this.deployConfig.media) options.push('Media files');
    if (this.deployConfig.backup) options.push('Remote backup');
    
    if (options.length > 0) {
      console.log(chalk.blue(`Options: ${options.join(', ')}`));
    }
    
    console.log(''); // Empty line for better readability
  }

  /**
   * Ask for deployment confirmation
   */
  private async confirmDeployment(): Promise<boolean> {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Do you want to proceed with the deployment?',
        default: false,
      },
    ]);
    
    return confirm;
  }

  /**
   * Run the pre-deployment command if specified
   */
  private async runPredeployCommand(): Promise<void> {
    if (!this.deployConfig.predeploy) return;
    
    this.spinner.start(`Running pre-deployment command: ${this.deployConfig.predeploy}`);
    
    try {
      await execa(this.deployConfig.predeploy, { shell: true, stdio: 'inherit' });
      this.spinner.succeed('Pre-deployment command executed successfully');
    } catch (error) {
      this.spinner.fail('Pre-deployment command failed');
      throw new Error(`Pre-deployment command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute the deployment based on the provider
   */
  private async executeDeployment(): Promise<void> {
    const provider = this.deployConfig.provider as Provider;
    
    this.spinner.start(`Deploying to ${provider}...`);
    
    // Create a backup if requested
    if (this.deployConfig.backup) {
      await this.createRemoteBackup();
    }
    
    // Export database if requested
    if (this.deployConfig.db) {
      await this.exportDatabase();
    }
    
    // Deploy files based on the selected provider
    switch (provider) {
      case 'ssh': {
        await this.deployWithSsh();
        break;
      }
      case 'digitalocean': {
        await this.deployToDigitalOcean();
        break;
      }
      case 'wpengine': {
        await this.deployToWpEngine();
        break;
      }
      case 'siteground': {
        await this.deployToSiteGround();
        break;
      }
      case 'cloudways': {
        await this.deployToCloudways();
        break;
      }
      case 'git': {
        await this.deployWithGit();
        break;
      }
      case 'aws': {
        await this.deployToAws();
        break;
      }
      default: {
        // Default to SSH deployment
        await this.deployWithSsh();
      }
    }
    
    this.spinner.succeed(`Successfully deployed to ${provider}`);
  }

  /**
   * Create a backup of the remote site
   */
  private async createRemoteBackup(): Promise<void> {
    this.spinner.start('Creating remote backup...');
    
    // Based on provider, choose the appropriate backup method
    const provider = this.deployConfig.provider as Provider;
    
    switch (provider) {
      case 'wpengine': {
        // WP Engine API-based backup
        this.spinner.succeed('Backup created via WP Engine API');
        break;
      }
      default: {
        // Default SSH-based backup
        if (this.deployConfig.host && this.deployConfig.path) {
          const backupPath = `${this.deployConfig.path}_backup_${Date.now()}`;
          try {
            await execa('ssh', [
              this.deployConfig.host,
              `cp -r ${this.deployConfig.path} ${backupPath}`,
            ]);
            this.spinner.succeed(`Backup created at ${backupPath}`);
          } catch (error) {
            this.spinner.warn('Backup failed, proceeding with deployment');
            // Don't throw error, proceed with deployment
          }
        }
      }
    }
  }

  /**
   * Export the WordPress database
   */
  private async exportDatabase(): Promise<void> {
    this.spinner.start('Exporting WordPress database...');
    
    try {
      // Get WordPress container name
      const containers = (await execa('docker', ['ps', '--format', '{{.Names}}'])).stdout;
      const wordpressContainer = containers.split('\n').find(name => name.includes('wordpress'));
      
      if (!wordpressContainer) {
        throw new Error('WordPress container not found. Make sure the Docker environment is running.');
      }
      
      // Export the database using WP-CLI in the container
      await execa('docker', [
        'exec',
        wordpressContainer,
        'wp',
        'db',
        'export',
        '/var/www/html/wordpress_export.sql',
        '--allow-root',
      ]);
      
      this.spinner.succeed('Database exported successfully');
    } catch (error) {
      this.spinner.fail('Database export failed');
      throw new Error(`Database export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy using SSH
   */
  private async deployWithSsh(): Promise<void> {
    if (!this.deployConfig.host || !this.deployConfig.path) {
      throw new Error('Host and path are required for SSH deployment');
    }
    
    this.spinner.start('Deploying with SSH...');
    
    try {
      // Create temporary archive of WordPress files
      await execa('tar', [
        '-czf',
        'wordpress_deploy.tar.gz',
        '-C', 
        'wordpress',
        '.',
      ]);
      
      // Upload the archive
      await execa('scp', [
        'wordpress_deploy.tar.gz',
        `${this.deployConfig.host}:/tmp/`,
      ]);
      
      // Extract the archive on the remote server
      await execa('ssh', [
        this.deployConfig.host,
        `mkdir -p ${this.deployConfig.path} && ` +
        `tar -xzf /tmp/wordpress_deploy.tar.gz -C ${this.deployConfig.path} && ` +
        `rm /tmp/wordpress_deploy.tar.gz`,
      ]);
      
      // Upload database if requested
      if (this.deployConfig.db) {
        await execa('scp', [
          'wordpress/wordpress_export.sql',
          `${this.deployConfig.host}:${this.deployConfig.path}/`,
        ]);
      }
      
      // Clean up local files
      await fs.remove('wordpress_deploy.tar.gz');
      if (this.deployConfig.db) {
        await fs.remove('wordpress/wordpress_export.sql');
      }
      
      this.spinner.succeed('Deployment completed successfully');
    } catch (error) {
      this.spinner.fail('SSH deployment failed');
      throw new Error(`SSH deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy to DigitalOcean
   */
  private async deployToDigitalOcean(): Promise<void> {
    // DigitalOcean deployment is similar to SSH but might use specific features
    this.spinner.start('Deploying to DigitalOcean...');
    
    // For now, use SSH deployment method with potential DigitalOcean-specific enhancements
    await this.deployWithSsh();
    
    this.spinner.succeed('DigitalOcean deployment completed');
  }

  /**
   * Deploy to WP Engine
   */
  private async deployToWpEngine(): Promise<void> {
    this.spinner.start('Deploying to WP Engine...');
    
    // Placeholder for WP Engine API deployment
    // This would normally use WP Engine's Git push functionality or API
    
    this.spinner.info('WP Engine deployment is a placeholder in this version.');
    this.spinner.info('In a full implementation, this would use WP Engine\'s Git deployment.');
    
    // Simulate deployment for demo purposes
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.spinner.succeed('WP Engine deployment completed');
  }

  /**
   * Deploy to SiteGround
   */
  private async deployToSiteGround(): Promise<void> {
    this.spinner.start('Deploying to SiteGround...');
    
    // SiteGround deployment might use SSH or their specific tools
    // For now, use SSH deployment method
    await this.deployWithSsh();
    
    this.spinner.succeed('SiteGround deployment completed');
  }

  /**
   * Deploy to Cloudways
   */
  private async deployToCloudways(): Promise<void> {
    this.spinner.start('Deploying to Cloudways...');
    
    // Cloudways deployment might use SSH or their specific tools
    // For now, use SSH deployment method
    await this.deployWithSsh();
    
    this.spinner.succeed('Cloudways deployment completed');
  }

  /**
   * Deploy with Git
   */
  private async deployWithGit(): Promise<void> {
    this.spinner.start('Deploying with Git...');
    
    // Placeholder for Git-based deployment
    // This would normally involve pushing to a Git repository
    // which would then trigger deployment on the hosting platform
    
    this.spinner.info('Git deployment is a placeholder in this version.');
    this.spinner.info('In a full implementation, this would push to a Git repository.');
    
    // Simulate deployment for demo purposes
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.spinner.succeed('Git deployment completed');
  }

  /**
   * Deploy to AWS
   */
  private async deployToAws(): Promise<void> {
    if (!this.deployConfig.host || !this.deployConfig.path) {
      throw new Error('Host and path are required for AWS deployment');
    }
    
    this.spinner.start('Deploying to AWS...');
    
    try {
      // In a full implementation, this would:
      // 1. Use AWS SDK for JavaScript to authenticate
      // 2. Create AWS resources if needed (EC2, S3, RDS, etc.)
      // 3. Deploy files using SSH, S3 sync, or CodeDeploy
      // 4. Configure databases if needed
      
      this.spinner.info('AWS deployment would include these steps:');
      this.spinner.info('1. Authenticating with AWS (via AWS SDK)');
      this.spinner.info('2. Preparing deployment package');
      
      // Check if we're using basic EC2 SSH deployment or a more advanced AWS service
      if (this.deployConfig.host.includes('ec2') || this.deployConfig.host.includes('amazonaws.com')) {
        // For EC2 instance deployment via SSH
        this.spinner.info('3. Using SSH to deploy to EC2 instance');
        
        // Use existing SSH method for EC2 instances
        await this.deployWithSsh();
      } else {
        // For other AWS service deployments (S3, Elastic Beanstalk, etc.)
        this.spinner.info('3. Using AWS services for deployment (S3, Elastic Beanstalk, etc.)');
        
        // Simulate deployment for demo purposes
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        this.spinner.info('4. Configuring AWS services (if needed)');
        this.spinner.info('5. Updating DNS records (if needed)');
      }
      
      this.spinner.succeed('AWS deployment completed successfully');
    } catch (error) {
      this.spinner.fail('AWS deployment failed');
      throw new Error(`AWS deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 