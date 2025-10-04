import fs from 'fs-extra';
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { join } from 'node:path';

// Interface for site configuration
export interface SiteConfig {
  createdAt: string;
  domain?: string;
  // Enhanced configuration (optional for backwards compatibility)
  mailhog?: boolean;
  multisite?: boolean;

  multisiteType?: 'path' | 'subdomain';
  name: string;
  path: string;
  phpVersion?: string;
  port?: number;
  ssl?: boolean;
  wordpressVersion?: string;
  xdebug?: boolean;
}

// Interface for the configuration file
interface ConfigFile {
  [key: string]: unknown;
  sites: SiteConfig[];
}

// Path to the sites configuration file
const SITES_CONFIG_PATH = join(os.homedir(), '.wp-spin', 'sites.json');

/**
 * Initialize the sites configuration file if it doesn't exist
 * This will preserve existing data and never overwrite it with an empty configuration
 */
export function initSitesConfig(): void {
  try {
    const configDir = join(os.homedir(), '.wp-spin');
    
    // Create the .wp-spin directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Check if sites.json file exists and create it if needed
    if (fs.existsSync(SITES_CONFIG_PATH)) {
      // Validate the existing file to ensure it's proper JSON
      try {
        const content = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
        const config = JSON.parse(content) as ConfigFile;
        
        // Ensure the sites array exists
        if (!config.sites) {
          // If it doesn't have a sites property, we'll add an empty one but preserve other data
          config.sites = [];
          fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(config, null, 2));
        }
      } catch (parseError) {
        console.error(`Error parsing existing sites.json, creating backup and fixing: ${parseError}`);
        
        // Create a backup of the corrupted file
        const backupPath = `${SITES_CONFIG_PATH}.backup-${Date.now()}`;
        fs.copyFileSync(SITES_CONFIG_PATH, backupPath);
        
        // Write a new valid but empty configuration
        fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify({ sites: [] }, null, 2));
      }
    } else {
      // Create new sites.json file if it doesn't exist
      console.log(`Creating new sites configuration at ${SITES_CONFIG_PATH}`);
      fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify({ sites: [] }, null, 2));
    }
  } catch (error) {
    console.error('Error initializing sites configuration:', error);
  }
}

/**
 * Get all registered sites from the configuration
 * @returns Array of site configurations
 */
export function getSites(): SiteConfig[] {
  try {
    initSitesConfig();
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent) as ConfigFile;
    return config.sites || [];
  } catch (error) {
    console.error('Error reading sites configuration:', error);
    return [];
  }
}

/**
 * Check if a site with the given path already exists
 * @param path Path to check
 * @returns The site config if found, undefined otherwise
 */
export function getSiteByPath(path: string): SiteConfig | undefined {
  try {
    const sites = getSites();
    return sites.find(site => site.path === path);
  } catch (error) {
    console.error('Error getting site by path:', error);
    return undefined;
  }
}

/**
 * Add a new site to the configuration
 * @param name Site name/tag
 * @param path Absolute path to the site directory
 * @returns true if successful, false otherwise
 */
export function addSite(name: string, path: string, config?: Partial<SiteConfig>): boolean {
  try {
    initSitesConfig();
    
    // Read existing configuration
    const sites = getSites();
    
    // Check if site name already exists
    const existingByName = sites.find(site => site.name === name);
    if (existingByName) {
      return false;
    }
    
    // Check if path already exists with a different name
    const existingByPath = sites.find(site => site.path === path);
    if (existingByPath) {
      console.warn(`This site path is already registered with name: ${existingByPath.name}`);
      // Don't allow registering the same path with multiple names
      return false;
    }
    
    // Add the new site with configuration
    sites.push({
      createdAt: new Date().toISOString(),
      name,
      path,
      ...config, // Merge in any provided configuration
    });
    
    // Write updated configuration while preserving existing data
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    let fileConfig: ConfigFile = { sites: [] };
    try {
      fileConfig = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    fileConfig.sites = sites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(fileConfig, null, 2));
    return true;
  } catch (error) {
    console.error('Error adding site to configuration:', error);
    return false;
  }
}

