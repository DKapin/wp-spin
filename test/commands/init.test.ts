import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import * as fs from 'fs-extra'
import { join } from 'node:path'
import * as sinon from 'sinon'

import Init from '../../src/commands/init.js'
import {DockerService} from '../../src/services/docker.js'

describe('init', () => {
  // Test constants
  const TEST_PROJECT_NAME = 'test-project'
  const TEST_PROJECT_PATH = join(process.cwd(), TEST_PROJECT_NAME)
  
  // Stubs
  let dockerServiceStub: sinon.SinonStubbedInstance<DockerService>
  let fsExistsStub: sinon.SinonStub
  let fsMkdirStub: sinon.SinonStub
  let fsWriteFileStub: sinon.SinonStub
  let fsChmodStub: sinon.SinonStub
  
  beforeEach(() => {
    // Create stubs for all the dependencies
    dockerServiceStub = sinon.createStubInstance(DockerService)
    dockerServiceStub.checkDockerInstalled.resolves()
    dockerServiceStub.checkDockerRunning.resolves()
    dockerServiceStub.checkDockerComposeInstalled.resolves()
    dockerServiceStub.checkDiskSpace.resolves()
    dockerServiceStub.checkMemory.resolves()
    dockerServiceStub.checkPorts.resolves()
    dockerServiceStub.start.resolves()
    
    // Create a property that can be stubbed
    Object.defineProperty(Init.prototype, 'docker', { 
      value: dockerServiceStub,
      writable: true
    })
    
    // Stub filesystem operations
    fsExistsStub = sinon.stub(fs, 'existsSync')
    fsMkdirStub = sinon.stub(fs, 'mkdirSync')
    fsWriteFileStub = sinon.stub(fs, 'writeFile').resolves()
    fsChmodStub = sinon.stub(fs, 'chmod').resolves()
    
    // Default behavior for existence check - directory doesn't exist
    fsExistsStub.withArgs(TEST_PROJECT_PATH).returns(false)
    
    // Set TEST env variable to skip problematic code
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    // Restore all stubs
    sinon.restore()
  })
  
  it('creates a new WordPress project directory', async () => {
    const {stdout} = await runCommand(['init', TEST_PROJECT_NAME])
    
    // Verify directory was created
    expect(fsMkdirStub.calledWith(TEST_PROJECT_PATH)).to.be.true
    
    // Verify Docker checks were performed
    expect(dockerServiceStub.checkDockerInstalled.called).to.be.true
    expect(dockerServiceStub.checkDockerRunning.called).to.be.true
    expect(dockerServiceStub.checkDockerComposeInstalled.called).to.be.true
    
    // Verify files were created
    expect(fsWriteFileStub.called).to.be.true
    
    // Verify output contains success message
    expect(stdout).to.include('Project directory created')
  })
  
  it('fails if directory already exists and no force flag', async () => {
    // Setup: directory exists
    fsExistsStub.withArgs(TEST_PROJECT_PATH).returns(true)
    
    try {
      await runCommand(['init', TEST_PROJECT_NAME])
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.include(`Directory ${TEST_PROJECT_NAME} already exists`)
    }
    
    // Verify no attempt to create directory was made
    expect(fsMkdirStub.called).to.be.false
  })
  
  it('removes existing directory when force flag is used', async () => {
    // Setup: directory exists
    fsExistsStub.withArgs(TEST_PROJECT_PATH).returns(true)
    const fsRemoveStub = sinon.stub(fs, 'removeSync')
    
    await runCommand(['init', TEST_PROJECT_NAME, '--force'])
    
    // Verify directory was removed and recreated
    expect(fsRemoveStub.calledWith(TEST_PROJECT_PATH)).to.be.true
    expect(fsMkdirStub.calledWith(TEST_PROJECT_PATH)).to.be.true
  })
  
  it('creates secure credentials in .env and .credentials.json files', async () => {
    // Mock the private method for generating passwords
    const initProto = Init.prototype as unknown as { generateSecurePassword: () => string }
    sinon.stub(initProto, 'generateSecurePassword').returns('test-secure-password')
    
    await runCommand(['init', TEST_PROJECT_NAME])
    
    // Verify env file was created with secure passwords
    expect(fsWriteFileStub.getCalls().some(call => call.args[0].toString().endsWith('.env') && 
             call.args[1].toString().includes('WORDPRESS_DB_PASSWORD=test-secure-password'))).to.be.true
    
    // Verify credentials file was created
    expect(fsWriteFileStub.getCalls().some(call => call.args[0].toString().endsWith('.credentials.json') && 
             call.args[1].toString().includes('test-secure-password'))).to.be.true
    
    // Verify permissions were set
    expect(fsChmodStub.getCalls().some(call => 
      call.args[1] === 0o600
    )).to.be.true
  })
  
  it('handles Docker environment check failures', async () => {
    // Setup: Docker check fails
    dockerServiceStub.checkDockerRunning.rejects(new Error('Docker is not running'))
    
    try {
      await runCommand(['init', TEST_PROJECT_NAME])
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.include('Docker is not running')
    }
  })
  
  it('starts the WordPress environment after setup', async () => {
    await runCommand(['init', TEST_PROJECT_NAME])
    
    // Verify Docker environment was started
    expect(dockerServiceStub.start.called).to.be.true
  })
})
