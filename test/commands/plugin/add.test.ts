import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('plugin:add', () => {
  it('runs plugin:add cmd', async () => {
    const {stdout} = await runCommand('plugin:add')
    expect(stdout).to.contain('hello world')
  })

  it('runs plugin:add --name oclif', async () => {
    const {stdout} = await runCommand('plugin:add --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
