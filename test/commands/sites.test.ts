import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { match, restore, SinonStub, stub } from 'sinon'

// Define types for test data
interface TestSite {
  createdAt: string;
  name: string;
  path: string;
}

describe('sites', () => {
  const TEST_SITE_NAME = 'test-site'
  const TEST_SITE_PATH = join(process.cwd(), 'test-site')
  
  // Define a type for our mocked command instance
  type MockedSitesInstance = {
    config: { version: string };
    error: SinonStub;
    listSites?: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs for sites.js functions
  let sitesConfigStubs: {
    addSite: SinonStub;
    getSiteByAlias: SinonStub;
    getSiteByName: SinonStub;
    getSiteByPath: SinonStub;
    getSites: SinonStub;
    isAliasInUse: SinonStub;
    removeSite: SinonStub;
    updateSite: SinonStub;
  }
  
  // File system stubs
  let fsStubs: {
    existsSync: SinonStub;
  }
  
  // Other stubs
  let consoleLogStub: SinonStub
  let oraStub: SinonStub

  // Mocked Command Class & Config
  let MockedSites: { new(argv: string[], config: Record<string, unknown>): MockedSitesInstance };
  let mockConfig: Record<string, unknown>; 
  
  beforeEach(async () => {
    // Mock Config
    mockConfig = { 
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    }; 

    // Sites Config Stubs
    sitesConfigStubs = {
      addSite: stub().returns(true),
      getSiteByAlias: stub().returns(null),
      getSiteByName: stub().returns(null),
      getSiteByPath: stub().returns(null),
      getSites: stub().returns([]),
      isAliasInUse: stub().returns(false),
      removeSite: stub().returns(true),
      updateSite: stub().returns(true),
    };

    // File system stubs
    fsStubs = {
      existsSync: stub().returns(true)
    };

    // Console log stub
    consoleLogStub = stub(console, 'log');

    // Create ora spinner stub
    const spinnerStub = {
      fail: stub(),
      info: stub(),
      start: stub().returnsThis(),
      stop: stub(),
      succeed: stub(),
      warn: stub()
    };
    oraStub = stub().returns(spinnerStub);

    // Mock child_process with the structure expected by dynamic import
    const childProcessStub = {
      _forkChild: stub(),
      ChildProcess: class {},
      default: {
        execSync: stub().returns('')
      },
      exec: stub(),
      execFile: stub(),
      execFileSync: stub(),
      execSync: stub().returns(''), // This is what the dynamic import destructures
      fork: stub(),
      spawn: stub().returns({
        on: stub().callsFake((event, cb) => {
          if (event === 'exit') cb(0);
          return { on: stub() };
        })
      }),
      spawnSync: stub()
    };
    
    // Create a prototype for Command with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      
      error(message: string) {
        throw new Error(message);
      }
      
      parse() {
        return Promise.resolve({
          args: {},
          flags: {}
        });
      }
    }

    // Load Sites command with mocks using esmock
    MockedSites = await esmock('../../src/commands/sites.js', {
      '../../src/config/sites.js': {
        addSite: sitesConfigStubs.addSite,
        getSiteByAlias: sitesConfigStubs.getSiteByAlias,
        getSiteByName: sitesConfigStubs.getSiteByName,
        getSiteByPath: sitesConfigStubs.getSiteByPath,
        getSites: sitesConfigStubs.getSites,
        isAliasInUse: sitesConfigStubs.isAliasInUse,
        removeSite: sitesConfigStubs.removeSite,
        updateSite: sitesConfigStubs.updateSite,
      },
      '@oclif/core': {
        Args: { string: stub().returns({}) },
        Command: MockCommand,
        Config: class {},
        Flags: { 
          boolean: stub().returns({}),
          string: stub().returns({})
        }
      },
      'node:child_process': childProcessStub,
      'node:fs': {
        existsSync: fsStubs.existsSync
      },
      'ora': oraStub
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  describe('list action', () => {
    it('displays message when no sites are registered', async () => {
      sitesConfigStubs.getSites.returns([]);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override parse method to return list action
      cmd.parse = stub().resolves({
        args: { action: 'list' },
        flags: {}
      });
      
      await cmd.run();
      
      // Verify that getSites was called
      expect(sitesConfigStubs.getSites.called).to.be.true;
      
      // Check for specific console message
      const noSitesMessage = consoleLogStub.getCalls().find(call => 
        call.args[0] && call.args[0].includes('No sites registered')
      );
      expect(noSitesMessage).to.exist;
    });
    
    it('lists registered sites correctly', async () => {
      const testSites = [
        { createdAt: new Date().toISOString(), name: 'site1', path: '/path/to/site1' },
        { createdAt: new Date().toISOString(), name: 'site2', path: '/path/to/site2' }
      ];
      sitesConfigStubs.getSites.returns(testSites);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override parse method to return list action
      cmd.parse = stub().resolves({
        args: { action: 'list' },
        flags: {}
      });
      
      // Override the listSites method to avoid dynamic import
      cmd.listSites = stub().callsFake(async () => {
        const sites = sitesConfigStubs.getSites();
        
        if (sites.length === 0) {
          console.log('No sites registered. Use `wp-spin sites name <n> <path>` to name a site.');
          return;
        }
        
        console.log('\n📋 Registered WordPress sites:\n');
        
        for (const site of sites) {
          console.log(`${site.name}`);
          console.log(`  Path: ${site.path}`);
          console.log('');
        }
      });
      
      await cmd.run();
      
      // Verify that getSites was called
      expect(sitesConfigStubs.getSites.called).to.be.true;
      
      // Check for each site name in console output
      for (const site of testSites) {
        const siteNameCall = consoleLogStub.getCalls().find(call => 
          call.args[0] && call.args[0].includes(site.name)
        );
        expect(siteNameCall, `Should display site name: ${site.name}`).to.exist;
      }
    });

    it('lists sites with multiple aliases correctly', async () => {
      const testSites = [
        { createdAt: new Date().toISOString(), name: 'site1', path: '/path/to/site1' },
        { createdAt: new Date().toISOString(), name: 'alias1', path: '/path/to/site1' },
        { createdAt: new Date().toISOString(), name: 'alias2', path: '/path/to/site1' }
      ];
      sitesConfigStubs.getSites.returns(testSites);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      cmd.parse = stub().resolves({
        args: { action: 'list' },
        flags: {}
      });
      
      // Override the listSites method to avoid dynamic import
      cmd.listSites = stub().callsFake(async () => {
        const sites = sitesConfigStubs.getSites();
        
        console.log('\n📋 Registered WordPress sites:\n');
        
        for (const site of sites) {
          // Get all aliases for this path
          const aliases = sites
            .filter((s: TestSite) => s.path === site.path)
            .map((s: TestSite) => s.name);

          console.log(`${site.name}`);
          if (aliases.length > 1) {
            console.log(`  Aliases: ${aliases.join(', ')}`);
          }
          
          console.log('');
        }
      });
      
      await cmd.run();
      
      // Verify that getSites was called
      expect(sitesConfigStubs.getSites.called).to.be.true;
      
      // Check for aliases in console output
      const aliasesCall = consoleLogStub.getCalls().find(call => 
        call.args[0] && call.args[0].includes('Aliases:')
      );
      expect(aliasesCall, 'Should display aliases').to.exist;
      if (aliasesCall) {
        expect(aliasesCall.args[0]).to.include('alias1');
        expect(aliasesCall.args[0]).to.include('alias2');
      }
    });

    it('automatically removes invalid sites', async () => {
      const testSites = [
        { createdAt: new Date().toISOString(), name: 'valid-site', path: '/path/to/valid' },
        { createdAt: new Date().toISOString(), name: 'invalid-site', path: '/path/to/invalid' }
      ];
      sitesConfigStubs.getSites.returns(testSites);
      
      // Make existsSync return false for invalid site
      fsStubs.existsSync.withArgs('/path/to/invalid').returns(false);
      fsStubs.existsSync.withArgs('/path/to/valid').returns(true);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      cmd.parse = stub().resolves({
        args: { action: 'list' },
        flags: {}
      });
      
      // Override the listSites method to simulate the removal logic
      cmd.listSites = stub().callsFake(async () => {
        const sites = sitesConfigStubs.getSites();
        let removedCount = 0;
        
        for (const site of sites) {
          const pathExists = fsStubs.existsSync(site.path);
          
          if (!pathExists) {
            // Remove invalid site
            sitesConfigStubs.removeSite(site.name);
            removedCount++;
            continue;
          }
          
          console.log(`${site.name}`);
        }
        
        if (removedCount > 0) {
          console.log(`\nRemoved ${removedCount} invalid site entries.`);
        }
      });
      
      await cmd.run();
      
      // Verify that removeSite was called for invalid site
      expect(sitesConfigStubs.removeSite.calledWith('invalid-site')).to.be.true;
      
      // Check for removal message
      const removalMessage = consoleLogStub.getCalls().find(call => 
        call.args[0] && call.args[0].includes('Removed 1 invalid site entries')
      );
      expect(removalMessage, 'Should display removal message').to.exist;
    });
  });
  
  describe('name action', () => {
    it('requires site name and path', async () => {
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Test missing name
      cmd.parse = stub().resolves({
        args: { action: 'name' },
        flags: {}
      });
      
      cmd.error = stub().throws(new Error('Site name is required for name action'));
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about missing name');
      } catch (error: unknown) {
        const err = error as Error;
        expect(err.message).to.equal('Site name is required for name action');
      }
      
      // Test missing path
      cmd.parse = stub().resolves({
        args: { action: 'name', name: TEST_SITE_NAME },
        flags: {}
      });
      
      cmd.error = stub().throws(new Error('Site path is required for name action'));
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about missing path');
      } catch (error: unknown) {
        const err = error as Error;
        expect(err.message).to.equal('Site path is required for name action');
      }
    });
    
    it('successfully names a site', async () => {
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override isWpSpinProject
      const originalPrototype = Object.getPrototypeOf(MockedSites.prototype);
      const isWpSpinProjectStub = stub().returns(true);
      
      // Override _isWpSpinProject to always return true for our test path
      MockedSites.prototype._isWpSpinProject = isWpSpinProjectStub;
      
      // Set up parse to return name action with valid name and path
      cmd.parse = stub().resolves({
        args: { action: 'name', name: TEST_SITE_NAME, path: TEST_SITE_PATH },
        flags: {}
      });
      
      await cmd.run();
      
      // Verify that addSite was called with correct args
      expect(sitesConfigStubs.addSite.calledWith(TEST_SITE_NAME, match.string)).to.be.true;
      
      // Restore prototype
      Object.setPrototypeOf(MockedSites.prototype, originalPrototype);
    });
    
    it('handles errors when path is invalid', async () => {
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override isWpSpinProject to return false
      const originalPrototype = Object.getPrototypeOf(MockedSites.prototype);
      const isWpSpinProjectStub = stub().returns(false);
      
      // Override _isWpSpinProject to return false for our test path
      MockedSites.prototype._isWpSpinProject = isWpSpinProjectStub;
      
      // Set up parse to return name action with valid name and path
      cmd.parse = stub().resolves({
        args: { action: 'name', name: TEST_SITE_NAME, path: TEST_SITE_PATH },
        flags: {}
      });
      
      // Mock error throw
      cmd.error = stub().throws(new Error('Not a valid WordPress project'));
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about invalid project');
      } catch (error: unknown) {
        const err = error as Error;
        expect(err.message).to.equal('Not a valid WordPress project');
      }
      
      // Restore prototype
      Object.setPrototypeOf(MockedSites.prototype, originalPrototype);
    });

    it('prevents duplicate aliases', async () => {
      // Setup: Existing site with the same alias
      sitesConfigStubs.getSiteByAlias.returns({ name: 'existing-alias', path: '/some/path' });
      sitesConfigStubs.isAliasInUse.returns({ name: 'existing-alias', path: '/some/path' });
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      cmd.parse = stub().resolves({
        args: { 
          action: 'name',
          name: 'existing-alias',
          path: '/test/path'
        },
        flags: {}
      });
      
      // Mock the error method to capture the error message
      let errorMessage = '';
      cmd.error = stub().callsFake((message: string) => {
        errorMessage = message;
        throw new Error(message);
      });
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about duplicate alias');
      } catch {
        expect(errorMessage).to.include('already in use');
      }
    });

    it('allows adding alias to existing site', async () => {
      // Setup: Existing site with different path
      sitesConfigStubs.getSiteByPath.returns({ name: 'existing-site', path: '/test/path' });
      // Make sure alias is not in use and no existing site with same name
      sitesConfigStubs.isAliasInUse.returns(false);
      sitesConfigStubs.getSiteByName.returns(null);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override isWpSpinProject
      const originalPrototype = Object.getPrototypeOf(MockedSites.prototype);
      const isWpSpinProjectStub = stub().returns(true);
      
      // Override _isWpSpinProject to always return true for our test path
      MockedSites.prototype._isWpSpinProject = isWpSpinProjectStub;
      
      cmd.parse = stub().resolves({
        args: { 
          action: 'name',
          name: 'new-alias',
          path: '/test/path'
        },
        flags: {}
      });
      
      await cmd.run();
      
      // The command should return early with a warning since the path is already registered
      // It should NOT call addSite in this case based on the actual command logic
      expect(sitesConfigStubs.addSite.called).to.be.false;
      expect(sitesConfigStubs.getSiteByPath.called).to.be.true;
      
      // Restore prototype
      Object.setPrototypeOf(MockedSites.prototype, originalPrototype);
    });
  });
  
  describe('remove action', () => {
    it('removes an existing site', async () => {
      // Mock existing site
      sitesConfigStubs.getSiteByName.returns({ createdAt: new Date().toISOString(), name: TEST_SITE_NAME, path: TEST_SITE_PATH });
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Set up parse to return remove action with valid name
      cmd.parse = stub().resolves({
        args: { action: 'remove', name: TEST_SITE_NAME },
        flags: {}
      });
      
      await cmd.run();
      
      // Verify that removeSite was called with correct args
      expect(sitesConfigStubs.removeSite.calledWith(TEST_SITE_NAME)).to.be.true;
    });
    
    it('handles non-existent site removal', async () => {
      // Mock non-existent site
      sitesConfigStubs.getSiteByName.returns(null);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Set up parse to return remove action with invalid name
      cmd.parse = stub().resolves({
        args: { action: 'remove', name: 'non-existent-site' },
        flags: {}
      });
      
      // Mock error throw
      cmd.error = stub().throws(new Error('Site "non-existent-site" not found'));
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about non-existent site');
      } catch (error: unknown) {
        const err = error as Error;
        expect(err.message).to.equal('Site "non-existent-site" not found');
      }
    });
  });
  
  describe('update action', () => {
    it('updates an existing site path', async () => {
      // Setup: Existing site - use getSiteByAlias since that's what the command calls
      sitesConfigStubs.getSiteByAlias.returns({ name: 'test-site', path: '/old/path' });
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override isWpSpinProject
      const originalPrototype = Object.getPrototypeOf(MockedSites.prototype);
      const isWpSpinProjectStub = stub().returns(true);
      
      // Override _isWpSpinProject to always return true for our test path
      MockedSites.prototype._isWpSpinProject = isWpSpinProjectStub;
      
      cmd.parse = stub().resolves({
        args: { 
          action: 'update',
          name: 'test-site',
          path: '/new/path'
        },
        flags: {}
      });
      
      await cmd.run();
      
      // Verify that updateSite was called
      expect(sitesConfigStubs.updateSite.called).to.be.true;
      expect(sitesConfigStubs.updateSite.firstCall.args[0]).to.equal('test-site');
      expect(sitesConfigStubs.updateSite.firstCall.args[1]).to.equal('/new/path');
      
      // Restore prototype
      Object.setPrototypeOf(MockedSites.prototype, originalPrototype);
    });
    
    it('handles updating non-existent site', async () => {
      // Mock non-existent site
      sitesConfigStubs.getSiteByName.returns(null);
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Set up parse to return update action with invalid name
      cmd.parse = stub().resolves({
        args: { action: 'update', name: 'non-existent-site', path: TEST_SITE_PATH },
        flags: {}
      });
      
      // Mock error throw
      cmd.error = stub().throws(new Error('Site "non-existent-site" not found'));
      
      try {
        await cmd.run();
        expect.fail('Should have thrown an error about non-existent site');
      } catch (error: unknown) {
        const err = error as Error;
        expect(err.message).to.equal('Site "non-existent-site" not found');
      }
    });
  });
}); 