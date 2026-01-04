# Zotero Mistral OCR Plugin

A Zotero 7 plugin that adds a right-click context menu to process PDF attachments with Mistral OCR, creating high-quality markdown conversions with properly formatted figures, equations, and tables.

## Features

- **Right-click context menu** - Process single or multiple items with Mistral OCR
- **Background processing** - Jobs run asynchronously with progress tracking
- **Preferences UI** - Configure API key and server settings through Zotero preferences
- **Auto-start server** - Automatically starts the OCR server when needed

## Requirements

- **Zotero 7.0+** (required)
- **Python 3.9+** with `mistral-ocr-zotero` package installed
- **Mistral API Key** - Get one from [console.mistral.ai](https://console.mistral.ai)
- **Zotero API Credentials** - Required for accessing your library:
  - **Library ID** - Your user ID from [zotero.org/settings/keys](https://www.zotero.org/settings/keys)
  - **API Key** - Create at [zotero.org/settings/keys/new](https://www.zotero.org/settings/keys/new) (with read/write access)

## Installation

### 1. Install the OCR Server (Python package)

**Option A: Using a virtual environment (recommended)**

```powershell
# Create and activate a virtual environment
python -m venv c:\users\%USERNAME%\venvs\mistral-ocr-zotero
& c:\users\%USERNAME%\venvs\mistral-ocr-zotero\Scripts\Activate.ps1

# Install from source (editable mode for development)
pip install -e "path\to\MistralOCR_Zotero"
```

**Option B: Global installation**

```bash
pip install mistral-ocr-zotero
```

### 2. Install the Zotero Plugin

1. Download the latest `zotero-mistral-ocr.xpi` from [Releases](https://github.com/mattiaTagliente/zotero-plugin-mistral-ocr/releases)
2. In Zotero, go to **Tools > Add-ons**
3. Click the gear icon and select **Install Add-on From File...**
4. Select the downloaded `.xpi` file

### 3. Configure the Plugin

1. Go to **Edit > Settings > Mistral OCR**
2. Enter your **Zotero API credentials**:
   - **Library ID** - Find your user ID at [zotero.org/settings/keys](https://www.zotero.org/settings/keys)
   - **API Key** - Create at [zotero.org/settings/keys/new](https://www.zotero.org/settings/keys/new) (needs read/write access)
3. Enter your **Mistral API key** from [console.mistral.ai](https://console.mistral.ai)
4. **If using a virtual environment**, set the Python Path to your venv's python:
   ```
   c:\users\YOUR_USERNAME\venvs\mistral-ocr-zotero\Scripts\python.exe
   ```
5. Click **Save Settings**

## Usage

1. Select one or more items in your Zotero library
2. Right-click and select **Process with Mistral OCR**
3. The plugin will:
   - Start the OCR server if not running
   - Submit items for processing
   - Show progress in a notification window
   - Create `[Mistral-OCR]` attachments with the markdown conversion

## Manual Server Start

If you prefer to start the server manually:

```bash
# Set your Mistral API key
export MISTRAL_API_KEY=your-api-key-here

# Start the server
mistral-ocr-server
```

The server runs on `http://127.0.0.1:8080` by default.

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| Zotero Library ID | Your Zotero user ID (from zotero.org/settings/keys) | (required) |
| Zotero API Key | Your Zotero API key (with read/write access) | (required) |
| Mistral API Key | Your Mistral AI API key | (required) |
| Server Host | OCR server hostname | 127.0.0.1 |
| Server Port | OCR server port | 8080 |
| Python Path | Path to Python executable | (auto-detected) |

## Building from Source

### Using Python (Recommended)

```powershell
python build_xpi.py
```

This creates a properly structured XPI that works with Zotero's JAR reader.

### Using bash (Git Bash / WSL)

```bash
./build.sh
```

### Using PowerShell (Windows)

> **Note:** PowerShell's `Compress-Archive` may create ZIP files with compatibility issues. Use the Python script instead if you encounter "Error opening input stream" errors.

```powershell
if (Test-Path zotero-mistral-ocr.xpi) { Remove-Item zotero-mistral-ocr.xpi }
Compress-Archive -Path manifest.json, bootstrap.js, prefs.js, content, locale, icon.png, "icon@2x.png" -DestinationPath zotero-mistral-ocr.zip -Force
Rename-Item zotero-mistral-ocr.zip zotero-mistral-ocr.xpi
```

### Manual zip

```bash
zip -r zotero-mistral-ocr.xpi manifest.json bootstrap.js prefs.js content/ locale/ icon.png icon@2x.png
```

## Troubleshooting

### "OCR server not available"

1. Check if the server is running: `curl http://127.0.0.1:8080/health`
2. Verify Python and mistral-ocr-zotero are installed in the configured Python environment
3. If using a venv, make sure the Python Path is set correctly in Zotero preferences
4. Check `%TEMP%\Zotero\mistral_ocr_server.log` for error details

### "ZOTERO_LIBRARY_ID and ZOTERO_API_KEY must be provided"

This error means Zotero credentials are not configured:

1. Go to **Edit > Settings > Mistral OCR**
2. Enter your **Library ID** (user ID from [zotero.org/settings/keys](https://www.zotero.org/settings/keys))
3. Enter your **Zotero API Key** (create at [zotero.org/settings/keys/new](https://www.zotero.org/settings/keys/new))
4. Click **Save Settings**
5. **Important**: If the server was already running, you need to kill it and try again:
   ```powershell
   # Find and kill the server process
   netstat -ano | findstr :8080
   # Kill the process using the PID from the output
   Stop-Process -Id <PID> -Force
   ```
   Then try processing again - the plugin will start a fresh server with the new credentials.

### "Mistral API key not configured"

Go to **Edit > Settings > Mistral OCR** and enter your API key.

### "No module named 'mistral_ocr_zotero'"

The Python package is not installed in the Python environment the plugin is using:
1. Check which Python the plugin is using (see Zotero debug log)
2. Install the package in that Python: `python -m pip install -e "path\to\MistralOCR_Zotero"`
3. Or configure the plugin to use a different Python (one with the package installed)

### Processing shows errors

Check the Zotero debug output (**Help > Debug Output Logging > View Output**) for detailed error messages.

### Preferences pane not showing

If the "Mistral OCR" settings pane doesn't appear in Zotero Settings:

1. **Close Zotero completely** (check Task Manager)
2. Delete Zotero's startup cache:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Zotero\Zotero\Profiles\*\startupCache"
   ```
3. Restart Zotero

This fixes a known Zotero 7 bug where plugin scripts are cached even after updates.

## License

MIT License - see [LICENSE](LICENSE) file.

## Related Projects

- [MistralOCR_Zotero](https://github.com/mattiaTagliente/MistralOCR_Zotero) - Python server for Mistral OCR integration with Zotero
