# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zotero Mistral OCR is a **Zotero 7 plugin** that adds a right-click context menu to process PDF attachments using Mistral's OCR API. It creates high-quality markdown conversions with properly formatted figures, equations, and tables.

The plugin communicates with a companion Python server (`mistral-ocr-zotero` package) that handles the actual OCR processing via Mistral's API.

## Build Commands

### Python Build (Recommended)

```powershell
python build_xpi.py
```

This creates a properly structured XPI that works with Zotero's JAR reader. Use this method to avoid compatibility issues.

### Bash Build (Git Bash / WSL)

```bash
# Build the XPI plugin package
./build.sh

# Manual build alternative
zip -r zotero-mistral-ocr.xpi manifest.json bootstrap.js prefs.js content/ locale/ icon.png icon@2x.png
```

### PowerShell Build (Windows without WSL)

> **Warning:** PowerShell's `Compress-Archive` may create ZIP files with compatibility issues. Use the Python script instead if you encounter "Error opening input stream" errors.

```powershell
if (Test-Path zotero-mistral-ocr.xpi) { Remove-Item zotero-mistral-ocr.xpi }
Compress-Archive -Path manifest.json, bootstrap.js, prefs.js, content, locale, icon.png, "icon@2x.png" -DestinationPath zotero-mistral-ocr.zip -Force
Rename-Item zotero-mistral-ocr.zip zotero-mistral-ocr.xpi
```

The output `zotero-mistral-ocr.xpi` can be installed in Zotero via Tools > Add-ons > Install Add-on From File.

## Architecture

This is a **bootstrapped Zotero 7 plugin** (not a legacy overlay extension). Key architectural points:

### Entry Point: `bootstrap.js`
- Contains the `MistralOCR` singleton object with all plugin logic
- Lifecycle hooks: `install()`, `uninstall()`, `startup()`, `shutdown()`
- Registers a context menu item in Zotero's item menu (`zotero-itemmenu`)
- Registers a preferences pane via `Zotero.PreferencePanes.register()`
- Manages the OCR server lifecycle (auto-start via nsIProcess)

### Server Communication
The plugin communicates with a local Python server via HTTP REST API:
- `GET /health` - Check if server is running
- `POST /ocr` - Submit items for OCR processing (body: `{item_keys: [...], force: bool}`)
- `GET /status/{job_id}` - Poll job status

Default server: `http://127.0.0.1:8080`

### Preferences System
- Default prefs defined in `prefs.js` (Mozilla `pref()` format)
- Runtime defaults registered in `registerPrefs()` in bootstrap.js
- Preference keys use `extensions.mistral-ocr.*` namespace
- UI in `content/preferences.xhtml` (XUL/XHTML hybrid for Zotero 7)
- Script logic in `content/preferences.js`

### Localization
- Fluent (.ftl) format in `locale/en-US/addon.ftl`
- Not currently wired up in the XUL preferences (uses hardcoded strings)

## File Structure

```
bootstrap.js           # Main plugin code (startup, menu, server control)
manifest.json          # Plugin metadata (version, Zotero compatibility)
prefs.js               # Default preference values
icon.png               # Plugin icon 48x48 (MUST be at root for manifest.json)
icon@2x.png            # Plugin icon 96x96 (MUST be at root for manifest.json)
content/
  preferences.xhtml    # Settings UI (Zotero preferences pane)
  preferences.js       # Settings UI logic
  icons/               # Legacy icon location (kept for compatibility)
locale/en-US/
  addon.ftl            # Localization strings (Fluent format)
```

## Key Development Notes

### Zotero 7 API Patterns
- Use `Zotero.getActiveZoteroPane().getSelectedItems()` to get selected items
- Use `Zotero.Prefs.get/set()` with `true` as second parameter for extension prefs
- Use `doc.createXULElement()` for creating menu items
- Use `Zotero.ProgressWindow` for progress notifications
- Preferences pane uses XUL `<vbox>` root with `xmlns:html` for HTML inputs

### Icon Handling (IMPORTANT)

**Icons in `manifest.json` must be at the XPI root level**, not in subdirectories:

```json
"icons": {
    "48": "icon.png",
    "96": "icon@2x.png"
}
```

❌ **Wrong**: `"48": "content/icons/icon.png"` - Will not display in addon manager  
✅ **Correct**: `"48": "icon.png"` - Icon at XPI root level

For the preferences pane icon, use `rootURI`:
```javascript
Zotero.PreferencePanes.register({
    // ...
    image: this.rootURI + "icon.png"
});
```

**Troubleshooting icon not showing**:
1. Ensure icon files are at XPI root (not in subdirectories)
2. Completely remove old plugin from Zotero before reinstalling
3. Restart Zotero (icons may be cached by plugin ID)

### Python Path Detection (Windows)

