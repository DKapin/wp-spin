import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonSpyCall, SinonStub, stub } from 'sinon'

interface CommandType {
  checkDockerEnvironment: SinonStub;
  checkWordPressContainer: SinonStub;
  docker: Record<string, SinonStub>;
  log: SinonStub;
  parse: SinonStub;
  run: () => Promise<void>;
  runWpCli: SinonStub;
}

describe('plugin', () => {
  // For capturing output
  let consoleOutput: string[] = []
  const originalConsoleLog = console.log
  
  // Test constants
  const TEST_PLUGIN_NAME = 'woocommerce'
  const TEST_PLUGIN_VERSION = '8.0.0'
  
  // Stubs for dependencies
  let dockerServiceStub: Record<string, SinonStub>
  let fsStub: Record<string, SinonStub>
  // Using CommandType instead of any
  let PluginCommand: { new(argv: string[]): CommandType }
  let childProcessStub: Record<string, SinonStub>
  
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
      isDockerRunning: stub().resolves(true)
    }
    
    // Create Docker service constructor stub
    const DockerServiceStub = stub().returns(dockerServiceStub)
    
    // Create fs stub
    fsStub = {
      existsSync: stub().returns(true),
      writeFile: stub().resolves()
    }
    
    // Create a spawn stub for Docker exec and other child processes
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
            callback(Buffer.from('Command executed successfully'))
          }

          return { on: stub() }
        }
      }
    })
    
    // Create mocks for node:child_process
    childProcessStub = {
      execSync: stub().returns('container-id'),
      spawn: spawnStub
    }
    
    // Load Plugin command with mocked dependencies
    PluginCommand = await esmock('../../src/commands/plugin.js', {
      '../../src/config/sites.js': {
        getSiteByName: stub().returns(null)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      'fs-extra': fsStub,
      'node:child_process': childProcessStub
    })
  })
  
  afterEach(() => {
    console.log = originalConsoleLog
    restore()
  })

  it('lists plugins when no flags are provided', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand([])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    pluginCmd.runWpCli = stub().resolves('woocommerce\ncontact-form-7')
    
    // Override parse to return empty flags
    pluginCmd.parse = stub().resolves({ 
      flags: {}
    })
    
    // Run the command
    await pluginCmd.run()
    
    // Verify output
    expect(pluginCmd.log.calledWith('Installed plugins:')).to.be.true
    expect(pluginCmd.runWpCli.calledWith('wp plugin list')).to.be.true
  })

  it('installs a plugin with --add flag', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand(['--add', TEST_PLUGIN_NAME])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    pluginCmd.runWpCli = stub().resolves(`Installed: ${TEST_PLUGIN_NAME}`)
    
    // Override parse to return an 'add' flag
    pluginCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_PLUGIN_NAME,
        force: false
      }
    })
    
    // Run the command
    await pluginCmd.run()
    
    // Verify the output
    expect(pluginCmd.log.calledWith(`Installing plugin ${TEST_PLUGIN_NAME}...`)).to.be.true
    expect(pluginCmd.log.calledWith(`Plugin ${TEST_PLUGIN_NAME} installed successfully!`)).to.be.true
    
    // The issue might be in how wp plugin install command is formatted
    // Let's check the actual command string that was passed
    const wpCliCalls = pluginCmd.runWpCli.getCalls().map((call: SinonSpyCall) => call.args[0] as string)
    expect(wpCliCalls.some((cmd: string) => cmd.includes(`wp plugin install ${TEST_PLUGIN_NAME}`))).to.be.true
  })

  it('installs a plugin with version using --add and --version flags', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand(['--add', TEST_PLUGIN_NAME, '--version', TEST_PLUGIN_VERSION])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    pluginCmd.runWpCli = stub().resolves(`Installed: ${TEST_PLUGIN_NAME} version ${TEST_PLUGIN_VERSION}`)
    
    // Override parse to return add and version flags
    pluginCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_PLUGIN_NAME,
        force: false,
        version: TEST_PLUGIN_VERSION
      }
    })
    
    // Run the command
    await pluginCmd.run()
    
    // Verify the output
    expect(pluginCmd.log.calledWith(`Installing plugin ${TEST_PLUGIN_NAME} version ${TEST_PLUGIN_VERSION}...`)).to.be.true
    expect(pluginCmd.log.calledWith(`Plugin ${TEST_PLUGIN_NAME} installed successfully!`)).to.be.true
    
    // Check that the command includes the right parameters
    const wpCliCalls = pluginCmd.runWpCli.getCalls().map((call: SinonSpyCall) => call.args[0] as string)
    expect(wpCliCalls.some((cmd: string) => 
      cmd.includes(`wp plugin install ${TEST_PLUGIN_NAME}`) && 
      cmd.includes(`--version=${TEST_PLUGIN_VERSION}`)
    )).to.be.true
  })

  it('removes a plugin with --remove flag', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand(['--remove', TEST_PLUGIN_NAME])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    pluginCmd.runWpCli = stub().resolves(`Removed: ${TEST_PLUGIN_NAME}`)
    
    // Override parse to return a 'remove' flag
    pluginCmd.parse = stub().resolves({ 
      flags: { 
        remove: TEST_PLUGIN_NAME
      }
    })
    
    // Run the command
    await pluginCmd.run()
    
    // Verify the output
    expect(pluginCmd.log.calledWith(`Removing plugin ${TEST_PLUGIN_NAME}...`)).to.be.true
    expect(pluginCmd.log.calledWith(`Plugin ${TEST_PLUGIN_NAME} removed successfully!`)).to.be.true
    
    // Check that the command includes the right parameters
    const wpCliCalls = pluginCmd.runWpCli.getCalls().map((call: SinonSpyCall) => call.args[0] as string)
    expect(wpCliCalls.some((cmd: string) => cmd.includes(`wp plugin delete ${TEST_PLUGIN_NAME}`))).to.be.true
  })
  
  it('handles errors during plugin operations', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand(['--add', TEST_PLUGIN_NAME])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    
    // Make runWpCli throw an error
    pluginCmd.runWpCli = stub().throws(new Error('Plugin installation failed'))
    
    // Override parse to return an 'add' flag
    pluginCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_PLUGIN_NAME,
        force: false
      }
    })
    
    // Expect an error when running the command
    try {
      await pluginCmd.run()
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('Plugin installation failed')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
  })
  
  it('checks WordPress container before running commands', async () => {
    // Create a plugin command instance
    const pluginCmd = new PluginCommand([])
    
    // Set up instance
    pluginCmd.docker = dockerServiceStub
    pluginCmd.checkDockerEnvironment = stub().resolves()
    pluginCmd.checkWordPressContainer = stub().resolves()
    pluginCmd.log = stub()
    pluginCmd.runWpCli = stub().resolves('plugins list')
    
    // Override parse to return empty flags
    pluginCmd.parse = stub().resolves({ 
      flags: {}
    })
    
    // Run the command
    await pluginCmd.run()
    
    // Verify container checks were performed
    expect(pluginCmd.checkDockerEnvironment.called).to.be.true
    expect(pluginCmd.checkWordPressContainer.called).to.be.true
  })
})
