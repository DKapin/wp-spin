import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('shell', () => {
  it('runs shell cmd', async () => {
    const {stdout} = await runCommand('shell')
    expect(stdout).to.contain('hello world')
  })

  it('runs shell --name oclif', async () => {
    const {stdout} = await runCommand('shell --name oclif')
    expect(stdout).to.contain('hello oclif')
  })
})
