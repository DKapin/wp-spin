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

### Installing from npm (Recommended)

The easiest way to install wp-spin is through npm:

```bash
npm install -g wp-spin
```

After installation, verify it's working:
```bash
wp-spin --version
```

### Installing from GitHub

You can also install wp-spin directly from GitHub using npm:

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
* [`wp-spin logs`](#wp-spin-logs)
* [`wp-spin plugin`](#wp-spin-plugin)
* [`wp-spin ps`](#wp-spin-ps)
* [`wp-spin restart`](#wp-spin-restart)
* [`wp-spin share`](#wp-spin-share)
* [`wp-spin shell`](#wp-spin-shell)
* [`wp-spin sites ACTION [NAME] [PATH]`](#wp-spin-sites-action-name-path)
* [`wp-spin status`](#wp-spin-status)
* [`wp-spin stop`](#wp-spin-stop)
* [`wp-spin theme`](#wp-spin-theme)
* [`wp-spin unshare`](#wp-spin-unshare)

## `wp-spin containers`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin containers [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

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

## `wp-spin logs`

View logs from a specific container (wordpress, mysql, or phpmyadmin)

```
USAGE
  $ wp-spin logs [-d <value>] [-s <value>] [-c wordpress|mysql|phpmyadmin]

FLAGS
  -c, --container=<option>  [default: wordpress] Container to target (wordpress, mysql, phpmyadmin)
                            <options: wordpress|mysql|phpmyadmin>
  -d, --domain=<value>      Custom domain for the site (e.g., example.test)
  -s, --site=<value>        Site path or site name

DESCRIPTION
  View logs from a specific container (wordpress, mysql, or phpmyadmin)

EXAMPLES
  $ wp-spin logs

  $ wp-spin logs --container=mysql

  $ wp-spin logs --container=phpmyadmin

  $ wp-spin logs --container=wordpress

  $ wp-spin logs --container=mysql --site=my-wp-site
```

_See code: [src/commands/logs.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/logs.ts)_

## `wp-spin plugin`

Manage WordPress plugins

```
USAGE
  $ wp-spin plugin [-d <value>] [-s <value>] [-f] [-v <value> [-a <value> | -r <value>]]

FLAGS
  -a, --add=<value>      Name of the plugin to install
  -d, --domain=<value>   Custom domain for the site (e.g., example.test)
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

_See code: [src/commands/plugin.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/plugin.ts)_

## `wp-spin ps`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin ps [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

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

_See code: [src/commands/ps.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/ps.ts)_

## `wp-spin restart`

Restart the WordPress environment

```
USAGE
  $ wp-spin restart [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

DESCRIPTION
  Restart the WordPress environment

EXAMPLES
  $ wp-spin restart
```

_See code: [src/commands/restart.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/restart.ts)_

## `wp-spin share`

Share your WordPress site publicly using ngrok

```
USAGE
  $ wp-spin share [-d <value>] [-s <value>] [-a <value>] [-A <value>...] [-D <value>...] [-d] [-u] [-p
    <value>]

FLAGS
  -A, --cidr-allow=<value>...  Reject connections that do not match the given CIDRs
  -D, --cidr-deny=<value>...   Reject connections that match the given CIDRs
  -a, --auth=<value>           ngrok auth token (or use NGROK_AUTH_TOKEN env variable)
  -d, --debug                  Enable debug mode to see detailed ngrok output
  -d, --domain=<value>         Custom domain for your ngrok tunnel (requires ngrok account)
  -p, --port=<value>           Port to expose (defaults to WordPress port from Docker)
  -s, --site=<value>           Site path or site name
  -u, --no-fixurl              Skip fixing WordPress site URL for ngrok compatibility

DESCRIPTION
  Share your WordPress site publicly using ngrok

EXAMPLES
  $ wp-spin share

  $ wp-spin share --domain=mysite.ngrok-free.app
```

_See code: [src/commands/share.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/share.ts)_

## `wp-spin shell`

Open a shell in a specific container (wordpress, mysql, or phpmyadmin)

```
USAGE
  $ wp-spin shell [-d <value>] [-s <value>] [-c wordpress|mysql|phpmyadmin]

FLAGS
  -c, --container=<option>  [default: wordpress] Container to target (wordpress, mysql, phpmyadmin)
                            <options: wordpress|mysql|phpmyadmin>
  -d, --domain=<value>      Custom domain for the site (e.g., example.test)
  -s, --site=<value>        Site path or site name

DESCRIPTION
  Open a shell in a specific container (wordpress, mysql, or phpmyadmin)

EXAMPLES
  $ wp-spin shell

  $ wp-spin shell --container=mysql

  $ wp-spin shell --container=phpmyadmin

  $ wp-spin shell --container=wordpress

  $ wp-spin shell --container=mysql --site=my-wp-site
```

_See code: [src/commands/shell.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/shell.ts)_

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

_See code: [src/commands/sites.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/sites.ts)_

## `wp-spin status`

Show status of Docker containers for this project

```
USAGE
  $ wp-spin status [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

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

_See code: [src/commands/status.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/status.ts)_

## `wp-spin stop`

Stop the WordPress environment

```
USAGE
  $ wp-spin stop [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

DESCRIPTION
  Stop the WordPress environment

EXAMPLES
  $ wp-spin stop

  $ wp-spin stop --site=./path/to/wordpress
```

_See code: [src/commands/stop.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/stop.ts)_

## `wp-spin theme`

Manage WordPress themes

```
USAGE
  $ wp-spin theme [-d <value>] [-s <value>] [-f] [-v <value> [-a <value> | -r <value>]]

FLAGS
  -a, --add=<value>      Name of the theme to install
  -d, --domain=<value>   Custom domain for the site (e.g., example.test)
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

_See code: [src/commands/theme.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/theme.ts)_

## `wp-spin unshare`

Stop sharing your WordPress site through ngrok

```
USAGE
  $ wp-spin unshare [-d <value>] [-s <value>] [-d] [-f]

FLAGS
  -d, --debug           Show debugging information
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -f, --force           Force kill ngrok processes without restoring WordPress configuration
  -s, --site=<value>    Site path or site name

DESCRIPTION
  Stop sharing your WordPress site through ngrok

EXAMPLES
  $ wp-spin unshare

  $ wp-spin unshare --force

  $ wp-spin unshare --site=my-site
```

_See code: [src/commands/unshare.ts](https://github.com/DKapin/wp-spin/blob/v0.5.2/src/commands/unshare.ts)_
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
