import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonStub, stub } from 'sinon'

describe('stop', () => {
  // For capturing output
  let consoleOutput: string[] = []
  const originalConsoleLog = console.log
  
  // Stubs for dependencies
  let dockerServiceStub: Record<string, SinonStub>
  let fsStub: Record<string, SinonStub>
  
  // Define a type for the StopCommand class
  interface StopCommandType {
    checkDockerEnvironment: SinonStub;
    docker: Record<string, SinonStub>;
    error: SinonStub;
    run: () => Promise<void>;
    validateProjectContext: SinonStub;
  }
  
  // Declare with constructor type
  let StopCommand: { new(argv: string[]): StopCommandType }
  let oraStub: SinonStub
  
  beforeEach(async () => {
    // Setup console capture
    consoleOutput = []
    console.log = (message: string) => {
      consoleOutput.push(message)
      return originalConsoleLog(message)
    }
    
    // Create Docker service stub
    dockerServiceStub = {
      checkDockerComposeInstalled: stub().resolves(),
      checkDockerInstalled: stub().resolves(),
      checkDockerRunning: stub().resolves(),
      checkProjectExists: stub().resolves(true),
      getContainerNames: stub().returns({ mysql: 'test_mysql_1', wordpress: 'test_wordpress_1' }),
      getProjectPath: stub().returns('/test/project/path'),
      isDockerRunning: stub().resolves(true),
      stop: stub().resolves()
    }
    
    // Create Docker service constructor stub
    const DockerServiceStub = stub().returns(dockerServiceStub)
    
    // Create fs stub
    fsStub = {
      existsSync: stub().returns(true),
      writeFile: stub().resolves()
    }
    
    // Create a mock ora instance
    oraStub = stub().returns({
      fail: stub(),
      info: stub(),
      start: stub().returns({
        fail: stub(),
        info: stub(),
        succeed: stub(),
        warn: stub()
      }),
      succeed: stub(),
      warn: stub()
    })
    
    // Create a spawn stub
    const spawnStub = stub().returns({
      on(event: string, callback: (code: number) => void) {
        if (event === 'close') {
          callback(0) // Call with success exit code
        }

        return { on: stub() }
      },
      
      stderr: {
        on: stub().returns({ on: stub() })
      },
      
      stdout: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('Container stopped'))
          }

          return { on: stub() }
        }
      }
    })
    
    // Create mocks for node:child_process
    const childProcessStub = {
      execSync: stub().returns('container-id'),
      spawn: spawnStub
    }
    
    // Load Stop command with mocked dependencies
    StopCommand = await esmock('../../src/commands/stop.js', {
      '../../src/config/sites.js': {
        getSiteByName: stub().returns(null)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      'fs-extra': fsStub,
      'node:child_process': childProcessStub,
      'ora': oraStub
    })
  })
  
  afterEach(() => {
    console.log = originalConsoleLog
    restore()
  })
  
  it('stops the WordPress environment', async () => {
    // Create an instance of the command
    const stopCmd = new StopCommand([])
    
    // Set up instance
    stopCmd.docker = dockerServiceStub
    stopCmd.checkDockerEnvironment = stub().resolves()
    
    // Run the command
    await stopCmd.run()
    
    // Verify Docker service was stopped
    expect(dockerServiceStub.stop.called).to.be.true
  })
  
  it('fails if no WordPress project exists in current directory', async () => {
    // Setup: project doesn't exist
    dockerServiceStub.checkProjectExists.resolves(false)
    
    // Create an instance of the command
    const stopCmd = new StopCommand([])
    
    // Set up instance
    stopCmd.docker = dockerServiceStub
    stopCmd.validateProjectContext = stub().throws(new Error('No WordPress project found'))
    stopCmd.checkDockerEnvironment = stub().throws(new Error('No WordPress project found'))
    
    // Set up error to return specific message
    stopCmd.error = stub().throws(new Error('No WordPress project found'))
    
    try {
      await stopCmd.run()
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('No WordPress project found')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
    
    // Verify Docker service was not stopped
    expect(dockerServiceStub.stop.called).to.be.false
  })
  
  it('fails if Docker environment check fails', async () => {
    // Create an instance of the command
    const stopCmd = new StopCommand([])
    
    // Set up instance
    stopCmd.docker = dockerServiceStub
    stopCmd.checkDockerEnvironment = stub().throws(new Error('Docker is not running'))
    
    // Set up error to return specific message
    stopCmd.error = stub().throws(new Error('Docker is not running'))
    
    try {
      await stopCmd.run()
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('Docker is not running')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
    
    // Verify Docker service was not stopped
    expect(dockerServiceStub.stop.called).to.be.false
  })
})
