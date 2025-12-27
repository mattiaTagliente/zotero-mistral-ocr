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
                this.showError("Mistral API key not configured. Please set it in Tools > Mistral OCR Settings.");
                return false;
            }

            try {
                // Try to start the server using the CLI command
                const pythonPath = this.getPref("pythonPath") || "python";

                // Use Zotero's subprocess utility to run the server
                // The server will run with environment variables set
                const env = {
                    "MISTRAL_API_KEY": apiKey,
                    "ZOTERO_LOCAL": "true"
                };

                // For Windows, we need to spawn the process differently
                const isWin = Zotero.isWin;

                if (isWin) {
                    // On Windows, use cmd to spawn the server in background
                    const startScript = `
                        import os
                        import sys
                        os.environ["MISTRAL_API_KEY"] = "${apiKey.replace(/"/g, '\\"')}"
                        os.environ["ZOTERO_LOCAL"] = "true"
                        from mistral_ocr_zotero.server import main
                        main()
                    `;

                    // Write a temporary Python script
                    const tempDir = Zotero.getTempDirectory().path;
                    const scriptPath = OS.Path.join(tempDir, "mistral_ocr_start.py");
                    await Zotero.File.putContentsAsync(scriptPath, startScript);

                    // Start the server process in background
                    Zotero.Utilities.Internal.exec(pythonPath, [scriptPath], {
                        background: true,
                        noWait: true
                    }).catch(e => log("Server process error: " + e));
                } else {
                    // On Unix-like systems
                    const args = ["-m", "mistral_ocr_zotero.server"];
                    Zotero.Utilities.Internal.exec(pythonPath, args, {
                        background: true,
                        noWait: true,
                        env: env
                    }).catch(e => log("Server process error: " + e));
                }

                // Wait for server to start
                for (let i = 0; i < 10; i++) {
                    await Zotero.Promise.delay(1000);
                    if (await this.checkServer()) {
                        log("Server started successfully");
                        return true;
                    }
                }

                log("Server failed to start within timeout");
                return false;
            } catch (e) {
                log("Failed to start server: " + e.message);
                this.showError("Failed to start OCR server: " + e.message);
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

            // Check/start server
            let serverRunning = await this.checkServer();

            if (!serverRunning) {
                itemProgress.setText("Starting OCR server...");
                const autoStart = this.getPref("autoStartServer");

                if (autoStart) {
                    serverRunning = await this.startServer();
                }

                if (!serverRunning) {
                    itemProgress.setIcon("chrome://zotero/skin/cross.png");
                    itemProgress.setText("OCR server not available. Please start it manually or configure auto-start.");
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

        // Add preferences menu item
        addPrefsMenuItem: function(doc) {
            const toolsMenu = doc.getElementById("menu_ToolsPopup");
            if (!toolsMenu) {
                log("Could not find Tools menu");
                return;
            }

            // Remove existing if present
            const existing = doc.getElementById("mistral-ocr-prefs-menuitem");
            if (existing) {
                existing.remove();
            }

            // Create menu item
            const menuItem = doc.createXULElement("menuitem");
            menuItem.id = "mistral-ocr-prefs-menuitem";
            menuItem.setAttribute("label", "Mistral OCR Settings...");
            menuItem.addEventListener("command", () => this.openPreferences());

            toolsMenu.appendChild(menuItem);
            log("Preferences menu item added");
        },

        // Remove preferences menu item
        removePrefsMenuItem: function(doc) {
            const menuItem = doc.getElementById("mistral-ocr-prefs-menuitem");
            if (menuItem) {
                menuItem.remove();
            }
        },

        // Open preferences dialog
        openPreferences: function() {
            const win = Services.wm.getMostRecentWindow("navigator:browser");
            win.openDialog(
                this.rootURI + "content/preferences.xhtml",
                "mistral-ocr-preferences",
                "chrome,titlebar,toolbar,centerscreen,modal",
                { plugin: this }
            );
        },

        // Initialize on window load
        onMainWindowLoad: function({ window }) {
            log("Main window loaded");
            this.addMenuItem(window.document);
            this.addPrefsMenuItem(window.document);
        },

        // Cleanup on window unload
        onMainWindowUnload: function({ window }) {
            log("Main window unloaded");
            this.removeMenuItem(window.document);
            this.removePrefsMenuItem(window.document);
        }
    };

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
    branch.setBoolPref("autoStartServer", true);
    branch.setCharPref("pythonPath", "");
}
