import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('theme add', () => {
  it('runs theme add cmd', async () => {
    const {stdout} = await runCommand('theme add')
    expect(stdout).to.contain('hello world')
  })

  it('runs theme add --name oclif', async () => {
    const {stdout} = await runCommand('theme add --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
