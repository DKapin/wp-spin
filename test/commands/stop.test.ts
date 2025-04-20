import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import * as fs from 'fs-extra'
import sinon from 'sinon'

import Stop from '../../src/commands/stop.js'
import {DockerService} from '../../src/services/docker.js'

describe('stop', () => {
  // Stubs
  let dockerServiceStub: sinon.SinonStubbedInstance<DockerService>
  
  beforeEach(() => {
    // Create stubs for all the dependencies
    dockerServiceStub = sinon.createStubInstance(DockerService)
    dockerServiceStub.stop.resolves()
    dockerServiceStub.checkProjectExists.resolves(true)
    
    // Create a property that can be stubbed
    Object.defineProperty(Stop.prototype, 'docker', { 
      value: dockerServiceStub,
      writable: true
    })
    
    // Stub filesystem operations
    sinon.stub(fs, 'existsSync').returns(true)
    
    // Stub process.cwd()
    sinon.stub(process, 'cwd').returns('/test/project/path')
    
    // Set test environment variable
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    // Restore all stubs
    sinon.restore()
  })
  
  it('stops the WordPress environment', async () => {
    const {stdout} = await runCommand(['stop'])
    
    // Verify Docker service was stopped
    expect(dockerServiceStub.stop.called).to.be.true
    
    // Verify output contains success message
    expect(stdout).to.include('WordPress environment stopped')
  })
  
  it('fails if no WordPress project exists in current directory', async () => {
    // Setup: project doesn't exist
    dockerServiceStub.checkProjectExists.resolves(false)
    
    try {
      await runCommand(['stop'])
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      expect(errorMessage).to.include('No WordPress project found')
    }
    
    // Verify Docker service was not stopped
    expect(dockerServiceStub.stop.called).to.be.false
  })
  
  it('fails if Docker environment check fails', async () => {
    // Setup: Docker check fails
    dockerServiceStub.checkDockerRunning.rejects(new Error('Docker is not running'))
    
    try {
      await runCommand(['stop'])
      // Should not reach here
      expect.fail('Command should have thrown an error')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      expect(errorMessage).to.include('Docker is not running')
    }
    
    // Verify Docker service was not stopped
    expect(dockerServiceStub.stop.called).to.be.false
  })
})
