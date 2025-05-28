# Commit Message Convention

This document outlines the commit message convention used in this project. The convention is based on [Conventional Commits](https://www.conventionalcommits.org/).

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

## Scopes

The scope should be the name of the module affected (as perceived by the person reading the changelog).

## Description

The description should be a short summary of the change, written in the imperative mood.

## Examples

```
feat(auth): add OAuth2 authentication
fix(api): handle null response from server
docs(readme): update installation instructions
style(lint): fix indentation in main file
refactor(utils): simplify date formatting function
perf(query): optimize database queries
test(api): add tests for error handling
chore(deps): update dependencies
```

## Pull Request Titles

When creating a pull request, use the same convention in the PR title. This helps with automatic versioning:

- `feat: Add new feature` - Triggers a minor version bump
- `fix: Fix bug in feature` - Triggers a patch version bump
- `breaking: Change API` - Triggers a major version bump 