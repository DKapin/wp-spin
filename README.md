# wp-spin

A CLI tool for managing Docker-based WordPress environments

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/wp-spin.svg)](https://npmjs.org/package/wp-spin)
[![Downloads/week](https://img.shields.io/npm/dw/wp-spin.svg)](https://npmjs.org/package/wp-spin)
[![License](https://img.shields.io/npm/l/wp-spin.svg)](https://github.com/Projects/wp-spin/blob/master/package.json)

<!-- toc -->
* [wp-spin](#wp-spin)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g wp-spin
$ wp-spin COMMAND
running command...
$ wp-spin (--version)
wp-spin/0.1.0 darwin-arm64 node-v22.9.0
$ wp-spin --help [COMMAND]
USAGE
  $ wp-spin COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`wp-spin init NAME`](#wp-spin-init-name)
* [`wp-spin logs`](#wp-spin-logs)
* [`wp-spin restart`](#wp-spin-restart)
* [`wp-spin shell`](#wp-spin-shell)
* [`wp-spin start`](#wp-spin-start)
* [`wp-spin status`](#wp-spin-status)
* [`wp-spin stop`](#wp-spin-stop)

## `wp-spin init NAME`

Initialize a new WordPress project

```
USAGE
  $ wp-spin init NAME [-g] [-f]

ARGUMENTS
  NAME  Project name

FLAGS
  -f, --force        Force initialization even if directory exists
  -g, --from-github  Import from a GitHub repository

DESCRIPTION
  Initialize a new WordPress project

EXAMPLES
  $ wp-spin init my-wordpress-site

  $ wp-spin init my-wordpress-site --from-github
```

_See code: [src/commands/init.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/init.ts)_

## `wp-spin logs`

View logs from the WordPress environment

```
USAGE
  $ wp-spin logs

DESCRIPTION
  View logs from the WordPress environment

EXAMPLES
  $ wp-spin logs
```

_See code: [src/commands/logs.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/logs.ts)_

## `wp-spin restart`

Restart the WordPress environment

```
USAGE
  $ wp-spin restart

DESCRIPTION
  Restart the WordPress environment

EXAMPLES
  $ wp-spin restart
```

_See code: [src/commands/restart.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/restart.ts)_

## `wp-spin shell`

Open a shell in the WordPress container

```
USAGE
  $ wp-spin shell

DESCRIPTION
  Open a shell in the WordPress container

EXAMPLES
  $ wp-spin shell
```

_See code: [src/commands/shell.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/shell.ts)_

## `wp-spin start`

Start the WordPress environment

```
USAGE
  $ wp-spin start

DESCRIPTION
  Start the WordPress environment

EXAMPLES
  $ wp-spin start
```

_See code: [src/commands/start.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/start.ts)_

## `wp-spin status`

Show the status of the WordPress environment

```
USAGE
  $ wp-spin status

DESCRIPTION
  Show the status of the WordPress environment

EXAMPLES
  $ wp-spin status
```

_See code: [src/commands/status.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/status.ts)_

## `wp-spin stop`

Stop the WordPress environment

```
USAGE
  $ wp-spin stop

DESCRIPTION
  Stop the WordPress environment

EXAMPLES
  $ wp-spin stop
```

_See code: [src/commands/stop.ts](https://github.com/Projects/wp-spinup-v2/blob/v0.1.0/src/commands/stop.ts)_
<!-- commandsstop -->
