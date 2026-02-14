#!/bin/bash
set -euo pipefail

# cd to the skills directory (where this script lives)
cd "$(dirname "$0")"

echo "Building Solana Autopilot skills package..."

# Install production dependencies for solana-paper-trader
echo "Installing dependencies for solana-paper-trader..."
(cd solana-paper-trader && npm install --production)

# Create dist directory
mkdir -p dist

# Package all 4 skill directories into a zip
echo "Creating zip archive..."
zip -r dist/solana-autopilot-skills-v1.0.0.zip \
  solana-paper-trader \
  solana-risk-manager \
  solana-portfolio \
  solana-devnet-smoke \
  --exclude "node_modules/.package-lock.json"

# Print the zip file size and path
ZIP_PATH="$(pwd)/dist/solana-autopilot-skills-v1.0.0.zip"
ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
echo ""
echo "Build complete!"
echo "  Size: $ZIP_SIZE"
echo "  Path: $ZIP_PATH"
