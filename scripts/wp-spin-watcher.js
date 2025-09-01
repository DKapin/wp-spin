#!/usr/bin/env node
// Alternative approach: File system watcher for wp-spin directories (ESM)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

class WpSpinWatcher {
  constructor() {
    this.watchedDirs = new Map();
    this.loadWatchedDirs();
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

  loadWatchedDirs() {
    try {
      const sitesFile = path.join(os.homedir(), '.wp-spin', 'sites.json');
      if (fs.existsSync(sitesFile)) {
        const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
        if (sites.sites) {
          for (const site of sites.sites) this.watchDirectory(site.path);
        }
      }
    } catch (error) {
      console.warn('Could not load wp-spin sites:', error.message);
    }
  }

  removeFromSitesConfig(projectPath) {
    try {
      const sitesFile = path.join(os.homedir(), '.wp-spin', 'sites.json');
      if (fs.existsSync(sitesFile)) {
        const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
        sites.sites = sites.sites?.filter(site => site.path !== projectPath) ?? [];
        fs.writeFileSync(sitesFile, JSON.stringify(sites, null, 2));
      }
    } catch (error) {
      console.warn('Could not update sites config:', error.message);
    }
  }

  start() {
    console.log('🚀 wp-spin watcher started');
    console.log('Watching for directory removals to cleanup Docker containers...');

    // Graceful shutdown without process.exit (satisfies n/no-process-exit)
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping wp-spin watcher...');
      for (const watcher of this.watchedDirs.values()) watcher.close();
      this.watchedDirs.clear();
      // Let the event loop drain naturally.
    });
  }

  watchDirectory(dirPath) {
    if (this.watchedDirs.has(dirPath) || !fs.existsSync(dirPath)) return;

    console.log(`👀 Watching wp-spin directory: ${dirPath}`);

    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, _filename) => {
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
}

// ESM-safe "executed directly" check (replaces require.main === module)
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  new WpSpinWatcher().start();
}
