import fs from 'fs-extra';
import * as os from 'node:os';
import { join } from 'node:path';

/**
 * Bootstrap function that runs when the package is installed
 * Ensures configuration files are preserved across installations
 */
function bootstrap(): void {
  try {
    const configDir = join(os.homedir(), '.wp-spin');
    const sitesConfigPath = join(configDir, 'sites.json');
    
    // Log what we're doing
    console.log('WP-Spin: Checking for existing configuration...');
    
    // If the sites configuration file already exists, don't touch it
    if (fs.existsSync(sitesConfigPath)) {
      console.log(`WP-Spin: Found existing sites configuration at ${sitesConfigPath}`);
      console.log('WP-Spin: Preserving existing site configuration');
      
      // Validate that it's proper JSON
      try {
        const content = fs.readFileSync(sitesConfigPath, 'utf8');
        const config = JSON.parse(content);
        
        // Ensure the sites array exists
        if (!config.sites) {
          console.log('WP-Spin: Adding missing sites array to existing configuration');
          config.sites = [];
          fs.writeFileSync(sitesConfigPath, JSON.stringify(config, null, 2));
        }
        
        console.log('WP-Spin: Configuration looks valid');
      } catch (error) {
        console.warn(`WP-Spin: Error parsing existing configuration: ${error}`);
        
        // Create a backup of the corrupted file
        const backupPath = `${sitesConfigPath}.backup-${Date.now()}`;
        console.log(`WP-Spin: Creating backup at ${backupPath}`);
        fs.copyFileSync(sitesConfigPath, backupPath);
        
        // Don't overwrite the file - let the site configuration module handle it
        console.log('WP-Spin: Will leave site configuration as-is');
      }
    } else {
      // If the config directory doesn't exist, create it
      if (!fs.existsSync(configDir)) {
        console.log(`WP-Spin: Creating configuration directory at ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // If this is a fresh installation, create the sites config file
      console.log(`WP-Spin: Creating new sites configuration at ${sitesConfigPath}`);
      fs.writeFileSync(sitesConfigPath, JSON.stringify({ sites: [] }, null, 2));
    }
    
    console.log('WP-Spin: Bootstrap completed successfully');
  } catch (error) {
    console.error(`WP-Spin: Bootstrap error: ${error}`);
  }
}

// Auto-run the bootstrap function if this file is executed directly
// Check if we're the main module using import.meta in ESM
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  bootstrap();
}

export default bootstrap; 