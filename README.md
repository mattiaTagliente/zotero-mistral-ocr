# Zotero Mistral OCR Plugin

A Zotero 7 plugin that adds a right-click context menu to process PDF attachments with Mistral OCR, creating high-quality markdown conversions with properly formatted figures, equations, and tables.

## Features

- **Right-click context menu** - Process single or multiple items with Mistral OCR
- **Background processing** - Jobs run asynchronously with progress tracking
- **Preferences UI** - Configure API key and server settings through Tools menu
- **Auto-start server** - Optionally auto-start the OCR server when needed

## Requirements

- **Zotero 7.0+** (required)
- **Mistral OCR Server** - Python package `mistral-ocr-zotero` must be installed
- **Mistral API Key** - Get one from [console.mistral.ai](https://console.mistral.ai)

## Installation

### 1. Install the OCR Server (Python package)

```bash
pip install mistral-ocr-zotero
```

Or install from source:
```bash
git clone https://github.com/yourusername/mistral-ocr-zotero.git
cd mistral-ocr-zotero
pip install -e .
```

### 2. Install the Zotero Plugin

1. Download the latest `zotero-mistral-ocr.xpi` from [Releases](https://github.com/yourusername/zotero-mistral-ocr/releases)
2. In Zotero, go to **Tools > Add-ons**
3. Click the gear icon and select **Install Add-on From File...**
4. Select the downloaded `.xpi` file

### 3. Configure the Plugin

1. Go to **Tools > Mistral OCR Settings...**
2. Enter your Mistral API key
3. (Optional) Configure server host/port if not using defaults
4. Click **Save**

## Usage

1. Select one or more items in your Zotero library
2. Right-click and select **Process with Mistral OCR**
3. The plugin will:
   - Start the OCR server if not running (if auto-start is enabled)
   - Submit items for processing
   - Show progress in a notification window
   - Create `[Mistral-OCR]` attachments with the markdown conversion

## Manual Server Start

If auto-start is disabled, start the server manually before processing:

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
| Mistral API Key | Your Mistral AI API key | (required) |
| Server Host | OCR server hostname | 127.0.0.1 |
| Server Port | OCR server port | 8080 |
| Auto-start server | Start server automatically when needed | true |
| Python Path | Path to Python executable | (uses PATH) |

## Building from Source

To build the XPI package:

```bash
cd zotero-mistral-ocr
./build.sh
```

Or manually:
```bash
zip -r zotero-mistral-ocr.xpi manifest.json bootstrap.js prefs.js content/ locale/
```

## Troubleshooting

### "OCR server not available"

1. Check if the server is running: `curl http://127.0.0.1:8080/health`
2. Verify Python and mistral-ocr-zotero are installed
3. Try starting the server manually (see above)

### "Mistral API key not configured"

Go to **Tools > Mistral OCR Settings...** and enter your API key.

### Processing shows errors

Check the Zotero debug output (**Help > Debug Output Logging > View Output**) for detailed error messages.

## License

MIT License - see [LICENSE](LICENSE) file.

## Related Projects

- [mistral-ocr-zotero](https://github.com/yourusername/mistral-ocr-zotero) - Python package for Mistral OCR integration with Zotero
