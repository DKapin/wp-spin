# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

wp-spin is a CLI tool for managing Docker-based WordPress environments built with:
- **Framework**: OCLIF (Open CLI Framework) v4
- **Language**: TypeScript with ES modules 
- **Runtime**: Node.js 18+
- **Architecture**: Service-oriented with command pattern

## Essential Commands

### Development
```bash
npm run build          # Clean, compile TypeScript, and generate manifest
npm run test           # Run test suite
npm run lint           # Run ESLint
npm run test:all       # Run tests and linting together
npm run test:verify    # Full verification: build + test + lint
```

### Testing Commands
```bash
npm run test:mocha     # Run Mocha tests with coverage
npm run test:coverage  # Generate HTML coverage report
npm run test:watch     # Watch mode for development
npm run test:debug     # Debug mode with inspector
```

### Local Development & Installation
```bash
npm run deploy         # Build, manifest, readme, and install globally
npm run prepare:commit # Pre-commit: build, test, lint
```

## Architecture Overview

### Command Structure
All commands inherit from `BaseCommand` (`src/commands/base.ts`) which provides:
- Docker environment validation
- Site path resolution with security checks  
- Project detection and validation
- Port conflict resolution
- Custom domain configuration via nginx proxy

### Core Services
- **DockerService** (`src/services/docker.ts`): Docker container management, port detection, WordPress environment lifecycle
- **NginxProxyService** (`src/services/nginx-proxy.ts`): Custom domain routing, SSL certificate management, hosts file management
- **PortManager** (`src/services/port-manager.ts`): Port conflict detection and resolution

### Key Features
- **Multi-site Management**: Each WordPress site isolated with own containers, ports, and file system
- **Automatic Port Resolution**: Detects conflicts and prompts for resolution or auto-assigns ports
- **Custom Domains**: nginx proxy with SSL support via mkcert
- **Security**: Path traversal protection, safe permissions checking, container privilege restrictions

### Site Resolution Logic
The `--site` flag accepts:
1. Registered site names (managed via `wp-spin sites` command)
2. Absolute paths to wp-spin projects
3. Relative paths (resolved from current directory)
4. If no site specified, walks up directory tree to find wp-spin project

### Container Naming
Containers follow pattern: `{project-dir-name}_{service}` (e.g., `mysite_wordpress`, `mysite_mysql`)

## Testing Requirements

Per `.cursorrules`, when adding new functionality:
- Add unit tests for individual functions/methods
- Add integration tests for command interactions  
- Include error cases and edge cases
- Testing may be skipped for trivial/cosmetic changes
- Use TODO comments when skipping tests

Test files use Mocha with Sinon for mocking and are located in `test/` directory.

## Development Notes

- ES modules are used throughout (`"type": "module"`)
- Commands are auto-discovered from `src/commands/` directory
- TypeScript builds to `dist/` directory
- Uses `execa` for subprocess execution instead of native child_process where possible
- Docker Compose files are generated and managed dynamically
- Supports ARM64 and x86 architectures with appropriate image selection