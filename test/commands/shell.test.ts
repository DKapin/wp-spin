import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { restore, SinonStub, stub } from 'sinon'

describe('shell', () => {
  const TEST_PROJECT_NAME = 'test-project'
  const TEST_PROJECT_PATH = join(process.cwd(), TEST_PROJECT_NAME)
  
  // Define a type for our mocked command instance
  type MockedShellInstance = {
    config: { version: string };
    error: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs
  let dockerServiceStub: Record<string, SinonStub>
  let existsSyncStub: SinonStub

  // Mocked Command Class & Config
  let MockedShell: { new(argv: string[], config: Record<string, unknown>): MockedShellInstance };
  let mockConfig: Record<string, unknown>; 
  
  beforeEach(async () => {
    // Mock Config
    mockConfig = { 
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    }; 

    // Docker Service Stub
    dockerServiceStub = {
      checkDockerComposeInstalled: stub().resolves(),
      checkDockerInstalled: stub().resolves(),
      checkDockerRunning: stub().resolves(),
      getProjectPath: stub().returns(TEST_PROJECT_PATH),
      shell: stub().resolves()
    };

    // Filesystem Stubs
    existsSyncStub = stub().returns(true); // By default, project exists

    // Create a DockerService constructor stub that returns our dockerServiceStub
    const DockerServiceStub = stub().returns(dockerServiceStub);

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

    // Load Shell command with mocks using esmock
    MockedShell = await esmock('../../src/commands/shell.js', {
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
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
      'node:child_process': {
        spawn: stub().returns({
          on: stub().callsFake((event, cb) => {
            if (event === 'exit') cb(0);
            return { on: stub() };
          })
        })
      },
      'node:fs': {
        existsSync: existsSyncStub
      },

      'ora': () => ({
        fail: stub(),
        info: stub(),
        start: stub().returns({ 
          fail: stub(),
          info: stub(),
          stop: stub(),
          succeed: stub(), 
          warn: stub() 
        }),
        stop: stub(),
        succeed: stub(),
        warn: stub()
      })
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  it('runs shell cmd successfully', async () => {
    const cmd = new MockedShell([], mockConfig) as MockedShellInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Mock run method to ensure stubs are called before exit
    const originalRun = cmd.run;
    cmd.run = stub().callsFake(async () => {
      try {
        // Call the original run method
        await originalRun.call(cmd);
        
        // Verify that shell was called
        expect(dockerServiceStub.shell.called).to.be.true;
        expect(dockerServiceStub.checkDockerInstalled.called).to.be.true;
        expect(dockerServiceStub.checkDockerRunning.called).to.be.true;
        expect(dockerServiceStub.checkDockerComposeInstalled.called).to.be.true;
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).to.equal('Shell session ended with code 0');
        } else {
          expect.fail('Error should be an Error instance');
        }
      }
    });
    
    await cmd.run();
  })
  
  it('throws error when project does not exist', async () => {
    // Make the project not exist
    existsSyncStub.returns(false);
    
    const cmd = new MockedShell([], mockConfig) as MockedShellInstance;
    
    // Override parse and error methods
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    cmd.error = stub().throws(new Error('No WordPress project found in this directory or any parent directory.'));
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error');
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal('No WordPress project found in this directory or any parent directory.');
    }
    
    // No Docker methods should have been called
    expect(dockerServiceStub.shell.called).to.be.false;
  })
})
