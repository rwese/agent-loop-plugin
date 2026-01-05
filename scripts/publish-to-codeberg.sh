#!/bin/bash
# ===========================================================================
# Codeberg npm Registry Publish Script
# ===========================================================================
# 
# This script publishes the package to the Codeberg npm registry.
# 
# Usage:
#   ./scripts/publish-to-codeberg.sh [--major | --minor | --patch]
#
# Prerequisites:
#   1. Set up .npmrc with Codeberg credentials:
#      echo "@nope-at:registry=https://codeberg.org/api/packages/npm" > .npmrc
#      echo "//codeberg.org/api/packages/npm/:_authToken=${CODEBERG_NPM_TOKEN}" >> .npmrc
#
#   2. Set CODEBERG_NPM_TOKEN environment variable:
#      export CODEBERG_NPM_TOKEN="your-token-here"
#
#   3. Ensure git remote is set to Codeberg:
#      git remote add codeberg ssh://git@codeberg.org:nope-at/oc-agent-loop.git
#
# ===========================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCOPE="@nope-at"
REGISTRY="https://codeberg.org/api/packages/npm"
REMOTE="codeberg"
BRANCH="main"

# Parse arguments
VERSION_TYPE="patch"
while [[ $# -gt 0 ]]; do
    case $1 in
        --major)
            VERSION_TYPE="major"
            shift
            ;;
        --minor)
            VERSION_TYPE="minor"
            shift
            ;;
        --patch)
            VERSION_TYPE="patch"
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--major | --minor | --patch]"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🚀 Publishing agent-loop-plugin to Codeberg npm registry${NC}"
echo ""

# ===========================================================================
# Step 1: Verify Prerequisites
# ===========================================================================

echo -e "${YELLOW}📋 Verifying prerequisites...${NC}"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi
echo "✅ npm is installed: $(npm --version)"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ git is not installed${NC}"
    exit 1
fi
echo "✅ git is installed: $(git --version)"

# Check if CODEBERG_TOKEN is set
if [ -z "${CODEBERG_TOKEN:-}" ]; then
    echo -e "${RED}❌ CODEBERG_TOKEN environment variable is not set${NC}"
    echo ""
    echo -e "${YELLOW}💡 To fix this, run:${NC}"
    echo "  export CODEBERG_TOKEN=\"your-codeberg-token\""
    echo ""
    echo -e "${YELLOW}💡 Or create a .npmrc file with your token:${NC}"
    echo "  echo \"@nope-at:registry=https://codeberg.org/api/packages/npm\" > .npmrc"
    echo "  echo \"//codeberg.org/api/packages/npm/:_authToken=YOUR_TOKEN\" >> .npmrc"
    exit 1
fi
echo "✅ CODEBERG_TOKEN is set"

# Check git remote
if ! git remote get-url "$REMOTE" &> /dev/null; then
    echo -e "${YELLOW}⚠️  '$REMOTE' remote not found. Adding it...${NC}"
    git remote add "$REMOTE" "ssh://git@codeberg.org:nope-at/oc-agent-loop.git"
    echo "✅ Added '$REMOTE' remote"
else
    echo "✅ '$REMOTE' remote is configured"
fi

# ===========================================================================
# Step 2: Install Dependencies
# ===========================================================================

echo ""
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm ci
echo "✅ Dependencies installed"

# ===========================================================================
# Step 3: Run Quality Checks
# ===========================================================================

echo ""
echo -e "${YELLOW}🔍 Running quality checks...${NC}"

echo "  📝 Type checking..."
npm run typecheck
echo "  ✅ Type checking passed"

echo "  🏗️  Building..."
npm run build
echo "  ✅ Build successful"

echo "  🧪 Testing..."
npm test -- --run
echo "  ✅ Tests passed"

echo "  🎨 Linting..."
npm run lint
echo "  ✅ Linting passed"

echo "  📐 Format checking..."
npm run format:check
echo "  ✅ Format check passed"

# ===========================================================================
# Step 4: Configure npm Registry
# ===========================================================================

echo ""
echo -e "${YELLOW}⚙️  Configuring npm registry...${NC}"

# Create .npmrc file
cat > .npmrc << EOF
@${SCOPE#@}:registry=${REGISTRY}
//${REGISTRY#https://}:_authToken=${CODEBERG_TOKEN}
EOF

echo "✅ Created .npmrc with Codeberg registry configuration"
cat .npmrc

# ===========================================================================
# Step 5: Bump Version
# ===========================================================================

echo ""
echo -e "${YELLOW}🏷️  Bumping ${VERSION_TYPE} version...${NC}"

case $VERSION_TYPE in
    major)
        npm version major --no-git-tag-version
        ;;
    minor)
        npm version minor --no-git-tag-version
        ;;
    patch)
        npm version patch --no-git-tag-version
        ;;
esac

NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ Version bumped to: $NEW_VERSION"

# ===========================================================================
# Step 6: Publish to Codeberg
# ===========================================================================

echo ""
echo -e "${YELLOW}📤 Publishing to Codeberg npm registry...${NC}"

npm publish --access public

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Successfully published v${NEW_VERSION} to Codeberg npm registry${NC}"
else
    echo -e "${RED}❌ Failed to publish to Codeberg npm registry${NC}"
    exit 1
fi

# ===========================================================================
# Step 7: Git Operations
# ===========================================================================

echo ""
echo -e "${YELLOW}🔄 Performing git operations...${NC}"

# Stage package.json changes
git add package.json package-lock.json

# Create commit
git commit -m "chore: bump version to ${NEW_VERSION}"
echo "✅ Created commit for version ${NEW_VERSION}"

# Push to Codeberg
echo ""
echo -e "${YELLOW}📤 Pushing to Codeberg...${NC}"
git push "$REMOTE" "$BRANCH"
echo "✅ Pushed to Codeberg"

# Create and push tag
echo ""
echo -e "${YELLOW}🏷️  Creating git tag...${NC}"
git tag -m "v${NEW_VERSION}" "v${NEW_VERSION}"
git push "$REMOTE" "v${NEW_VERSION}"
echo "✅ Created and pushed tag v${NEW_VERSION}"

# ===========================================================================
# Summary
# ===========================================================================

echo ""
echo -e "${GREEN}🎉 Successfully published agent-loop-plugin v${NEW_VERSION}${NC}"
echo ""
echo "Package details:"
echo "  📦 Package: agent-loop-plugin"
echo "  🏷️  Version: ${NEW_VERSION}"
echo "  📍 Registry: ${REGISTRY}"
echo "  🌐 Repository: ssh://git@codeberg.org:nope-at/oc-agent-loop.git"
echo ""
echo "Next steps:"
echo "  1. The package is now available at: ${REGISTRY}/-/package/${SCOPE}/agent-loop"
echo "  2. Users can install it with: npm install ${SCOPE}/agent-loop-plugin"
echo "  3. Or reference it in opencode.json: \"plugin\": [\"agent-loop-plugin\"]"
echo ""
