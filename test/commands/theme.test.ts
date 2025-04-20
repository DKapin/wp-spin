import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('theme', () => {
  it('runs theme cmd', async () => {
    const {stdout} = await runCommand('theme')
    expect(stdout).to.contain('hello world')
  })

  it('runs theme --name oclif', async () => {
    const {stdout} = await runCommand('theme --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
