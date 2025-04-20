# wp-spin

A CLI tool for managing Docker-based WordPress environments with ease. Quickly spin up local WordPress development environments with Docker, manage themes, plugins, and more.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/wp-spin.svg)](https://npmjs.org/package/wp-spin)
[![Downloads/week](https://img.shields.io/npm/dw/wp-spin.svg)](https://npmjs.org/package/wp-spin)
[![License](https://img.shields.io/npm/l/wp-spin.svg)](https://github.com/danielkapin/wp-spin/blob/master/package.json)

## Features

- 🚀 Quick WordPress environment setup with Docker
- 🔄 Automatic port conflict resolution
- 🛠️ Built-in theme and plugin management
- 📊 PHPMyAdmin included for database management
- 🐳 Docker-based isolation for multiple projects
- 🔧 Easy-to-use CLI commands
- 🔒 Enhanced security features

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v18 or later)
- Docker
- Docker Compose

## Installation

### Installing from GitHub (Recommended)

You can install wp-spin directly from GitHub using npm:

```bash
# Install from the main branch
npm install -g github:danielkapin/wp-spin

# Install from a specific branch
npm install -g github:danielkapin/wp-spin#branch-name

# Install from a specific release tag
npm install -g github:danielkapin/wp-spin#v1.0.0
```

### Alternative Installation Methods

If you prefer, you can also use the full GitHub URL:

```bash
# Using HTTPS
npm install -g git+https://github.com/danielkapin/wp-spin.git

# Using SSH (if you have SSH keys set up)
npm install -g git+ssh://git@github.com/danielkapin/wp-spin.git
```

## Quick Start

1. Create a new WordPress project:
```bash
wp-spin init my-site
```

2. Navigate to your project:
```bash
cd my-site
```

3. Start the environment:
```bash
wp-spin start
```

Your WordPress site will be available at `http://localhost:8080` and PHPMyAdmin at `http://localhost:8081`.

## Working with Multiple Sites

Each WordPress site is isolated with its own:
- File system
- Database
- Docker containers
- Port configuration

To manage multiple sites:
1. Create each site in a separate directory
2. Use different ports for each site (automatically handled)
3. Start/stop sites independently

## Security Features

wp-spin includes several security enhancements:

- 🔐 Secure random password generation for database credentials
- 📁 Strict file permissions (600) for sensitive files
- 🛡️ Docker containers with principle of least privilege
- ⛔ Container capability restrictions
- 🔒 Read-only file systems with specific write permissions

## Commands

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

_See code: [src/commands/init.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/init.ts)_

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

_See code: [src/commands/logs.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/logs.ts)_

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

_See code: [src/commands/restart.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/restart.ts)_

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

_See code: [src/commands/shell.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/shell.ts)_

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

_See code: [src/commands/start.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/start.ts)_

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

_See code: [src/commands/status.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/status.ts)_

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

_See code: [src/commands/stop.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/stop.ts)_
<!-- commandsstop -->

## Development Workflow

1. **Starting a Project**
   ```bash
   wp-spin init my-project
   cd my-project
   wp-spin start
   ```

2. **Managing Themes**
   ```bash
   wp-spin theme add twenty-twenty-four
   wp-spin theme list
   ```

3. **Managing Plugins**
   ```bash
   wp-spin plugin add woocommerce
   wp-spin plugin list
   ```

4. **Accessing Logs**
   ```bash
   wp-spin logs
   ```

5. **Database Management**
   - Access PHPMyAdmin at `http://localhost:8081`
   - Default credentials are in your project's `.env` file

## Project Structure

```
my-project/
├── wordpress/         # WordPress core files
├── docker-compose.yml # Docker configuration
├── Dockerfile        # Custom WordPress image
└── .env             # Environment variables
```

## Troubleshooting

Common issues and solutions:

1. **Port Conflicts**
   - The tool automatically detects and resolves port conflicts
   - Use `wp-spin status` to check current port assignments

2. **Docker Issues**
   - Ensure Docker is running
   - Check logs with `wp-spin logs`

3. **Permission Issues**
   - Ensure proper file permissions in the `wordpress` directory
   - Use `wp-spin shell` to access the container directly

## Contributing

Contributions are welcome! Please fork this repository and submit pull requests to enhance the project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Issue Tracker](https://github.com/danielkapin/wp-spin/issues)
- 💬 [Discussions](https://github.com/danielkapin/wp-spin/discussions)
