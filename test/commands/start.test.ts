import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonStub, stub } from 'sinon'

describe('start', () => {
  // For capturing output
  let consoleOutput: string[] = []
  const originalConsoleLog = console.log
  
  // Stubs for dependencies
  let dockerServiceStub: Record<string, SinonStub>
  let fsStub: Record<string, SinonStub>
  
  // Define a type for the StartCommand
  interface StartCommandType {
    checkDockerEnvironment: SinonStub;
    docker: Record<string, SinonStub>;
    error: SinonStub;
    findProjectRoot: SinonStub;
    run: () => Promise<void>;
  }
  
  // Declare with constructor type
  let StartCommand: { new(argv: string[]): StartCommandType }
  let oraStub: SinonStub
  let execaStub: SinonStub
  
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
      checkPorts: stub().resolves(),
      checkProjectExists: stub().resolves(true),
      getContainerNames: stub().returns({ mysql: 'test_mysql_1', wordpress: 'test_wordpress_1' }),
      getPortMappings: stub().returns({ 8080: 8080, 8081: 8081 }),
      getProjectPath: stub().returns('/test/project/path'),
      isDockerRunning: stub().resolves(true),
      start: stub().resolves()
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
    
    // Create execa stub
    execaStub = stub().resolves({
      stdout: 'test_wordpress_1\ntest_phpmyadmin_1'
    })
    
    // Configure execa stub for different command variations
    execaStub.withArgs('docker', ['ps', '--format', '{{.Names}}']).resolves({
      stdout: 'test_wordpress_1\ntest_phpmyadmin_1'
    })
    
    execaStub.withArgs('docker', ['port', 'test_wordpress_1', '80']).resolves({
      stdout: '0.0.0.0:8080'
    })
    
    execaStub.withArgs('docker', ['port', 'test_phpmyadmin_1', '80']).resolves({
      stdout: '0.0.0.0:8081'
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
            callback(Buffer.from('Container started'))
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
    
    // Load Start command with mocked dependencies
    StartCommand = await esmock('../../src/commands/start.js', {
      '../../src/config/sites.js': {
        getSiteByName: stub().returns(null)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      'execa': {
        execa: execaStub
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
  
  it('starts the WordPress environment', async () => {
    // Create an instance of the command
    const startCmd = new StartCommand([])
    
    // Set up instance
    startCmd.docker = dockerServiceStub
    startCmd.checkDockerEnvironment = stub().resolves()
    startCmd.findProjectRoot = stub().returns('/test/project/path')
    
    // Run the command
    await startCmd.run()
    
    // Verify Docker service was started
    expect(dockerServiceStub.start.called).to.be.true
    
    // Verify port configuration was checked
    expect(dockerServiceStub.checkPorts.called).to.be.true
  })
  
  it('fails if no WordPress project exists in current directory', async () => {
    // Create an instance of the command
    const startCmd = new StartCommand([])
    
    // Set up instance
    startCmd.docker = dockerServiceStub
    startCmd.findProjectRoot = stub().returns(null)
    
    // Set up error to return specific message
    startCmd.error = stub().throws(new Error('No WordPress project found'))
    
    try {
      await startCmd.run()
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('No WordPress project found')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
    
    // Verify Docker service was not started
    expect(dockerServiceStub.start.called).to.be.false
  })
  
  it('fails if Docker is not running', async () => {
    // Create an instance of the command
    const startCmd = new StartCommand([])
    
    // Set up instance
    startCmd.docker = dockerServiceStub
    startCmd.findProjectRoot = stub().returns('/test/project/path')
    startCmd.checkDockerEnvironment = stub().throws(new Error('Docker is not running'))
    
    // Set up error to return specific message
    startCmd.error = stub().throws(new Error('Docker is not running'))
    
    try {
      await startCmd.run()
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('Docker is not running')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
    
    // Verify Docker service was not started
    expect(dockerServiceStub.start.called).to.be.false
  })
  
  it('handles port conflicts by checking ports', async () => {
    // Create an instance of the command
    const startCmd = new StartCommand([])
    
    // Set up instance
    startCmd.docker = dockerServiceStub
    startCmd.checkDockerEnvironment = stub().resolves()
    startCmd.findProjectRoot = stub().returns('/test/project/path')
    
    // Run the command
    await startCmd.run()
    
    // Verify port configuration was checked
    expect(dockerServiceStub.checkPorts.called).to.be.true
  })
})
