# wp-spin

A CLI tool for managing Docker-based WordPress environments with ease. Quickly spin up local secure WordPress development environments with Docker. Manage development, themes, plugins, and more.

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
- 🐛 **Xdebug debugging support** with IDE-specific setup instructions
- 🌐 Custom local domains with optional HTTPS/SSL support
- 🏗️ WordPress Multisite network support (subdomain and path-based)
- 🔗 Public sharing via ngrok tunnels
- 📱 Architecture-aware Docker images (ARM64/Apple Silicon + x86 support)

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

After installation, verify that it's working:
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

## Advanced Project Initialization

The `wp-spin init` command supports many advanced options for customizing your WordPress environment:

### Basic Initialization
```bash
wp-spin init my-site                    # Basic setup
wp-spin init my-site --site-name="My Blog"  # Custom site title
wp-spin init my-site --wordpress-version=6.4  # Specific WordPress version
```

### Custom Domains and SSL
```bash
wp-spin init my-site --domain=mysite.test           # Custom local domain
wp-spin init my-site --domain=mysite.test --ssl     # With HTTPS/SSL certificate
```

### WordPress Multisite Networks
```bash
# Subdomain multisite (requires custom domain)
wp-spin init network --multisite --multisite-type=subdomain --domain=net.test

# Path-based multisite  
wp-spin init network --multisite --multisite-type=path --domain=net.test
```

### All-in-One Example
```bash
wp-spin init my-project \
  --site-name="My Development Site" \
  --domain=dev.test \
  --ssl \
  --wordpress-version=latest
```

## Interactive Mode, Local URLs, and HTTPS

### Interactive Mode
When you run `wp-spin init` without all required flags, the CLI will guide you through an interactive setup. You'll be prompted for:
- Project/site name
- Whether to use a custom local domain (e.g., mysite.test)
- Whether to enable HTTPS (SSL) for your local domain (requires [mkcert](https://github.com/FiloSottile/mkcert))

You can skip interactive mode by providing all required flags (e.g., `--site-name`, `--domain`, `--ssl`).

### Local URLs
By default, your WordPress site will be available at a local URL such as:
- `http://localhost:8080` (or another port if 8080 is in use)
- If you specify a custom domain (e.g., `--domain=mysite.test`), it will also be available at `http://mysite.test`

The tool automatically configures your `/etc/hosts` and nginx proxy so the custom domain points to your local environment.

### HTTPS Support
If you enable the `--ssl` flag (or choose HTTPS in interactive mode), wp-spin will:
- Generate a local SSL certificate for your custom domain using mkcert
- Configure nginx to serve your site at `https://yourdomain.test`
- Update WordPress settings to use HTTPS for the custom domain

**Note:**
- HTTPS is only available for custom domains (not for plain `localhost`)
- You must have [mkcert](https://github.com/FiloSottile/mkcert) installed for SSL support

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

## PHP Debugging with Xdebug

wp-spin includes **built-in Xdebug support** for PHP debugging, making it easy to debug WordPress themes, plugins, and core functionality.

### Quick Start with Xdebug

1. **Start your site with Xdebug enabled:**
   ```bash
   wp-spin start --xdebug
   ```
   or restart an existing site:
   ```bash
   wp-spin restart --xdebug
   ```

2. **Choose your IDE** when prompted, or specify it directly:
   ```bash
   wp-spin start --xdebug --ide=vscode
   wp-spin restart --xdebug --ide=phpstorm
   ```

3. **Follow the IDE-specific setup instructions** that are displayed automatically

### Supported IDEs

wp-spin provides setup instructions for:
- **VS Code** (`--ide=vscode`) - Complete launch.json configuration
- **PhpStorm/IntelliJ IDEA** (`--ide=phpstorm`) - Server and debug setup
- **Sublime Text** (`--ide=sublime`) - Xdebug Client package configuration  
- **Vim/Neovim** (`--ide=vim`) - Vdebug plugin setup
- **Generic setup** for other editors

### How It Works

- **Xdebug is pre-installed** in the Docker container but disabled by default for performance
- **Environment variable control**: `XDEBUG_MODE=off` (default) or `XDEBUG_MODE=debug` (when enabled)
- **Port 9003**: Standard Xdebug port for IDE connections
- **Path mappings**: Container path `/var/www/html` maps to your local project directory
- **Host connection**: Uses `host.docker.internal` for container-to-host communication

### Example VS Code Setup

When you run `wp-spin start --xdebug --ide=vscode`, you'll get a complete `.vscode/launch.json` configuration:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Listen for Xdebug",
      "type": "php",
      "request": "launch", 
      "port": 9003,
      "pathMappings": {
        "/var/www/html/wp-content": "${workspaceFolder}/wp-content"
      },
      "log": true
    }
  ]
}
```

### Debugging Workflow

1. **Enable Xdebug** with `wp-spin start --xdebug` or `wp-spin restart --xdebug`
2. **Configure your IDE** using the provided instructions
3. **Set breakpoints** in your PHP files (themes, plugins, etc.)
4. **Start debugging** in your IDE (usually F5 or click debug icon)
5. **Visit your WordPress site** to trigger the breakpoints
6. **Step through code**, inspect variables, and debug issues

### Disabling Xdebug

To disable Xdebug for better performance:
```bash
wp-spin restart
```
This will restart with `XDEBUG_MODE=off` (the default setting).

## WordPress Multisite Support

wp-spin supports WordPress Multisite networks for managing multiple WordPress sites from a single installation.

### Creating a Multisite Network

You can enable Multisite during initialization:

```bash
# Subdomain-based multisite (requires custom domain)
wp-spin init my-network --multisite --multisite-type=subdomain --domain=mynetwork.test

