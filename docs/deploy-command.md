# Deploy Command

The `wp-spin deploy` command allows you to deploy your WordPress site from your local Docker environment to various hosting providers.

## Usage

```bash
# Basic usage
wp-spin deploy

# Deploy to a specific destination defined in deploy.config.json
wp-spin deploy production

# Deploy with specific options
wp-spin deploy --provider=ssh --host=example.com --path=/var/www/html --db --media

# Simulate deployment without making actual changes
wp-spin deploy --dry-run
```

## Supported Providers

- **SSH**: Generic SSH-based deployment to any server
- **AWS**: Deploy to Amazon Web Services (EC2, S3, etc.)
- **DigitalOcean**: Optimized for DigitalOcean Droplets
- **WP Engine**: Deploys to WP Engine hosting
- **SiteGround**: Deploys to SiteGround hosting
- **Cloudways**: Deploys to Cloudways hosting
- **Git**: Git-based deployment workflow

## Configuration

You can configure the deployment using:

1. Command line flags
2. A `deploy.config.json` file in your project root

The `deploy.config.json` file allows you to define multiple deployment targets. Command line flags will override settings in the config file.

### Example Configuration

```json
{
  "default": {
    "provider": "ssh",
    "backup": true,
    "db": true,
    "media": true
  },
  "production": {
    "provider": "wpengine",
    "predeploy": "npm run build"
  },
  "staging": {
    "provider": "aws",
    "host": "ec2-12-34-56-78.compute-1.amazonaws.com",
    "path": "/var/www/html",
    "backup": true,
    "db": true
  }
}
```

## Options

| Flag | Description |
|------|-------------|
| `--provider=<provider>` | Hosting provider: aws, digitalocean, wpengine, siteground, cloudways, ssh, git |
| `--host=<hostname>` | Destination host (IP address or domain) |
| `--path=<path>` | Remote path where WordPress files will be deployed |
| `--predeploy=<command>` | Run a local shell command before deployment |
| `--db` | Include WordPress database in the deployment |
| `--media` | Include wp-content/uploads directory in the deployment |
| `--backup` | Create backup of the existing site on the remote host |
| `--dry-run` | Simulate the deployment without performing actual changes |

## Examples

### Deploy to Production

```bash
wp-spin deploy production
```

This will use the "production" settings from your `deploy.config.json` file.

### Deploy to AWS EC2 Instance

```bash
wp-spin deploy --provider=aws --host=ec2-12-34-56-78.compute-1.amazonaws.com --path=/var/www/html --db
```

### Deploy to a Custom SSH Server

```bash
wp-spin deploy --provider=ssh --host=myserver.com --path=/var/www/html --db
```

### Test Deployment Without Making Changes

```bash
wp-spin deploy production --dry-run
```

## Requirements

- SSH key authentication should be set up for remote servers
- For AWS deployments, proper AWS credentials should be configured
- Docker environment must be running for database export
- Appropriate permissions on the remote server 