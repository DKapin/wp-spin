import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('plugin', () => {
  it('runs plugin cmd', async () => {
    const {stdout} = await runCommand('plugin')
    expect(stdout).to.contain('hello world')
  })

  it('runs plugin --name oclif', async () => {
    const {stdout} = await runCommand('plugin --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