The `findPythonExecutable()` function searches for Python in this order:
1. **`where` command** - Most reliable for finding Python in PATH
2. **User installations** - `%LOCALAPPDATA%\Programs\Python\Python3XX\python.exe`
3. **Microsoft Store Python** - `%LOCALAPPDATA%\Microsoft\WindowsApps\python*.exe`
4. **System-wide** - `C:\Python3XX\`, `C:\Program Files\Python3XX\`
5. **Anaconda/Miniconda** - User and system-wide installations
6. **pyenv-win** - `%USERPROFILE%\.pyenv\pyenv-win\`
7. **Scoop** - `%USERPROFILE%\scoop\apps\python\`
8. **Chocolatey** - `C:\tools\python\`
9. **Windows Python Launcher** - `C:\Windows\py.exe`

Windows Store Python stubs in `WindowsApps` (that just redirect to the Store) are automatically skipped.

### Server Auto-Start

The plugin auto-starts the OCR server using `nsIProcess` (not `Zotero.Utilities.Internal.subprocess`):

1. Creates a temp Python script at `%TEMP%\Zotero\mistral_ocr_start.py`
2. Creates a log file at `%TEMP%\Zotero\mistral_ocr_server.log` for debugging
3. Sets environment variables:
   - `MISTRAL_API_KEY` - from plugin preferences
   - `ZOTERO_LIBRARY_ID` - from plugin preferences (required by pyzotero)
   - `ZOTERO_API_KEY` - from plugin preferences (required by pyzotero)
   - `ZOTERO_LOCAL` - set to "true" for local Zotero server access
4. On Windows: Creates a VBScript launcher (`mistral_ocr_launcher.vbs`) to run Python hidden (no console window)
5. Polls `/health` endpoint for up to 20 seconds
6. Logs server output after 5 seconds and at timeout for debugging

**Hidden Console Window (Windows):**
On Windows, the plugin uses a VBScript wrapper to launch Python without showing a console window:
- Creates `%TEMP%\Zotero\mistral_ocr_launcher.vbs`
- Runs via `wscript.exe` which hides the Python console

**Why nsIProcess instead of subprocess?**
- `Zotero.Utilities.Internal.subprocess()` can fail silently on Windows
- `nsIProcess` provides more reliable background process launching
- Allows capturing stderr to log file for debugging

### Required Credentials

The plugin requires the following credentials to be configured in Edit > Settings > Mistral OCR:

1. **Zotero Library ID** - Your Zotero user ID (find at zotero.org/settings/keys)
2. **Zotero API Key** - Create at zotero.org/settings/keys/new (needs read/write access)
3. **Mistral API Key** - Get from console.mistral.ai

**Note:** Even though `ZOTERO_LOCAL=true` is set (using Zotero's local HTTP server), pyzotero still requires the Library ID and API Key parameters.

### Using Virtual Environments

If you use a virtual environment for the `mistral-ocr-zotero` Python package:

1. **Install the package in your venv** (one-time):
   ```powershell
   & "c:\users\matti\venvs\mistral-ocr-zotero\Scripts\python.exe" -m pip install -e "path\to\MistralOCR_Zotero"
   ```

2. **Configure Zotero to use the venv Python**:
   - Go to Edit → Settings → Mistral OCR
   - Set **Python Path** to: `c:\users\matti\venvs\mistral-ocr-zotero\Scripts\python.exe`
   - Click Save Settings

This ensures the plugin uses the correct Python with all dependencies installed.

**Note**: The venv at `c:\users\matti\venvs\mistral-ocr-zotero` already has the package installed as an editable install pointing to `Dev\MistralOCR_Zotero`.

### Debugging

View plugin logs in Zotero: Help > Debug Output Logging > View Output
All log messages are prefixed with "Mistral OCR: "

**Server startup debugging**:
- Check `%TEMP%\Zotero\mistral_ocr_server.log` for Python errors
- Common issues:
  - `ImportError` - mistral-ocr-zotero package not installed
  - No Python found - Check Python installation and PATH
  - Port in use - Another process using port 8080

### Preferences Pane Not Showing

If the "Mistral OCR" preferences pane doesn't appear in Zotero Settings, or you see errors like:
```
Error opening input stream (invalid filename?): jar:file:///...mistral-ocr@zotero.org.xpi!/content/preferences.js
```

**Solution - Delete Zotero's Startup Cache:**

1. **Close Zotero completely** (check Task Manager)
2. Delete the startup cache folder:
   ```
   %LOCALAPPDATA%\Zotero\Zotero\Profiles\<profile-name>\startupCache
   ```
   Or in PowerShell:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Zotero\Zotero\Profiles\*\startupCache"
   ```
3. Restart Zotero

**Why this happens:**
Zotero 7 has a known bug where `loadSubScript()` calls are cached even after plugin updates. Deleting the startup cache forces Zotero to reload all scripts fresh.

**Additional troubleshooting:**

1. **Completely remove and reinstall the plugin**:
   - Go to Tools > Add-ons
   - Find "Mistral OCR" and click Remove
   - **Restart Zotero completely**
   - Install the new XPI

2. **Use the Python build script** (not PowerShell Compress-Archive):
   ```powershell
   python build_xpi.py
   ```
   PowerShell's `Compress-Archive` creates ZIP files that may have compatibility issues with Zotero's JAR reader.

3. **Check the debug log** for errors:
   - "Failed to register preferences pane"
   - Any errors loading `preferences.xhtml` or `preferences.js`

4. **Common code issues**:
   - Objects in preferences.js must use `var` (not `let`/`const`) to be accessible from XHTML onload attributes
   - Syntax errors in preferences.xhtml or preferences.js
   - Incorrect paths in `PreferencePanes.register()` - use `this.rootURI + "content/preferences.xhtml"` format

