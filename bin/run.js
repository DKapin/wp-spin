#!/usr/bin/env node

import {execute} from '@oclif/core'

// Force loading from the manifest for TypeScript projects
await execute({
  dir: import.meta.url,
  useManifest: true,
  development: false
})