# Path-based multisite
wp-spin init my-network --multisite --multisite-type=path --domain=mynetwork.test
```

### Multisite Types

- **Subdomain**: Sites accessible as `site1.mynetwork.test`, `site2.mynetwork.test`
- **Path**: Sites accessible as `mynetwork.test/site1`, `mynetwork.test/site2`

**Note**: Subdomain multisite requires a custom domain (`--domain` flag) for proper subdomain routing.

### Interactive Multisite Setup

When using interactive mode (`wp-spin init`), you'll be prompted to:
1. Enable multisite (yes/no)
2. Choose multisite type (subdomain or path)  
3. Configure a custom domain (required for subdomain type)

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
* [`wp-spin db ACTION [TARGET]`](#wp-spin-db-action-target)
* [`wp-spin hook ACTION`](#wp-spin-hook-action)
* [`wp-spin init [NAME]`](#wp-spin-init-name)
* [`wp-spin logs`](#wp-spin-logs)
* [`wp-spin php [VERSION]`](#wp-spin-php-version)
* [`wp-spin plugin`](#wp-spin-plugin)
* [`wp-spin ps`](#wp-spin-ps)
* [`wp-spin remove`](#wp-spin-remove)
* [`wp-spin restart`](#wp-spin-restart)
* [`wp-spin share`](#wp-spin-share)
* [`wp-spin shell`](#wp-spin-shell)
* [`wp-spin sites ACTION [NAME] [PATH]`](#wp-spin-sites-action-name-path)
* [`wp-spin start`](#wp-spin-start)
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

## `wp-spin db ACTION [TARGET]`

Manage WordPress database operations

```
USAGE
  $ wp-spin db ACTION [TARGET] [--exclude-tables <value>] [-f] [--search-replace <value>] [-s <value>]
    [--skip-themes-plugins] [--skip-url-update]

ARGUMENTS
  ACTION  (export|import|reset|snapshot) Database action to perform
  TARGET  Target file for import/export or snapshot name

FLAGS
  -f, --force                   Force operation without confirmation prompts
  -s, --site=<value>            Site path or site name to operate on
      --exclude-tables=<value>  Comma-separated list of tables to exclude from export
      --search-replace=<value>  Search and replace URLs during import (format: old.com,new.com)
      --skip-themes-plugins     Skip themes and plugins tables during import
      --skip-url-update         Skip automatic URL updates during import

DESCRIPTION
  Manage WordPress database operations

EXAMPLES
  $ wp-spin db export

  $ wp-spin db export backup.sql

  $ wp-spin db import backup.sql

  $ wp-spin db import backup.sql --search-replace=oldsite.com,newsite.com

  $ wp-spin db import backup.sql --skip-url-update

  $ wp-spin db reset

  $ wp-spin db snapshot create dev-state

  $ wp-spin db snapshot restore dev-state

  $ wp-spin db snapshot list
```

_See code: [src/commands/db.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/db.ts)_

## `wp-spin hook ACTION`

Manage shell hook for automatic wp-spin cleanup (installed by default)

```
USAGE
  $ wp-spin hook ACTION [-f]

ARGUMENTS
  ACTION  (install|uninstall|status|reset-preferences) Action to perform

