import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonStub, stub } from 'sinon'

describe('unshare', () => {
  // Add debug statement
  console.log('Starting unshare tests');

  // Define a type for our mocked command instance
  type MockedUnshareInstance = {
    checkDockerEnvironment: SinonStub;
    checkNgrokRunning: SinonStub;
    docker: {
      checkDockerInstalled: SinonStub;
    };
    error: SinonStub;
    exit: SinonStub;
    findProjectRoot: SinonStub;
    findWordPressContainer: SinonStub;
    killNgrokProcesses: SinonStub;
    log: SinonStub;
    parse: SinonStub;
    restoreWordPressConfig: SinonStub;
    run: () => Promise<void>;
  };

  // Define type for ora spinner
  type MockSpinner = {
    fail: SinonStub;
    info: SinonStub;
    start: SinonStub;
    stop: SinonStub;
    succeed: SinonStub;
    text: string;
    warn: SinonStub;
  };
  
  // Define type for execa mock
  type MockExeca = SinonStub & {
    command: SinonStub;
  };
  
  // Mocked Command Class & Config
  let MockedUnshare: { new(argv: string[], config: Record<string, unknown>): MockedUnshareInstance };
  let mockConfig: Record<string, unknown>;
  let mockOra: MockSpinner;
  
  beforeEach(async () => {
    // Add debug statement
    console.log('Setting up mocks for unshare test');
    
    // Mock Config
    mockConfig = { 
        bin: 'wp-spin',
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    };
    
    // Mock ora spinner
    mockOra = {
      fail: stub().returnsThis(),
      info: stub().returnsThis(),
      start: stub().returnsThis(),
      stop: stub().returnsThis(),
      succeed: stub().returnsThis(),
      text: '',
      warn: stub().returnsThis()
    };
    
    // Create a prototype for BaseCommand with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      
      checkDockerEnvironment() {
        return Promise.resolve();
      }
      
      error(message: string) {
        throw new Error(message);
      }
      
      exit(code: number) {
        throw new Error(`EEXIT: ${code}`);
      }
      
      log(_message: string) {
        // Intentionally empty
      }
      
      parse() {
        return Promise.resolve({
          args: {},
          flags: {}
        });
      }
    }

    // Mock DockerService
    const MockDockerService = class {
      checkDockerInstalled() {
        return Promise.resolve(true);
      }
    };

    // Mock execa
    const mockExeca = stub().resolves({ stdout: 'success' }) as MockExeca;
    mockExeca.command = stub().resolves({ stdout: 'success' });

    // Mock chalk
    const mockChalk = {
      green: (text: string) => text,
      red: (text: string) => text,
      yellow: (text: string) => text
    };

    // Mock fs promises
    const mockFsPromises = {
      readFile: stub().resolves('mock file content'),
      writeFile: stub().resolves()
    };

    // Add debug statement before import
    console.log('About to import Unshare command with esmock');
    
    try {
      // Load Unshare command with mocks using esmock
      MockedUnshare = await esmock('../../src/commands/unshare.js', {
        '../../src/services/docker.js': {
          DockerService: MockDockerService
        },
        '@oclif/core': {
          Command: MockCommand,
          Config: class {},
          Flags: { 
            boolean: stub().returns({}),
            string: stub().returns({})
          }
        },
        'chalk': mockChalk,
        'execa': mockExeca,
        'node:fs/promises': mockFsPromises,
        'ora': () => mockOra
      });
      console.log('Successfully imported Unshare command');
    } catch (error) {
      console.error('Error importing Unshare command:', error);
    }
    
    process.env.NODE_ENV = 'test'
  });
  
  afterEach(() => {
    restore();
  });
  
  it('shows a message when no ngrok is running', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return no flags
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: false, force: false }
    });
    
    // Mock checkNgrokRunning to return false (no tunnels)
    cmd.checkNgrokRunning = stub().resolves(false);
    
    cmd.log = stub();
    
    await cmd.run();
    
    // Verify a message was displayed that no tunnels are running
    expect(cmd.checkNgrokRunning.called).to.be.true;
    expect(mockOra.info.called).to.be.true;
  });
  
  it('stops ngrok and restores WordPress config when running without force flag', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return no force flag
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: false, force: false }
    });
    
    // Mock function calls
    cmd.checkNgrokRunning = stub().resolves(true);
    cmd.findWordPressContainer = stub().resolves('wordpress_container');
    cmd.killNgrokProcesses = stub().resolves(true);
    cmd.restoreWordPressConfig = stub().resolves();
    cmd.log = stub();
    
    await cmd.run();
    
    // Verify all expected function calls
    expect(cmd.checkNgrokRunning.called).to.be.true;
    expect(cmd.findWordPressContainer.called).to.be.true;
    expect(cmd.killNgrokProcesses.called).to.be.true;
    expect(cmd.restoreWordPressConfig.called).to.be.true;
    expect(mockOra.succeed.called).to.be.true;
  });
  
  it('stops ngrok but skips WordPress config restoration with force flag', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return force flag
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: false, force: true }
    });
    
    // Mock function calls
    cmd.checkNgrokRunning = stub().resolves(true);
    cmd.findWordPressContainer = stub().resolves('wordpress_container');
    cmd.killNgrokProcesses = stub().resolves(true);
    cmd.restoreWordPressConfig = stub().resolves();
    cmd.log = stub();
    
    await cmd.run();
    
    // Verify WordPress config was not restored
    expect(cmd.checkNgrokRunning.called).to.be.true;
    expect(cmd.findWordPressContainer.called).to.be.false;
    expect(cmd.killNgrokProcesses.called).to.be.true;
    expect(cmd.restoreWordPressConfig.called).to.be.false;
    expect(mockOra.succeed.called).to.be.true;
  });
  
  it('handles failure to kill ngrok processes', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return no flags
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: false, force: false }
    });
    
    // Mock function calls
    cmd.checkNgrokRunning = stub().resolves(true);
    cmd.findWordPressContainer = stub().resolves('wordpress_container');
    cmd.killNgrokProcesses = stub().resolves(false); // Failed to kill
    cmd.error = stub().throws(new Error('Could not stop all ngrok processes'));
    cmd.log = stub();
    
    try {
      await cmd.run();
      expect.fail('Should have thrown an error');
    } catch (error) {
      const err = error as Error;
      expect(err.message).to.equal('Could not stop all ngrok processes');
      expect(mockOra.fail.called).to.be.true;
    }
  });
  
  it('handles errors when restoring WordPress config', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return debug flag
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: true, force: false }
    });
    
    // Mock function calls
    cmd.checkNgrokRunning = stub().resolves(true);
    cmd.findWordPressContainer = stub().resolves('wordpress_container');
    cmd.killNgrokProcesses = stub().resolves(true);
    cmd.restoreWordPressConfig = stub().rejects(new Error('Config restoration failed'));
    cmd.log = stub();
    
    await cmd.run();
    
    // Should still succeed but with a warning
    expect(mockOra.warn.called).to.be.true;
    expect(mockOra.succeed.called).to.be.true;
  });
  
  it('handles general errors during execution', async () => {
    const cmd = new MockedUnshare([], mockConfig) as MockedUnshareInstance;
    
    // Mock parse to return no flags
    cmd.parse = stub().resolves({
      args: {},
      flags: { debug: false, force: false }
    });
    
    // Mock function calls to throw an error
    cmd.checkNgrokRunning = stub().rejects(new Error('Network error'));
    cmd.error = stub().throws(new Error('Error: Network error'));
    
    try {
      await cmd.run();
      expect.fail('Should have thrown an error');
    } catch (error) {
      const err = error as Error;
      expect(err.message).to.equal('Error: Network error');
      expect(mockOra.fail.called).to.be.true;
    }
  });
}); 