/**
 * Update an existing site in the configuration
 * @param name Site name/tag
 * @param path New path for the site
 * @returns true if successful, false otherwise
 */
export function updateSite(name: string, path: string): boolean {
  try {
    initSitesConfig();
    
    // Read existing configuration
    const sites = getSites();
    
    // Find the site to update
    const siteIndex = sites.findIndex(site => site.name === name);
    if (siteIndex === -1) {
      return false;
    }
    
    // Check if path already exists with a different name
    const existingByPath = sites.find(site => site.path === path && site.name !== name);
    if (existingByPath) {
      console.warn(`This site path is already registered with name: ${existingByPath.name}`);
      // Don't allow registering the same path with multiple names
      return false;
    }
    
    // Update the site
    sites[siteIndex] = {
      ...sites[siteIndex],
      path,
    };
    
    // Write updated configuration while preserving existing data
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    let fileConfig: ConfigFile = { sites: [] };
    try {
      fileConfig = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    fileConfig.sites = sites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(fileConfig, null, 2));
    return true;
  } catch (error) {
    console.error('Error updating site in configuration:', error);
    return false;
  }
}

/**
 * Remove a site from the configuration
 * @param name Site name/tag
 * @returns true if successful, false otherwise
 */
export function removeSite(name: string): boolean {
  try {
    initSitesConfig();
    
    // Read existing configuration
    const sites = getSites();
    
    // Find the site to remove
    const siteToRemove = sites.find(site => site.name === name);
    if (!siteToRemove) {
      return false;
    }
    
    // Filter out the site to remove
    const updatedSites = sites.filter(site => site.name !== name);
    
    // Write updated configuration while preserving existing data
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    let fileConfig: ConfigFile = { sites: [] };
    try {
      fileConfig = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    fileConfig.sites = updatedSites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(fileConfig, null, 2));
    return true;
  } catch (error) {
    console.error('Error removing site from configuration:', error);
    return false;
  }
}

/**
 * Get a site by any of its aliases (including the name)
 * @param alias Site name or any alias
 * @returns Site configuration or undefined if not found
 */
export function getSiteByAlias(alias: string): SiteConfig | undefined {
  try {
    initSitesConfig();
    const sites = getSites();
    
    // First try exact name match
    const site = sites.find(site => site.name === alias);
    if (site) {
      return site;
    }
    
    // If not found, check if it's an alias for any site
    const siteWithAlias = sites.find(site => {
      // Get all aliases for this path
      const aliases = sites
        .filter(s => s.path === site.path)
        .map(s => s.name);
      return aliases.includes(alias);
    });
    
    return siteWithAlias;
  } catch (error) {
    console.error('Error getting site by alias:', error);
    return undefined;
  }
}

/**
 * Get a site by name from the configuration
 * @param name Site name/tag
 * @returns Site configuration or undefined if not found
 */
export function getSiteByName(name: string): SiteConfig | undefined {
  const sites = getSites();
  return sites.find(site => site.name === name);
}

/**
 * Check if an alias is already in use
 * @param alias Alias to check
 * @returns The site using this alias, or undefined if not in use
 */
export function isAliasInUse(alias: string): SiteConfig | undefined {
  return getSiteByAlias(alias);
}

/**
 * Detect and migrate site configuration from fallback sources
 * @param sitePath Path to the site directory
 * @returns Enhanced site configuration from fallback detection
 */
