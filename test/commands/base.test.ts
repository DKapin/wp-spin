import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('base', () => {
  it('runs base cmd', async () => {
    const {stdout} = await runCommand('base')
    expect(stdout).to.contain('hello world')
  })

  it('runs base --name oclif', async () => {
    const {stdout} = await runCommand('base --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
