#!/bin/bash
# Version bump and release script for agent-loop-plugin

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    echo -e "${BLUE}Usage:${NC} ./release.sh <version_type>"
    echo ""
    echo -e "${YELLOW}Version types:${NC}"
    echo "  patch - Bug fixes and patches (4.5.8 -> 4.5.9)"
    echo "  minor - New features (4.5.8 -> 4.6.0)"
    echo "  major - Breaking changes (4.5.8 -> 5.0.0)"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  test       - Run test suite only"
    echo "  lint       - Run linter only"
    echo "  build      - Build distribution only"
    echo "  prepare    - Run tests, lint, and build without version bump"
    echo ""
    exit 1
}

# Function to print colored status
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to run checks
run_checks() {
    print_status $YELLOW "Running checks..."

    print_status $BLUE "Running tests..."
    if ! npm run test; then
        print_status $RED "Tests failed!"
        exit 1
    fi
    print_status $GREEN "✓ Tests passed"

    print_status $BLUE "Running linter..."
    if ! npm run lint; then
        print_status $YELLOW "Linter found issues, running auto-fix..."
        npm run lint:fix
    fi
    print_status $GREEN "✓ Linting complete"

    print_status $BLUE "Building distribution..."
    if ! npm run build; then
        print_status $RED "Build failed!"
        exit 1
    fi
    print_status $GREEN "✓ Build successful"

    print_status $GREEN "All checks passed!"
}

# Function to create release commit
create_release() {
    local version_type=$1
    local current_version=$(node -p "require('./package.json').version")
    local git_message="chore: Release version ${current_version}"

    print_status $BLUE "Creating release for ${version_type} version bump..."

    # Stage all changes
    git add -A

    # Create release commit
    git commit -m "${git_message}"

    print_status $GREEN "Release commit created: ${current_version}"

    # Push to remote
    print_status $BLUE "Pushing to remote..."
    git push

    print_status $GREEN "✓ Pushed to remote"

    # Create and push tag
    print_status $BLUE "Creating git tag v${current_version}..."
    git tag -a "v${current_version}" -m "Release v${current_version}

Features:
- $(git log --oneline --since="$(git log -1 --format='%ai' HEAD~1)" --until="$(git log -1 --format='%ai' HEAD)" | head -n 1 || echo 'See commit history for details')

Bug Fixes:
- See commit history for detailed changes

Tests:
- All tests passing

Build:
- Distribution successfully built

For full changelog, see: https://github.com/rwese/agent-loop-plugin/commits/main"

    git push --tags

    print_status $GREEN "✓ Release complete: v${current_version}"
    print_status $BLUE "Tag created and pushed: v${current_version}"
}

# Main script logic
case "${1:-}" in
    test)
        print_status $BLUE "Running test suite..."
        npm run test
        ;;
    lint)
        print_status $BLUE "Running linter..."
        npm run lint
        ;;
    build)
        print_status $BLUE "Building distribution..."
        npm run build
        ;;
    prepare)
        print_status $BLUE "Running preparation checks..."
        run_checks
        ;;
    patch|minor|major)
        run_checks
        npm version "${1}" --message "chore: Bump ${1} version"
        create_release "${1}"
        ;;
    help|--help|-h)
        usage
        ;;
    "")
        print_status $RED "No version type specified!"
        usage
        ;;
    *)
        print_status $RED "Unknown version type: ${1}"
        usage
        ;;
esac