export function detectAndMigrateSiteConfig(sitePath: string): Partial<SiteConfig> {
  const detected: Partial<SiteConfig> = {};

  try {
    // Detect domain from docker-compose.yml (multisite)
    const dockerComposePath = join(sitePath, 'docker-compose.yml');
    if (fs.existsSync(dockerComposePath)) {
      const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');

      // Check for multisite configuration
      if (dockerComposeContent.includes('DOMAIN_CURRENT_SITE')) {
        detected.multisite = true;

        // Extract domain
        const domainMatch = dockerComposeContent.match(/DOMAIN_CURRENT_SITE',\s*'([^']+)'/);
        if (domainMatch && domainMatch[1]) {
          detected.domain = domainMatch[1];
        }

        // Extract multisite type
        detected.multisiteType = dockerComposeContent.includes('SUBDOMAIN_INSTALL') ? 'subdomain' : 'path';
      }

      // Check for other features
      detected.mailhog = dockerComposeContent.includes('mailhog');
      detected.xdebug = dockerComposeContent.includes('xdebug') || dockerComposeContent.includes('XDEBUG_MODE');

      // Extract port mapping
      const portMatch = dockerComposeContent.match(/"(\d+):80"/);
      if (portMatch && portMatch[1]) {
        detected.port = Number.parseInt(portMatch[1], 10);
      }
    }

    // If no domain from docker-compose.yml, try WordPress database
    if (!detected.domain) {
      try {
        const projectName = sitePath.split('/').pop() || 'unknown';
        const siteurl = execSync(`docker exec ${projectName}-wordpress-1 wp --allow-root option get siteurl 2>/dev/null`, { encoding: 'utf8' }).trim();

        if (siteurl && !siteurl.includes('localhost')) {
          // Extract domain from URL
          const urlMatch = siteurl.match(/https?:\/\/([^/]+)/);
          if (urlMatch && urlMatch[1] && !urlMatch[1].includes(':')) {
            detected.domain = urlMatch[1];
            detected.ssl = siteurl.startsWith('https://');
          }
        }
      } catch {
        // WordPress not running or accessible, skip database detection
      }
    }

    // Check for SSL certificates
    if (detected.domain && !detected.ssl) {
      const certsDir = join(os.homedir(), '.wp-spin', 'nginx-proxy', 'certs');
      const certPath = join(certsDir, `${detected.domain}.pem`);
      detected.ssl = fs.existsSync(certPath);
    }

  } catch (error) {
    // If detection fails, return empty object
    console.warn(`Warning: Could not detect configuration for site at ${sitePath}: ${error}`);
  }

  return detected;
}

/**
 * Update a site's configuration with detected settings and save to sites.json
 * @param siteName Site name/alias
 * @param detectedConfig Detected configuration to merge
 * @returns Whether the update was successful
 */
export function updateSiteConfigWithDetected(siteName: string, detectedConfig: Partial<SiteConfig>): boolean {
  try {
    const sites = getSites();
    const siteIndex = sites.findIndex(site => site.name === siteName);

    if (siteIndex === -1) {
      return false;
    }

    // Merge detected config with existing config (only fill in missing values)
    const currentSite = sites[siteIndex];
    const updatedSite: SiteConfig = {
      ...currentSite,
      // Only update fields that are currently undefined/missing
      domain: currentSite.domain || detectedConfig.domain,
      mailhog: currentSite.mailhog === undefined ? detectedConfig.mailhog : currentSite.mailhog,
      multisite: currentSite.multisite === undefined ? detectedConfig.multisite : currentSite.multisite,
      multisiteType: currentSite.multisiteType || detectedConfig.multisiteType,
      port: currentSite.port || detectedConfig.port,
      ssl: currentSite.ssl === undefined ? detectedConfig.ssl : currentSite.ssl,
      xdebug: currentSite.xdebug === undefined ? detectedConfig.xdebug : currentSite.xdebug,
    };

    sites[siteIndex] = updatedSite;

    // Save updated configuration
    initSitesConfig();
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    const fileConfig = JSON.parse(configContent) as ConfigFile;
    fileConfig.sites = sites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(fileConfig, null, 2));

    return true;
  } catch (error) {
    console.warn(`Warning: Could not update site configuration: ${error}`);
    return false;
  }
} 