FLAGS
  -f, --force  Force installation even if already installed

DESCRIPTION
  Manage shell hook for automatic wp-spin cleanup (installed by default)

EXAMPLES
  $ wp-spin hook install

  $ wp-spin hook uninstall

  $ wp-spin hook status
```

_See code: [src/commands/hook.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/hook.ts)_

## `wp-spin init [NAME]`

Initialize a new WordPress development environment

```
USAGE
  $ wp-spin init [NAME] [--domain <value>] [-s <value>] [--mailhog] [--multisite] [--multisite-type
    subdomain|path] [--site-name <value>] [--ssl] [--wordpress-version <value>]

ARGUMENTS
  NAME  Project name

FLAGS
  -s, --site=<value>               Site path or site name
      --domain=<value>             Custom domain to use for the WordPress site (e.g., mysite.test). If no TLD is
                                   provided, .test will be automatically appended.
      --mailhog                    Install MailHog for local email testing (also installs WP Mail SMTP plugin)
      --multisite                  Enable WordPress Multisite (Network) support
      --multisite-type=<option>    Type of multisite network: subdomain or path (required if --multisite is used)
                                   <options: subdomain|path>
      --site-name=<value>          Site name (defaults to project name)
      --ssl                        Generate a local SSL certificate for your custom domain using mkcert (requires mkcert
                                   to be installed)
      --wordpress-version=<value>  [default: latest] WordPress version to install

DESCRIPTION
  Initialize a new WordPress development environment

EXAMPLES
  $ wp-spin init my-site

  $ wp-spin init my-site --site-name="My Site"

  $ wp-spin init my-site --wordpress-version=6.4

  $ wp-spin init my-site --domain=mysite

  $ wp-spin init my-site --domain=mysite.test

  $ wp-spin init my-site --mailhog

  $ wp-spin init network --multisite --multisite-type=subdomain --domain=net.test --mailhog
```

_See code: [src/commands/init.ts](https://github.com/DKapin/wp-spin/blob/v0.11.16/src/commands/init.ts)_

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

_See code: [src/commands/logs.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/logs.ts)_

## `wp-spin php [VERSION]`

Manage PHP version for WordPress environment

```
USAGE
  $ wp-spin php [VERSION] [-d <value>] [-s <value>] [-f] [-l]

ARGUMENTS
  VERSION  (7.2|7.3|7.4|8.0|8.1|8.2|8.3|8.4) PHP version to switch to

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -f, --force           Force PHP version change without confirmation
  -l, --list            List all available PHP versions
  -s, --site=<value>    Site path or site name

DESCRIPTION
  Manage PHP version for WordPress environment

EXAMPLES
  $ wp-spin php

  $ wp-spin php 8.3

  $ wp-spin php 8.2

  $ wp-spin php 7.4

  $ wp-spin php --list
```

_See code: [src/commands/php.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/php.ts)_

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

_See code: [src/commands/plugin.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/plugin.ts)_

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

_See code: [src/commands/ps.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/ps.ts)_

## `wp-spin remove`

Remove a WordPress development environment

```
USAGE
  $ wp-spin remove [-d <value>] [-s <value>]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name

DESCRIPTION
  Remove a WordPress development environment

EXAMPLES
  $ wp-spin remove mysite
```

_See code: [src/commands/remove.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/remove.ts)_

## `wp-spin restart`

Restart the WordPress environment

```
USAGE
  $ wp-spin restart [-d <value>] [-s <value>] [--ide vscode|phpstorm|sublime|vim --xdebug]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -s, --site=<value>    Site path or site name
      --ide=<option>    IDE to configure for debugging (vscode, phpstorm, sublime, vim)
                        <options: vscode|phpstorm|sublime|vim>
      --xdebug          Enable Xdebug for PHP debugging

DESCRIPTION
  Restart the WordPress environment

EXAMPLES
  $ wp-spin restart
```

_See code: [src/commands/restart.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/restart.ts)_

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

_See code: [src/commands/share.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/share.ts)_

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

_See code: [src/commands/shell.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/shell.ts)_

## `wp-spin sites ACTION [NAME] [PATH]`

View and manage WordPress site aliases

```
USAGE
  $ wp-spin sites ACTION [NAME] [PATH]

ARGUMENTS
  ACTION  (list|name|update) Action to perform: list, name, update
  NAME    Site name/alias
  PATH    Site path (for name/update actions)

