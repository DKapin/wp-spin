import fs from 'fs-extra';
import * as os from 'node:os';
import { join } from 'node:path';

// Interface for site configuration
export interface SiteConfig {
  createdAt: string;
  name: string;
  path: string;
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
export function addSite(name: string, path: string): boolean {
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
    
    // Add the new site
    sites.push({
      createdAt: new Date().toISOString(),
      name,
      path,
    });
    
    // Write updated configuration while preserving existing data
    const configContent = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
    let config: ConfigFile = { sites: [] };
    try {
      config = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    config.sites = sites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(config, null, 2));
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
    let config: ConfigFile = { sites: [] };
    try {
      config = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    config.sites = sites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(config, null, 2));
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
    let config: ConfigFile = { sites: [] };
    try {
      config = JSON.parse(configContent) as ConfigFile;
    } catch {
      // If parsing fails, create a new config object
      // No need to use the error, just create a new object
    }
    
    config.sites = updatedSites;
    fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify(config, null, 2));
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
  return getSiteByAlias(name);
}

/**
 * Check if an alias is already in use
 * @param alias Alias to check
 * @returns The site using this alias, or undefined if not in use
 */
export function isAliasInUse(alias: string): SiteConfig | undefined {
  return getSiteByAlias(alias);
} 