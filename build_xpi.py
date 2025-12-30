#!/usr/bin/env python3
"""Build XPI package for Zotero plugin."""
import zipfile
import os

XPI_NAME = "zotero-mistral-ocr.xpi"

# Files to include at root level (in order)
ROOT_FILES = [
    "manifest.json",
    "bootstrap.js", 
    "prefs.js",
    "icon.png",
    "icon@2x.png",
]

# Directories to include recursively
DIRECTORIES = ["content", "locale"]

def main():
    # Remove existing XPI
    if os.path.exists(XPI_NAME):
        os.remove(XPI_NAME)
    
    # Create ZIP with maximum compatibility
    with zipfile.ZipFile(XPI_NAME, 'w', zipfile.ZIP_DEFLATED) as xpi:
        # Add root files FIRST (important for some JAR readers)
        for f in ROOT_FILES:
            if os.path.exists(f):
                xpi.write(f, f)
                print(f"Added: {f}")
            else:
                print(f"WARNING: {f} not found")
        
        # Then add directories
        for directory in DIRECTORIES:
            for root, dirs, files in os.walk(directory):
                for file in files:
                    filepath = os.path.join(root, file)
                    # Use forward slashes in ZIP
                    arcname = filepath.replace("\\", "/")
                    xpi.write(filepath, arcname)
                    print(f"Added: {arcname}")
    
    print(f"\nCreated {XPI_NAME} ({os.path.getsize(XPI_NAME)} bytes)")
    
    # Verify contents
    print("\nXPI contents (in order):")
    with zipfile.ZipFile(XPI_NAME, 'r') as xpi:
        for name in xpi.namelist():
            info = xpi.getinfo(name)
            print(f"  {name} ({info.file_size} bytes)")

if __name__ == "__main__":
    main()
