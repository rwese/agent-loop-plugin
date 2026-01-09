# Release Guide

This document describes the version management and release process for the agent-loop-plugin.

## Version Management

### Using npm scripts

The project includes several npm scripts for version management:

```bash
# Check what version would be (dry run)
npm run version:check

# Version bumps (automatically commits and pushes)
npm run version:patch    # 4.5.8 -> 4.5.9 (patch)
npm run version:minor    # 4.5.8 -> 4.6.0 (minor)
npm run version:major    # 4.5.8 -> 5.0.0 (major)

# Full release with checks
npm run release:patch    # Test + lint + build + version bump + push + tag
npm run release:minor    # Test + lint + build + version bump + push + tag
npm run release:major    # Test + lint + build + version bump + push + tag

# Release preparation
npm run release          # Test + lint + build + commit + push (no version bump)
```

### Using the release script

For more control over the release process, use the included bash script:

```bash
# Make the script executable (first time only)
chmod +x scripts/release.sh

# Run individual checks
./scripts/release.sh test      # Run test suite
./scripts/release.sh lint      # Run linter
./scripts/release.sh build     # Build distribution
./scripts/release.sh prepare   # Test + lint + build (no version bump)

# Create releases
./scripts/release.sh patch     # Run checks + patch version + commit + push + tag
./scripts/release.sh minor     # Run checks + minor version + commit + push + tag
./scripts/release.sh major     # Run checks + major version + commit + push + tag

# Get help
./scripts/release.sh help
```

## Release Process

### Standard Release (patch/minor/major)

1. **Ensure clean working tree**

   ```bash
   git status  # Should show "nothing to commit, working tree clean"
   ```

2. **Create release** (recommended)

   ```bash
   npm run release:patch  # For patch releases
   # or
   npm run release:minor  # For minor releases
   # or
   npm run release:major  # For major releases
   ```

   This will:
   - Run tests
   - Run linter with auto-fix
   - Build distribution
   - Bump version in package.json
   - Create git commit
   - Push to remote
   - Create git tag
   - Push git tag

3. **Manual release** (if needed)

   ```bash
   # Run checks manually
   npm run test
   npm run lint:fix
   npm run build

   # Create version bump
   npm version patch -m "chore: Release %s"

   # Push changes and tags
   git push
   git push --tags
   ```

### Release Checklist

Before releasing, ensure:

- [ ] All tests passing (`npm run test`)
- [ ] No linting errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Changelog updated (if needed)
- [ ] Working tree is clean
- [ ] Remote is up to date (`git pull`)

## Version Numbering

This project follows [Semantic Versioning](https://semver.org/):

- **Patch**: Bug fixes, performance improvements, no new features
- **Minor**: New features, backwards compatible
- **Major**: Breaking changes, significant refactoring

### Current Version Scheme

- **Major**: Framework changes, API breaking changes
- **Minor**: New features, significant improvements
- **Patch**: Bug fixes, small improvements, documentation updates

## Git Tags

Tags are created automatically when using the release scripts/npm commands:

```bash
# Tags follow the pattern: v{major}.{minor}.{patch}
# Example: v4.5.8

# List existing tags
git tag -l

# Create tag manually (if needed)
git tag -a v4.5.8 -m "Release v4.5.8"

# Push tags
git push --tags
```

## npm Publishing

To publish to npm registry:

```bash
# Ensure you're logged in
npm login

# Check package details
npm view @frugally3683/agent-loop-plugin

# Publish (only after git push)
npm publish
```

## Troubleshooting

### Version bump failed

If `npm version` fails:

```bash
# Reset to clean state
git checkout package.json
git clean -fd

# Try again
npm version patch
```

### Tests failing

```bash
# Run tests with verbose output
npm run test -- --reporter=verbose

# Check specific test files
npm run test -- __tests__/file.test.ts
```

### Build errors

```bash
# Clean and rebuild
npm run clean
npm run build

# Type checking
npm run typecheck
```

### Git issues

```bash
# Check remote configuration
git remote -v

# Fetch latest from remote
git fetch origin

# Check branch status
git status

# Force push (use carefully!)
git push --force-with-lease
```

## Automation

The release scripts are designed to be used in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Release Patch
  if: github.ref == 'refs/heads/main' && contains(github.event.commits[0].message, 'feat:')
  run: |
    npm run release:patch
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Support

For release issues or questions:

- Check existing [issues](https://github.com/rwese/agent-loop-plugin/issues)
- Create new issue for bugs
- Review [CHANGELOG.md](CHANGELOG.md) for recent changes
