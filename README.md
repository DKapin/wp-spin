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
* [`wp-spin containers`](#wp-spin-containers)
* [`wp-spin init NAME`](#wp-spin-init-name)
* [`wp-spin ps`](#wp-spin-ps)
* [`wp-spin restart`](#wp-spin-restart)
* [`wp-spin share`](#wp-spin-share)
* [`wp-spin sites ACTION [NAME] [PATH]`](#wp-spin-sites-action-name-path)
* [`wp-spin start`](#wp-spin-start)
* [`wp-spin status`](#wp-spin-status)
* [`wp-spin stop`](#wp-spin-stop)

## `wp-spin containers`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin containers [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Show status of Docker containers for this project. You can use either the site's path or any of its aliases with the --site flag.

ALIASES
  $ wp-spin containers
  $ wp-spin status

EXAMPLES
  $ wp-spin containers                    # Show containers in current directory

  $ wp-spin containers --site=my-site    # Show containers using site alias

  $ wp-spin containers --site=dev        # Show containers using another alias

  $ wp-spin containers --site=/path/to/site  # Show containers using full path
```

## `wp-spin init NAME`

Initialize a new WordPress project with your choice of WordPress version

```
USAGE
  $ wp-spin init NAME [-f] [-s <value>] [-w <value>]

ARGUMENTS
  NAME  Project name

FLAGS
  -f, --force                      Force initialization even if directory exists
  -s, --site-name=<value>          Site name/alias to register for easy reference with --site flag
  -w, --wordpress-version=<value>  [default: latest] WordPress version to install (e.g., 6.2, 5.9.3, latest)

DESCRIPTION
  Initialize a new WordPress project with your choice of WordPress version. The site name/alias can be used with the --site flag in other commands.

EXAMPLES
  $ wp-spin init my-wordpress-site                             # Uses latest WordPress version

  $ wp-spin init my-wordpress-site --wordpress-version=6.4.2   # Installs specific WordPress version 6.4.2

  $ wp-spin init my-wordpress-site --site-name=pretty          # Creates a site with a friendly name "pretty"
```

_See code: [src/commands/init.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/init.ts)_

## `wp-spin ps`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin ps [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Show status of Docker containers for this project. You can use either the site's path or any of its aliases with the --site flag.

ALIASES
  $ wp-spin containers
  $ wp-spin status

EXAMPLES
  $ wp-spin ps                    # Show containers in current directory

  $ wp-spin ps --site=my-site    # Show containers using site alias

  $ wp-spin ps --site=dev        # Show containers using another alias

  $ wp-spin ps --site=/path/to/site  # Show containers using full path
```

_See code: [src/commands/ps.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/ps.ts)_

## `wp-spin restart`

Restart the WordPress environment

```
USAGE
  $ wp-spin restart [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Restart the WordPress environment. You can use either the site's path or any of its aliases with the --site flag.

EXAMPLES
  $ wp-spin restart                    # Restart containers in current directory

  $ wp-spin restart --site=my-site    # Restart containers using site alias

  $ wp-spin restart --site=dev        # Restart containers using another alias

  $ wp-spin restart --site=/path/to/site  # Restart containers using full path
```

_See code: [src/commands/restart.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/restart.ts)_

## `wp-spin share`

Share your WordPress site publicly using ngrok

```
USAGE
  $ wp-spin share [-s <value>] [-a <value>] [-A <value>...] [-D <value>...] [-d] [-d <value>] [-u] [-p <value>]

FLAGS
  -A, --cidr-allow=<value>...  Reject connections that do not match the given CIDRs
  -D, --cidr-deny=<value>...   Reject connections that match the given CIDRs
  -a, --auth=<value>           ngrok auth token (or use NGROK_AUTH_TOKEN env variable)
  -d, --debug                  Enable debug mode to see detailed ngrok output
  -d, --domain=<value>         Custom domain for your ngrok tunnel (requires ngrok account)
  -p, --port=<value>           Port to expose (defaults to WordPress port from Docker)
  -s, --site=<value>           Site path or site name/alias
  -u, --no-fixurl              Skip fixing WordPress site URL for ngrok compatibility

DESCRIPTION
  Share your WordPress site publicly using ngrok. You can use either the site's path or any of its aliases with the --site flag.

EXAMPLES
  $ wp-spin share                    # Share site in current directory

  $ wp-spin share --site=my-site    # Share site using alias

  $ wp-spin share --site=dev        # Share site using another alias

  $ wp-spin share --site=/path/to/site  # Share site using full path

  $ wp-spin share --domain=mysite.ngrok-free.app  # Use custom domain
```

_See code: [src/commands/share.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/share.ts)_

## `wp-spin sites ACTION [NAME] [PATH]`

Manage WordPress site aliases

```
USAGE
  $ wp-spin sites ACTION [NAME] [PATH]

ARGUMENTS
  ACTION  Action to perform: list, name, update, remove
  NAME    Site name/alias
  PATH    Site path (for name/update actions)

DESCRIPTION
  Manage WordPress site aliases for easy reference with the --site flag. You can have multiple aliases for the same site path.

EXAMPLES
  $ wp-spin sites list                    # List all registered sites and their aliases

  $ wp-spin sites name my-site ./path    # Register a new site with alias "my-site"

  $ wp-spin sites name dev ./path        # Add another alias "dev" to the same site

  $ wp-spin sites remove my-site         # Remove the "my-site" alias

  $ wp-spin sites update my-site /new/path  # Update the path for "my-site" alias
```

_See code: [src/commands/sites.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/sites.ts)_

## `wp-spin start`

Start the WordPress environment

```
USAGE
  $ wp-spin start [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Start the WordPress environment. You can use either the site's path or any of its aliases with the --site flag.

EXAMPLES
  $ wp-spin start                    # Start containers in current directory

  $ wp-spin start --site=my-site    # Start containers using site alias

  $ wp-spin start --site=dev        # Start containers using another alias

  $ wp-spin start --site=/path/to/site  # Start containers using full path
```

_See code: [src/commands/start.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/start.ts)_

## `wp-spin status`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin status [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Show status of Docker containers for this project. You can use either the site's path or any of its aliases with the --site flag.

ALIASES
  $ wp-spin containers
  $ wp-spin ps

EXAMPLES
  $ wp-spin status                    # Show containers in current directory

  $ wp-spin status --site=my-site    # Show containers using site alias

  $ wp-spin status --site=dev        # Show containers using another alias

  $ wp-spin status --site=/path/to/site  # Show containers using full path
```

_See code: [src/commands/status.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/status.ts)_

## `wp-spin stop`

Stop the WordPress environment

```
USAGE
  $ wp-spin stop [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name/alias

DESCRIPTION
  Stop the WordPress environment. You can use either the site's path or any of its aliases with the --site flag.

EXAMPLES
  $ wp-spin stop                    # Stop containers in current directory

  $ wp-spin stop --site=my-site    # Stop containers using site alias

  $ wp-spin stop --site=dev        # Stop containers using another alias

  $ wp-spin stop --site=/path/to/site  # Stop containers using full path
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
