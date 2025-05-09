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
* [`wp-spin base`](#wp-spin-base)
* [`wp-spin containers`](#wp-spin-containers)
* [`wp-spin init NAME`](#wp-spin-init-name)
* [`wp-spin logs`](#wp-spin-logs)
* [`wp-spin plugin`](#wp-spin-plugin)
* [`wp-spin ps`](#wp-spin-ps)
* [`wp-spin restart`](#wp-spin-restart)
* [`wp-spin share`](#wp-spin-share)
* [`wp-spin shell`](#wp-spin-shell)
* [`wp-spin sites ACTION [NAME] [PATH]`](#wp-spin-sites-action-name-path)
* [`wp-spin start`](#wp-spin-start)
* [`wp-spin status`](#wp-spin-status)
* [`wp-spin stop`](#wp-spin-stop)
* [`wp-spin theme`](#wp-spin-theme)
* [`wp-spin unshare`](#wp-spin-unshare)

## `wp-spin base`

```
USAGE
  $ wp-spin base [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name
```

_See code: [src/commands/base.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/base.ts)_

## `wp-spin containers`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin containers [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Show status of Docker containers for this project

ALIASES
  $ wp-spin containers
  $ wp-spin status

EXAMPLES
  $ wp-spin ps

  $ wp-spin ps --site=my-site

  $ wp-spin ps --site=/path/to/my-site
```

## `wp-spin init NAME`

Initialize a new WordPress project with your choice of WordPress version

```
USAGE
  $ wp-spin init NAME [-f] [-c] [-s <value>] [-w <value>]

ARGUMENTS
  NAME  Project name

FLAGS
  -c, --from-current-dir           Use the current directory as the WordPress source if it contains a valid installation
  -f, --force                      Force initialization even if directory exists
  -s, --site-name=<value>          Site name/alias to register for easy reference with --site flag
  -w, --wordpress-version=<value>  [default: latest] WordPress version to install (e.g., 6.2, 5.9.3, latest). Use
                                   specific version numbers like "6.4.2" for a precise release, or "latest" for the most
                                   recent version.

DESCRIPTION
  Initialize a new WordPress project with your choice of WordPress version

EXAMPLES
  $ wp-spin init my-wordpress-site                             # Uses latest WordPress version

  $ wp-spin init my-wordpress-site --wordpress-version=6.4.2   # Installs specific WordPress version 6.4.2

  $ wp-spin init my-wordpress-site --site-name=pretty          # Creates a site with a friendly name "pretty"

  $ wp-spin init my-wordpress-site --from-current-dir          # Use existing WordPress files
```

_See code: [src/commands/init.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/init.ts)_

## `wp-spin logs`

View logs from the WordPress environment

```
USAGE
  $ wp-spin logs [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  View logs from the WordPress environment

EXAMPLES
  $ wp-spin logs
```

_See code: [src/commands/logs.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/logs.ts)_

## `wp-spin plugin`

Manage WordPress plugins

```
USAGE
  $ wp-spin plugin [-s <value>] [-f] [-v <value> [-a <value> | -r <value>]]

FLAGS
  -a, --add=<value>      Name of the plugin to install
  -f, --force            Force operation even if plugin exists/does not exist
  -r, --remove=<value>   Name of the plugin to remove
  -s, --site=<value>     Site path or site name
  -v, --version=<value>  Plugin version to install (only used with --add)

DESCRIPTION
  Manage WordPress plugins

EXAMPLES
  $ wp-spin plugin --add woocommerce

  $ wp-spin plugin --add woocommerce --version 8.0.0

  $ wp-spin plugin --remove woocommerce
```

_See code: [src/commands/plugin.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/plugin.ts)_

## `wp-spin ps`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin ps [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Show status of Docker containers for this project

ALIASES
  $ wp-spin containers
  $ wp-spin status

EXAMPLES
  $ wp-spin ps

  $ wp-spin ps --site=my-site

  $ wp-spin ps --site=/path/to/my-site
```

_See code: [src/commands/ps.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/ps.ts)_

## `wp-spin restart`

Restart the WordPress environment

```
USAGE
  $ wp-spin restart [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Restart the WordPress environment

EXAMPLES
  $ wp-spin restart
```

_See code: [src/commands/restart.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/restart.ts)_

## `wp-spin share`

Share your WordPress site publicly using ngrok

```
USAGE
  $ wp-spin share [-s <value>] [-a <value>] [-d] [-u] [-f] [-m config|options] [-p <value>] [-r
    us|eu|ap|au|sa|jp|in] [-s <value>]

FLAGS
  -a, --auth=<value>       ngrok auth token (or use NGROK_AUTH_TOKEN env variable)
  -d, --debug              Enable debug mode to see detailed ngrok output
  -f, --force              Force sharing even if not in a wp-spin project directory
  -m, --method=<option>    [default: config] Method to fix WordPress URLs: config (wp-config.php) or options (database)
                           <options: config|options>
  -p, --port=<value>       [default: 8080] Port to expose (defaults to WordPress port from Docker)
  -r, --region=<option>    [default: us] Region for the ngrok tunnel
                           <options: us|eu|ap|au|sa|jp|in>
  -s, --site=<value>       Site path or site name
  -s, --subdomain=<value>  Custom subdomain for your ngrok tunnel (requires ngrok account)
  -u, --fixurl             Fix WordPress site URL to work with ngrok

DESCRIPTION
  Share your WordPress site publicly using ngrok

EXAMPLES
  $ wp-spin share

  $ wp-spin share --subdomain=mysite

  $ wp-spin share --region=eu
```

_See code: [src/commands/share.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/share.ts)_

## `wp-spin shell`

Open a shell in the WordPress container

```
USAGE
  $ wp-spin shell [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Open a shell in the WordPress container

EXAMPLES
  $ wp-spin shell
```

_See code: [src/commands/shell.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/shell.ts)_

## `wp-spin sites ACTION [NAME] [PATH]`

Manage WordPress site aliases

```
USAGE
  $ wp-spin sites ACTION [NAME] [PATH]

ARGUMENTS
  ACTION  (list|name|update|remove) Action to perform: list, name, update, remove
  NAME    Site name/alias
  PATH    Site path (for name/update actions)

DESCRIPTION
  Manage WordPress site aliases

EXAMPLES
  $ wp-spin sites list

  $ wp-spin sites name my-site ./path/to/site

  $ wp-spin sites remove my-site

  $ wp-spin sites update my-site /new/path/to/site
```

_See code: [src/commands/sites.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/sites.ts)_

## `wp-spin start`

Start the WordPress environment

```
USAGE
  $ wp-spin start [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Start the WordPress environment

EXAMPLES
  $ wp-spin start

  $ wp-spin start --site=my-site

  $ wp-spin start --site=/path/to/my-site
```

_See code: [src/commands/start.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/start.ts)_

## `wp-spin status`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin status [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Show status of Docker containers for this project

ALIASES
  $ wp-spin containers
  $ wp-spin status

EXAMPLES
  $ wp-spin ps

  $ wp-spin ps --site=my-site

  $ wp-spin ps --site=/path/to/my-site
```

_See code: [src/commands/status.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/status.ts)_

## `wp-spin stop`

Stop the WordPress environment

```
USAGE
  $ wp-spin stop [-s <value>]

FLAGS
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Stop the WordPress environment

EXAMPLES
  $ wp-spin stop

  $ wp-spin stop --site=./path/to/wordpress
```

_See code: [src/commands/stop.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/stop.ts)_

## `wp-spin theme`

Manage WordPress themes

```
USAGE
  $ wp-spin theme [-s <value>] [-f] [-v <value> [-a <value> | -r <value>]]

FLAGS
  -a, --add=<value>      Name of the theme to install
  -f, --force            Force operation even if theme exists/does not exist
  -r, --remove=<value>   Name of the theme to remove
  -s, --site=<value>     Site path or site name
  -v, --version=<value>  Theme version to install (only used with --add)

DESCRIPTION
  Manage WordPress themes

EXAMPLES
  $ wp-spin theme --add twentytwentyfour

  $ wp-spin theme --add twentytwentyfour --version 1.0.0

  $ wp-spin theme --remove twentytwentyfour
```

_See code: [src/commands/theme.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/theme.ts)_

## `wp-spin unshare`

Stop sharing your WordPress site through ngrok

```
USAGE
  $ wp-spin unshare [-s <value>] [-d] [-f]

FLAGS
  -d, --debug         Show debugging information
  -f, --force         Force kill ngrok processes without restoring WordPress configuration
  -s, --site=<value>  Site path or site name

DESCRIPTION
  Stop sharing your WordPress site through ngrok

EXAMPLES
  $ wp-spin unshare

  $ wp-spin unshare --force

  $ wp-spin unshare --site=my-site
```

_See code: [src/commands/unshare.ts](https://github.com/danielkapin/wp-spin/blob/v0.1.0/src/commands/unshare.ts)_
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
