#!/bin/bash
# Build script for Zotero Mistral OCR plugin

set -e

PLUGIN_NAME="zotero-mistral-ocr"
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

echo "Building $PLUGIN_NAME version $VERSION..."

# Remove old XPI if exists
rm -f "$PLUGIN_NAME.xpi"

# Create XPI (which is just a ZIP file)
zip -r "$PLUGIN_NAME.xpi" \
    manifest.json \
    bootstrap.js \
    prefs.js \
    content/ \
    locale/ \
    -x "*.DS_Store" -x "*~"

echo "Created $PLUGIN_NAME.xpi"
echo "Size: $(ls -lh "$PLUGIN_NAME.xpi" | awk '{print $5}')"
