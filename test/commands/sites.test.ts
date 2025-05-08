import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { match, restore, SinonStub, stub } from 'sinon'

describe('sites', () => {
  const TEST_SITE_NAME = 'test-site'
  const TEST_SITE_PATH = join(process.cwd(), 'test-site')
  
  // Define a type for our mocked command instance
  type MockedSitesInstance = {
    config: { version: string };
    error: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs for sites.js functions
  let sitesConfigStubs: {
    addSite: SinonStub;
    getSiteByName: SinonStub;
    getSiteByPath: SinonStub;
    getSites: SinonStub;
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
      getSiteByName: stub().returns(null),
      getSiteByPath: stub().returns(null),
      getSites: stub().returns([]),
      removeSite: stub().returns(true),
      updateSite: stub().returns(true)
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
      succeed: stub(),
      warn: stub()
    };
    oraStub = stub().returns(spinnerStub);

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
      '../../src/config/sites.js': sitesConfigStubs,
      '@oclif/core': {
        Args: { string: stub().returns({}) },
        Command: MockCommand,
        Config: class {},
        Flags: { 
          boolean: stub().returns({}),
          string: stub().returns({})
        }
      },
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
      // Mock existing site
      sitesConfigStubs.getSiteByName.returns({ createdAt: new Date().toISOString(), name: TEST_SITE_NAME, path: TEST_SITE_PATH });
      
      const cmd = new MockedSites([], mockConfig) as MockedSitesInstance;
      
      // Override isWpSpinProject
      const originalPrototype = Object.getPrototypeOf(MockedSites.prototype);
      const isWpSpinProjectStub = stub().returns(true);
      
      // Override _isWpSpinProject to always return true for our test path
      MockedSites.prototype._isWpSpinProject = isWpSpinProjectStub;
      
      const newPath = join(process.cwd(), 'new-path');
      
      // Set up parse to return update action with valid name and path
      cmd.parse = stub().resolves({
        args: { action: 'update', name: TEST_SITE_NAME, path: newPath },
        flags: {}
      });
      
      await cmd.run();
      
      // Verify that updateSite was called with correct args
      expect(sitesConfigStubs.updateSite.calledWith(TEST_SITE_NAME, match.string)).to.be.true;
      
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