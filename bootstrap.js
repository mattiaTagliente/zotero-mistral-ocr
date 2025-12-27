/**
 * Mistral OCR Zotero Plugin
 * Adds context menu to process PDF attachments with Mistral OCR
 */

var MistralOCR;

function log(msg) {
    Zotero.debug("Mistral OCR: " + msg);
}

function install(data, reason) {
    log("Plugin installed");
}

function uninstall(data, reason) {
    log("Plugin uninstalled");
}

async function startup({ id, version, resourceURI, rootURI }, reason) {
    log("Plugin starting up, version " + version);

    // Wait for Zotero to be ready
    await Zotero.initializationPromise;

    // Register preferences defaults
    registerPrefs();

    // Initialize the plugin
    MistralOCR = {
        id: id,
        version: version,
        rootURI: rootURI,
        menuId: "mistral-ocr-menu-process",
        serverProcess: null,
        prefsPaneId: null,

        // Get preference value
        getPref: function(name) {
            return Zotero.Prefs.get("extensions.mistral-ocr." + name, true);
        },

        // Set preference value
        setPref: function(name, value) {
            return Zotero.Prefs.set("extensions.mistral-ocr." + name, value, true);
        },

        // Get server URL
        getServerUrl: function() {
            const host = this.getPref("serverHost") || "127.0.0.1";
            const port = this.getPref("serverPort") || 8080;
            return `http://${host}:${port}`;
        },

        // Check if server is running
        checkServer: async function() {
            try {
                const response = await fetch(this.getServerUrl() + "/health", {
                    method: "GET",
                    headers: { "Accept": "application/json" }
                });
                if (response.ok) {
                    const data = await response.json();
                    return data.status === "ok";
                }
                return false;
            } catch (e) {
                log("Server check failed: " + e.message);
                return false;
            }
        },

        // Start the OCR server
        startServer: async function() {
            log("Attempting to start OCR server...");

            // Check if already running
            if (await this.checkServer()) {
                log("Server already running");
                return true;
            }

            // Get Mistral API key from preferences
            const apiKey = this.getPref("mistralApiKey");
            if (!apiKey) {
                this.showError("Mistral API key not configured.\n\nPlease go to:\nEdit > Settings > Mistral OCR\n\nAnd enter your API key from console.mistral.ai");
                return false;
            }

            try {
                // Get Python path from preferences or use default
                let pythonPath = this.getPref("pythonPath");
                if (!pythonPath) {
                    // Try common Python paths on Windows
                    pythonPath = "python";
                }

                log("Starting server with Python: " + pythonPath);

                // Create a temporary Python script to start the server
                const tempDir = Zotero.getTempDirectory().path;
                const scriptPath = OS.Path.join(tempDir, "mistral_ocr_start.py");

                // Escape backslashes and quotes in API key for Python string
                const escapedApiKey = apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

                const startScript = `
import os
import sys

# Set environment variables
os.environ["MISTRAL_API_KEY"] = "${escapedApiKey}"
os.environ["ZOTERO_LOCAL"] = "true"

# Start the server
try:
    from mistral_ocr_zotero.server import main
    main()
except ImportError as e:
    print(f"Error: Could not import mistral_ocr_zotero: {e}", file=sys.stderr)
    print("Please install with: pip install mistral-ocr-zotero", file=sys.stderr)
    sys.exit(1)
`;

                await Zotero.File.putContentsAsync(scriptPath, startScript);

                // Start the server process in background using Zotero's subprocess
                const startInfo = {
                    command: pythonPath,
                    arguments: [scriptPath],
                    workdir: tempDir
                };

                // Use subprocess to start Python in background
                Zotero.Utilities.Internal.subprocess(startInfo).catch(e => {
                    log("Server subprocess error (may be normal if process continues): " + e);
                });

                // Wait for server to start (up to 15 seconds)
                log("Waiting for server to start...");
                for (let i = 0; i < 15; i++) {
                    await Zotero.Promise.delay(1000);
                    if (await this.checkServer()) {
                        log("Server started successfully after " + (i + 1) + " seconds");
                        return true;
                    }
                    log("Server not ready yet, attempt " + (i + 1));
                }

                log("Server failed to start within timeout");
                this.showError("OCR server failed to start within 15 seconds.\n\nPlease check:\n1. Python is installed and in PATH\n2. mistral-ocr-zotero package is installed\n3. Check Zotero debug log for details");
                return false;
            } catch (e) {
                log("Failed to start server: " + e.message);
                this.showError("Failed to start OCR server:\n\n" + e.message);
                return false;
            }
        },

        // Show error message
        showError: function(message) {
            const ps = Services.prompt;
            ps.alert(null, "Mistral OCR Error", message);
        },

        // Show progress window
        showProgress: function(title) {
            const progressWindow = new Zotero.ProgressWindow({ closeOnClick: false });
            progressWindow.changeHeadline(title || "Mistral OCR");
            progressWindow.show();
            return progressWindow;
        },

        // Process selected items
        processItems: async function() {
            const zoteroPane = Zotero.getActiveZoteroPane();
            const selectedItems = zoteroPane.getSelectedItems();

            if (!selectedItems.length) {
                this.showError("No items selected.");
                return;
            }

            // Filter to regular items (not attachments)
            const items = selectedItems.filter(item => item.isRegularItem());

            if (!items.length) {
                this.showError("Please select library items (not attachments).");
                return;
            }

            const itemKeys = items.map(item => item.key);
            log("Processing " + itemKeys.length + " items: " + itemKeys.join(", "));

            // Show progress
            const progressWindow = this.showProgress("Mistral OCR");
            const itemProgress = new progressWindow.ItemProgress(
                "chrome://zotero/skin/spinner-16px.png",
                "Connecting to OCR server..."
            );

            // Check/start server (auto-start is always enabled now)
            let serverRunning = await this.checkServer();

            if (!serverRunning) {
                itemProgress.setText("Starting OCR server...");
                serverRunning = await this.startServer();

                if (!serverRunning) {
                    itemProgress.setIcon("chrome://zotero/skin/cross.png");
                    itemProgress.setText("Failed to start OCR server");
                    progressWindow.startCloseTimer(8000);
                    return;
                }
            }

            try {
                // Submit OCR request
                itemProgress.setText("Submitting " + itemKeys.length + " item(s) for OCR processing...");

                const response = await fetch(this.getServerUrl() + "/ocr", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        item_keys: itemKeys,
                        force: false
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error("Server returned " + response.status + ": " + errorText);
                }

                const result = await response.json();
                const jobId = result.job_id;

                log("Job submitted: " + jobId + ", items queued: " + result.items_queued);

                // Poll for status
                let completed = false;
                let lastStatus = null;

                while (!completed) {
                    await Zotero.Promise.delay(2000);

                    const statusResponse = await fetch(this.getServerUrl() + "/status/" + jobId, {
                        method: "GET",
                        headers: { "Accept": "application/json" }
                    });

                    if (!statusResponse.ok) {
                        throw new Error("Failed to get job status");
                    }

                    const status = await statusResponse.json();
                    lastStatus = status;

                    log("Job status: " + JSON.stringify(status));

                    // Update progress
                    const progressText = "Processing " + status.completed + "/" + status.total + " items";
                    if (status.current_item) {
                        itemProgress.setText(progressText + " (current: " + status.current_item + ")");
                    } else {
                        itemProgress.setText(progressText);
                    }

                    if (status.status === "completed" || status.status === "failed") {
                        completed = true;
                    }
                }

                // Show final result
                if (lastStatus.status === "completed") {
                    itemProgress.setIcon("chrome://zotero/skin/tick.png");
                    let message = "Processed " + lastStatus.completed + "/" + lastStatus.total + " items";
                    if (lastStatus.errors && lastStatus.errors.length > 0) {
                        message += " (" + lastStatus.errors.length + " errors)";
                    }
                    itemProgress.setText(message);
                } else {
                    itemProgress.setIcon("chrome://zotero/skin/cross.png");
                    const errorMsg = lastStatus.errors && lastStatus.errors.length > 0
                        ? lastStatus.errors[0]
                        : "Unknown error";
                    itemProgress.setText("Failed: " + errorMsg);
                }

                progressWindow.startCloseTimer(5000);

            } catch (e) {
                log("Error processing items: " + e.message);
                itemProgress.setIcon("chrome://zotero/skin/cross.png");
                itemProgress.setText("Error: " + e.message);
                progressWindow.startCloseTimer(8000);
            }
        },

        // Add context menu item
        addMenuItem: function(doc) {
            const menuPopup = doc.getElementById("zotero-itemmenu");
            if (!menuPopup) {
                log("Could not find zotero-itemmenu");
                return;
            }

            // Remove existing menu item if present
            const existing = doc.getElementById(this.menuId);
            if (existing) {
                existing.remove();
            }

            // Create menu item
            const menuItem = doc.createXULElement("menuitem");
            menuItem.id = this.menuId;
            menuItem.setAttribute("label", "Process with Mistral OCR");
            menuItem.setAttribute("accesskey", "M");
            menuItem.addEventListener("command", () => this.processItems());

            // Add separator before our item
            const separator = doc.createXULElement("menuseparator");
            separator.id = "mistral-ocr-menu-separator";

            menuPopup.appendChild(separator);
            menuPopup.appendChild(menuItem);

            log("Menu item added");
        },

        // Remove context menu item
        removeMenuItem: function(doc) {
            const menuItem = doc.getElementById(this.menuId);
            if (menuItem) {
                menuItem.remove();
            }
            const separator = doc.getElementById("mistral-ocr-menu-separator");
            if (separator) {
                separator.remove();
            }
        },

        // Register preferences pane
        registerPrefsPane: async function() {
            log("Registering preferences pane");
            try {
                this.prefsPaneId = await Zotero.PreferencePanes.register({
                    pluginID: this.id,
                    src: this.rootURI + "content/preferences.xhtml",
                    label: "Mistral OCR",
                    image: this.rootURI + "content/icons/icon.png"
                });
                log("Preferences pane registered with ID: " + this.prefsPaneId);
            } catch (e) {
                log("Failed to register preferences pane: " + e);
            }
        },

        // Initialize on window load
        onMainWindowLoad: function({ window }) {
            log("Main window loaded");
            this.addMenuItem(window.document);
        },

        // Cleanup on window unload
        onMainWindowUnload: function({ window }) {
            log("Main window unloaded");
            this.removeMenuItem(window.document);
        }
    };

    // Register preferences pane
    await MistralOCR.registerPrefsPane();

    // Register window listeners
    Zotero.getMainWindows().forEach(win => {
        MistralOCR.onMainWindowLoad({ window: win });
    });

    // Listen for new windows
    Services.wm.addListener({
        onOpenWindow: function(xulWindow) {
            const domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindow);
            domWindow.addEventListener("load", function listener() {
                domWindow.removeEventListener("load", listener);
                if (domWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
                    MistralOCR.onMainWindowLoad({ window: domWindow });
                }
            });
        },
        onCloseWindow: function(xulWindow) {},
        onWindowTitleChange: function(xulWindow, newTitle) {}
    });

    log("Plugin startup complete");
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
    log("Plugin shutting down");

    if (MistralOCR) {
        // Unregister preferences pane
        if (MistralOCR.prefsPaneId) {
            Zotero.PreferencePanes.unregister(MistralOCR.prefsPaneId);
        }

        // Cleanup windows
        Zotero.getMainWindows().forEach(win => {
            MistralOCR.onMainWindowUnload({ window: win });
        });
    }

    MistralOCR = null;
}

function registerPrefs() {
    const branch = Services.prefs.getDefaultBranch("extensions.mistral-ocr.");
    branch.setCharPref("serverHost", "127.0.0.1");
    branch.setIntPref("serverPort", 8080);
    branch.setCharPref("mistralApiKey", "");
    branch.setCharPref("pythonPath", "");
}
