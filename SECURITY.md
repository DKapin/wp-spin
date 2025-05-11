# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Here are the versions that are currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please email security@yourdomain.com. You will receive a response from us within 48 hours. If the issue is confirmed, we will release a patch as soon as possible depending on complexity.

## Security Considerations

This package is designed for local development and has the following security features:

1. **Docker Security:**
   - Container isolation
   - Resource limits
   - No root access in containers
   - Secure environment variable handling

2. **File System Security:**
   - Path traversal protection
   - File permission checks
   - Safe file path handling
   - Input validation

3. **Command Security:**
   - Input validation
   - Error handling
   - Safe command execution
   - Proper cleanup on failures

## Best Practices

When using this package:

1. Keep Docker and Docker Compose updated
2. Use strong passwords for WordPress
3. Don't expose development environments to the internet
4. Regularly update the package
5. Review security advisories 