DESCRIPTION
  View and manage WordPress site aliases

EXAMPLES
  $ wp-spin sites list

  $ wp-spin sites name my-site ./path/to/site

  $ wp-spin sites update my-site /new/path/to/site
```

_See code: [src/commands/sites.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/sites.ts)_

## `wp-spin start`

Start a WordPress development environment

```
USAGE
  $ wp-spin start [-d <value>] [-s <value>] [--ide vscode|phpstorm|sublime|vim --xdebug] [-p <value>]
    [--ssl]

FLAGS
  -d, --domain=<value>  Custom domain for the site (e.g., example.test)
  -p, --port=<value>    Port to run WordPress on (if not specified, an available port will be found)
  -s, --site=<value>    Site path or site name
      --ide=<option>    IDE to configure for debugging (vscode, phpstorm, sublime, vim)
                        <options: vscode|phpstorm|sublime|vim>
      --ssl             Enable SSL for custom domain
      --xdebug          Enable Xdebug for PHP debugging

DESCRIPTION
  Start a WordPress development environment
```

_See code: [src/commands/start.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/start.ts)_

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

_See code: [src/commands/status.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/status.ts)_

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

_See code: [src/commands/stop.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/stop.ts)_

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

_See code: [src/commands/theme.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/theme.ts)_

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

_See code: [src/commands/unshare.ts](https://github.com/DKapin/wp-spin/blob/v0.11.20/src/commands/unshare.ts)_
<!-- commandsstop -->

## Development Workflow

1. **Starting a Project**
   ```bash
   wp-spin init my-project
   cd my-project
   wp-spin start
   ```

2. **Development with Debugging**
   ```bash
   wp-spin start --xdebug --ide=vscode    # Start with Xdebug enabled
   # Set breakpoints in your IDE, then visit your site
   wp-spin restart                        # Disable Xdebug for better performance
   ```

3. **Managing Themes**
   ```bash
   wp-spin theme --add twentytwentyfour
   wp-spin theme --list
   ```

4. **Managing Plugins**
   ```bash
   wp-spin plugin --add woocommerce
   wp-spin plugin --list
   ```

5. **Accessing Logs**
   ```bash
   wp-spin logs                           # WordPress logs
   wp-spin logs --container=mysql         # MySQL logs  
   wp-spin logs --container=phpmyadmin    # PHPMyAdmin logs
   ```

6. **Database Management**
   - Access PHPMyAdmin at `http://localhost:8081`
   - Default credentials are in your project's `.env` file

7. **Shell Access**
   ```bash
   wp-spin shell                          # WordPress container shell
   wp-spin shell --container=mysql        # MySQL container shell
   ```

8. **Public Sharing**
   ```bash
   wp-spin share                          # Share via ngrok tunnel
   wp-spin unshare                        # Stop sharing
   ```

## Project Structure

```
my-project/
├── wp-content/         # WordPress themes, plugins, uploads
├── docker-compose.yml  # Docker services configuration  
├── Dockerfile         # Custom WordPress image with Xdebug
├── .env               # Environment variables (XDEBUG_MODE, DB credentials)
├── .wp-spin           # Project configuration (domain, version, etc.)
├── .gitignore         # Git ignore rules for WordPress projects  
└── .credentials.json  # Database credentials backup (secure)
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
   - Ensure proper file permissions in the `wp-content` directory
   - Use `wp-spin shell` to access the container directly

4. **Xdebug Not Working**
   - Verify Xdebug is enabled: `wp-spin restart --xdebug`
   - Check container logs: `wp-spin logs`
   - Verify IDE is listening on port 9003
   - Ensure path mappings are correct: `/var/www/html` → your project directory
   - Test with a simple `xdebug_info()` call in PHP

5. **Custom Domain Issues**
   - Ensure you have admin/sudo permissions (needed for `/etc/hosts` modification)
   - For SSL: Install `mkcert` and run `mkcert -install` first
   - Check if nginx proxy is running: `docker ps | grep nginx`

6. **Multisite Issues**
   - Subdomain multisite requires a custom domain (`--domain` flag)
   - Ensure WordPress constants are properly set in `wp-config.php`
   - Check that DNS/hosts file entries include subdomain wildcards

## Contributing

Contributions are welcome! Please fork this repository and submit pull requests to enhance the project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Issue Tracker](https://github.com/danielkapin/wp-spin/issues)
- 💬 [Discussions](https://github.com/danielkapin/wp-spin/discussions)
