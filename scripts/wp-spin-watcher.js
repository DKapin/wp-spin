#!/usr/bin/env node
// Alternative approach: File system watcher for wp-spin directories

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class WpSpinWatcher {
  constructor() {
    this.watchedDirs = new Map();
    this.loadWatchedDirs();
  }

  loadWatchedDirs() {
    try {
      const sitesFile = path.join(process.env.HOME, '.wp-spin', 'sites.json');
      if (fs.existsSync(sitesFile)) {
        const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
        sites.sites?.forEach(site => {
          this.watchDirectory(site.path);
        });
      }
    } catch (error) {
      console.warn('Could not load wp-spin sites:', error.message);
    }
  }

  watchDirectory(dirPath) {
    if (this.watchedDirs.has(dirPath) || !fs.existsSync(dirPath)) {
      return;
    }

    console.log(`👀 Watching wp-spin directory: ${dirPath}`);
    
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (eventType === 'rename' && !fs.existsSync(dirPath)) {
          console.log(`🗑️  Directory ${dirPath} was removed, cleaning up...`);
          this.cleanupProject(dirPath);
          watcher.close();
          this.watchedDirs.delete(dirPath);
        }
      });
      
      this.watchedDirs.set(dirPath, watcher);
    } catch (error) {
      console.warn(`Could not watch directory ${dirPath}:`, error.message);
    }
  }

  cleanupProject(projectPath) {
    const projectName = path.basename(projectPath);
    
    try {
      console.log('🐳 Stopping Docker containers...');
      execSync(`docker ps -q --filter "name=${projectName}" | xargs -r docker stop`, { stdio: 'pipe' });
      execSync(`docker ps -aq --filter "name=${projectName}" | xargs -r docker rm`, { stdio: 'pipe' });
      execSync(`docker volume ls -q --filter "name=${projectName}" | xargs -r docker volume rm`, { stdio: 'pipe' });
      
      console.log('📝 Updating wp-spin configuration...');
      this.removeFromSitesConfig(projectPath);
      
      console.log('✅ wp-spin project cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
    }
  }

  removeFromSitesConfig(projectPath) {
    try {
      const sitesFile = path.join(process.env.HOME, '.wp-spin', 'sites.json');
      if (fs.existsSync(sitesFile)) {
        const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
        sites.sites = sites.sites?.filter(site => site.path !== projectPath) || [];
        fs.writeFileSync(sitesFile, JSON.stringify(sites, null, 2));
      }
    } catch (error) {
      console.warn('Could not update sites config:', error.message);
    }
  }

  start() {
    console.log('🚀 wp-spin watcher started');
    console.log('Watching for directory removals to cleanup Docker containers...');
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping wp-spin watcher...');
      this.watchedDirs.forEach(watcher => watcher.close());
      process.exit(0);
    });
  }
}

if (require.main === module) {
  const watcher = new WpSpinWatcher();
  watcher.start();
}