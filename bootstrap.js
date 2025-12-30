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

    // Initialize the plugin early so diagnostics can run before full init
    MistralOCR = {
        id: id,
        version: version,
        rootURI: rootURI,
        menuId: "mistral-ocr-menu-process",
        serverProcess: null,
        prefsPaneId: null,
        fileGetContentsOriginal: null,

        // Get preference value
        getPref: function (name) {
            return Zotero.Prefs.get("extensions.mistral-ocr." + name, true);
        },

        // Set preference value
        setPref: function (name, value) {
            return Zotero.Prefs.set("extensions.mistral-ocr." + name, value, true);
        },

        // Get server URL
        getServerUrl: function () {
            const host = this.getPref("serverHost") || "127.0.0.1";
            const port = this.getPref("serverPort") || 8080;
            return `http://${host}:${port}`;
        },

        // Check if server is running
        checkServer: async function () {
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

        // Add extra logging for getContentsFromURL errors
        installDiagnostics: function () {
            if (!Zotero.File || !Zotero.File.getContentsFromURL) {
                return;
            }
            if (this.fileGetContentsOriginal) {
                return;
            }

            this.fileGetContentsOriginal = Zotero.File.getContentsFromURL;
            Zotero.File.getContentsFromURL = (url) => {
                try {
                    return this.fileGetContentsOriginal.call(Zotero.File, url);
                } catch (e) {
                    try {
                        Zotero.logError(new Error("Mistral OCR: getContentsFromURL failed for: " + url));
                        Zotero.logError(e);
                    } catch (logError) { }
                    log("getContentsFromURL failed for: " + url + " (" + e + ")");
                    throw e;
                }
            };
        },

        // Find Python executable on the system
        findPythonExecutable: async function () {
            log("Searching for Python executable...");

            // Get user home directory
            const homeDir = Services.dirsvc.get("Home", Ci.nsIFile).path;
            log("Home directory: " + homeDir);

            // Helper function to check if a file exists and is executable
            const fileExists = (path) => {
                try {
                    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
                    file.initWithPath(path);
                    return file.exists();
                } catch (e) {
                    return false;
                }
            };

            // Helper function to run a command and capture output
            const runCommand = async (command, args) => {
                return new Promise((resolve, reject) => {
                    try {
                        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);

                        // For Windows, we need to run through cmd.exe
                        if (Zotero.isWin) {
                            file.initWithPath("C:\\Windows\\System32\\cmd.exe");
                            args = ["/c", command, ...args];
                        } else {
                            file.initWithPath("/bin/sh");
                            args = ["-c", command + " " + args.join(" ")];
                        }

                        const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
                        process.init(file);

                        // Create a temp file to capture output
                        const tempDir = Zotero.getTempDirectory();
                        const outputFile = tempDir.clone();
                        outputFile.append("python_search_output_" + Date.now() + ".txt");

                        const fullArgs = Zotero.isWin
                            ? ["/c", command + " " + args.slice(2).join(" ") + " > \"" + outputFile.path + "\" 2>&1"]
                            : ["-c", command + " " + args.join(" ") + " > \"" + outputFile.path + "\" 2>&1"];

                        process.run(true, fullArgs, fullArgs.length);

                        // Read output
                        if (outputFile.exists()) {
                            const output = Zotero.File.getContents(outputFile);
                            outputFile.remove(false);
                            resolve(output.trim());
                        } else {
                            resolve("");
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            };

            // Try 'where' command on Windows to find Python in PATH
            if (Zotero.isWin) {
                log("Trying 'where' command to find Python in PATH...");
                for (const pythonName of ["python", "python3", "py"]) {
                    try {
                        const output = await runCommand("where", [pythonName]);
                        if (output) {
                            const paths = output.split(/\r?\n/).filter(p => p.trim());
                            for (const pythonPath of paths) {
                                const trimmedPath = pythonPath.trim();
                                // Skip Windows Store stubs (they're just redirectors)
                                if (trimmedPath.includes("WindowsApps") && !trimmedPath.includes("PythonSoftwareFoundation")) {
                                    log("Skipping Windows Store stub: " + trimmedPath);
                                    continue;
                                }
                                if (fileExists(trimmedPath)) {
                                    log("Found Python via 'where " + pythonName + "': " + trimmedPath);
                                    return trimmedPath;
                                }
                            }
                        }
                    } catch (e) {
                        log("'where " + pythonName + "' failed: " + e.message);
                    }
                }
            }

            // Build comprehensive list of candidate paths
            const candidates = [];

            // User-specific Python installations (Windows) - check many versions
            for (const ver of ["313", "312", "311", "310", "39", "38"]) {
                candidates.push(homeDir + "\\AppData\\Local\\Programs\\Python\\Python" + ver + "\\python.exe");
            }

            // Microsoft Store Python installations
            const localAppData = homeDir + "\\AppData\\Local";
            try {
                const packagesDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
                packagesDir.initWithPath(localAppData + "\\Microsoft\\WindowsApps");
                if (packagesDir.exists()) {
                    // Microsoft Store Python uses versioned executables
                    for (const pyVer of ["python3.13", "python3.12", "python3.11", "python3.10", "python3.9", "python3", "python"]) {
                        const pyPath = localAppData + "\\Microsoft\\WindowsApps\\" + pyVer + ".exe";
                        if (fileExists(pyPath)) {
                            candidates.unshift(pyPath); // Prioritize if found
                        }
                    }
                }
            } catch (e) {
                log("Error checking Microsoft Store Python: " + e.message);
            }

            // System-wide Python installations (Windows)
            for (const ver of ["313", "312", "311", "310", "39", "38"]) {
                candidates.push("C:\\Python" + ver + "\\python.exe");
                candidates.push("C:\\Program Files\\Python" + ver + "\\python.exe");
                candidates.push("C:\\Program Files (x86)\\Python" + ver + "\\python.exe");
            }

            // Anaconda/Miniconda installations
            candidates.push(homeDir + "\\anaconda3\\python.exe");
            candidates.push(homeDir + "\\miniconda3\\python.exe");
            candidates.push(homeDir + "\\Anaconda3\\python.exe");
            candidates.push(homeDir + "\\Miniconda3\\python.exe");
            candidates.push("C:\\ProgramData\\anaconda3\\python.exe");
            candidates.push("C:\\ProgramData\\miniconda3\\python.exe");
            candidates.push("C:\\Anaconda3\\python.exe");
            candidates.push("C:\\Miniconda3\\python.exe");

            // pyenv-win installations
            candidates.push(homeDir + "\\.pyenv\\pyenv-win\\shims\\python.exe");
            candidates.push(homeDir + "\\.pyenv\\pyenv-win\\versions\\3.12.0\\python.exe");
            candidates.push(homeDir + "\\.pyenv\\pyenv-win\\versions\\3.11.0\\python.exe");

            // Scoop installations
            candidates.push(homeDir + "\\scoop\\apps\\python\\current\\python.exe");

            // Chocolatey installations
            candidates.push("C:\\tools\\python3\\python.exe");
            candidates.push("C:\\tools\\python\\python.exe");

            // Windows Python Launcher (py.exe)
            candidates.push("C:\\Windows\\py.exe");

            log("Checking " + candidates.length + " candidate paths...");

            for (const candidate of candidates) {
                try {
                    if (fileExists(candidate)) {
                        log("Found Python at: " + candidate);
                        return candidate;
                    }
                } catch (e) {
                    // Continue to next candidate
                    continue;
                }
            }

            // Last resort: try subprocess with common names (for Unix-like behavior)
            if (!Zotero.isWin) {
                for (const name of ["python3", "python"]) {
                    try {
                        await Zotero.Utilities.Internal.subprocess(name, ["--version"]);
                        log("Found Python in PATH: " + name);
                        return name;
                    } catch (e) {
                        continue;
                    }
                }
            }

            log("No Python executable found after checking all candidates");
            return null;
        },

        // Start the OCR server
        startServer: async function () {
            log("Attempting to start OCR server...");

            // Check if already running
            if (await this.checkServer()) {
                log("Server already running");
                return true;
            }

            // Get Mistral API key from preferences
            const mistralApiKey = this.getPref("mistralApiKey");
            if (!mistralApiKey) {
                this.showError("Mistral API key not configured.\n\nPlease go to:\nEdit > Settings > Mistral OCR\n\nAnd enter your API key from console.mistral.ai");
                return false;
            }

            // Get Zotero credentials from preferences
            const zoteroLibraryId = this.getPref("zoteroLibraryId");
            const zoteroApiKey = this.getPref("zoteroApiKey");
            if (!zoteroLibraryId || !zoteroApiKey) {
                this.showError("Zotero API credentials not configured.\n\nPlease go to:\nEdit > Settings > Mistral OCR\n\nAnd enter your Zotero Library ID and API Key.\n\nYou can find/create these at:\nzotero.org/settings/keys");
                return false;
            }

            try {
                // Get Python path from preferences or try to find it
                let pythonPath = this.getPref("pythonPath");
                if (!pythonPath) {
                    pythonPath = await this.findPythonExecutable();
                    if (!pythonPath) {
                        this.showError("Python executable not found.\n\nPlease configure the Python path in:\nEdit > Settings > Mistral OCR\n\nOr ensure Python is installed and added to PATH.");
                        return false;
                    }
                }

                log("Starting server with Python: " + pythonPath);

                // Create a temporary Python script to start the server
                const tempDir = Zotero.getTempDirectory();
                const scriptFile = tempDir.clone();
                scriptFile.append("mistral_ocr_start.py");
                const scriptPath = scriptFile.path;

                // Create log file path for capturing errors
                const logFile = tempDir.clone();
                logFile.append("mistral_ocr_server.log");
                const logPath = logFile.path;

                // Escape backslashes and quotes in API keys for Python string
                const escapedMistralApiKey = mistralApiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const escapedZoteroLibraryId = zoteroLibraryId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const escapedZoteroApiKey = zoteroApiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                // Escape the log path for Python
                const escapedLogPath = logPath.replace(/\\/g, '\\\\');

                // Python script that logs errors to file for debugging
                const startScript = `
import os
import sys
import traceback

# Redirect output to log file for debugging
log_path = "${escapedLogPath}"
try:
    log_file = open(log_path, "w", encoding="utf-8")
    sys.stdout = log_file
    sys.stderr = log_file
except Exception as e:
    pass  # If we can't open log, continue anyway

print("Starting Mistral OCR server...")
print(f"Python executable: {sys.executable}")
print(f"Python version: {sys.version}")

# Set environment variables
os.environ["MISTRAL_API_KEY"] = "${escapedMistralApiKey}"
os.environ["ZOTERO_LIBRARY_ID"] = "${escapedZoteroLibraryId}"
os.environ["ZOTERO_API_KEY"] = "${escapedZoteroApiKey}"
os.environ["ZOTERO_LOCAL"] = "true"

print("Environment variables set")
print(f"ZOTERO_LIBRARY_ID: {os.environ.get('ZOTERO_LIBRARY_ID', 'NOT SET')}")

# Start the server
try:
    print("Importing mistral_ocr_zotero.server...")
    from mistral_ocr_zotero.server import main
    print("Import successful, starting main()...")
    main()
except ImportError as e:
    print(f"Error: Could not import mistral_ocr_zotero: {e}")
    print("Please install with: pip install mistral-ocr-zotero")
    traceback.print_exc()
    sys.exit(1)
except Exception as e:
    print(f"Error starting server: {e}")
    traceback.print_exc()
    sys.exit(1)
`;

                await Zotero.File.putContentsAsync(scriptPath, startScript);
                log("Created startup script at: " + scriptPath);
                log("Log file will be at: " + logPath);

                // On Windows, use a VBScript wrapper to hide the console window
                let processPath, processArgs;

                if (Zotero.isWin) {
                    // Create a VBScript to launch Python hidden
                    const vbsFile = tempDir.clone();
                    vbsFile.append("mistral_ocr_launcher.vbs");
                    const vbsPath = vbsFile.path;

                    // Escape paths for VBScript
                    const escapedPythonPath = pythonPath.replace(/\\/g, '\\\\');
                    const escapedScriptPath = scriptPath.replace(/\\/g, '\\\\');

                    const vbsScript = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${escapedPythonPath}"" ""${escapedScriptPath}""", 0, False
`;
                    await Zotero.File.putContentsAsync(vbsPath, vbsScript);
                    log("Created VBScript launcher at: " + vbsPath);

                    // Use wscript.exe to run the VBScript
                    processPath = "C:\\Windows\\System32\\wscript.exe";
                    processArgs = [vbsPath];
                } else {
                    // On non-Windows, use Python directly
                    processPath = pythonPath;
                    processArgs = [scriptPath];
                }

                // Use nsIProcess to start in background
                const processFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
                processFile.initWithPath(processPath);

                if (!processFile.exists()) {
                    log("Process executable does not exist: " + processPath);
                    this.showError("Process executable not found at:\n" + processPath);
                    return false;
                }

                const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
                process.init(processFile);

                log("Launching process with args: " + JSON.stringify(processArgs));

                try {
                    // Run non-blocking (false = don't block)
                    process.run(false, processArgs, processArgs.length);
                    log("Process launched successfully");
                } catch (procError) {
                    log("Failed to launch process: " + procError);
                    this.showError("Failed to launch Python process:\n\n" + procError.message);
                    return false;
                }

                // Wait for server to start (up to 20 seconds)
                log("Waiting for server to start...");
                for (let i = 0; i < 20; i++) {
                    await Zotero.Promise.delay(1000);
                    if (await this.checkServer()) {
                        log("Server started successfully after " + (i + 1) + " seconds");
                        return true;
                    }
                    log("Server not ready yet, attempt " + (i + 1));

                    // After 5 seconds, try to read log file for errors
                    if (i === 5) {
                        try {
                            if (logFile.exists()) {
                                const logContents = await Zotero.File.getContentsAsync(logPath);
                                log("Server log after 5s:\n" + logContents);
                            }
                        } catch (e) {
                            // Ignore read errors
                        }
                    }
                }

                // Read log file for error details
                let errorDetails = "";
                try {
                    if (logFile.exists()) {
                        const logContents = await Zotero.File.getContentsAsync(logPath);
                        log("Final server log:\n" + logContents);
                        if (logContents && logContents.includes("Error")) {
                            errorDetails = "\n\nServer log:\n" + logContents.substring(0, 500);
                        }
                    }
                } catch (e) {
                    log("Could not read log file: " + e);
                }

                log("Server failed to start within timeout");
                this.showError("OCR server failed to start within 20 seconds.\n\nPlease check:\n1. Python is installed correctly\n2. mistral-ocr-zotero package is installed (pip install mistral-ocr-zotero)\n3. Check log at: " + logPath + errorDetails);
                return false;
            } catch (e) {
                log("Failed to start server: " + e.message);
                this.showError("Failed to start OCR server:\n\n" + e.message);
                return false;
            }
        },

        // Show error message
        showError: function (message) {
            const ps = Services.prompt;
            ps.alert(null, "Mistral OCR Error", message);
        },

        // Show progress window
        showProgress: function (title) {
            const progressWindow = new Zotero.ProgressWindow({ closeOnClick: false });
            progressWindow.changeHeadline(title || "Mistral OCR");
            progressWindow.show();
            return progressWindow;
        },

        // Process selected items
        processItems: async function () {
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
                    itemProgress.setError();
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
                    itemProgress.setProgress(100);
                    let message = "Processed " + lastStatus.completed + "/" + lastStatus.total + " items";
                    if (lastStatus.errors && lastStatus.errors.length > 0) {
                        message += " (" + lastStatus.errors.length + " errors)";
                    }
                    itemProgress.setText(message);
                } else {
                    itemProgress.setError();
                    const errorMsg = lastStatus.errors && lastStatus.errors.length > 0
                        ? lastStatus.errors[0]
                        : "Unknown error";
                    itemProgress.setText("Failed: " + errorMsg);
                }

                progressWindow.startCloseTimer(5000);

            } catch (e) {
                log("Error processing items: " + e.message);
                itemProgress.setError();
                itemProgress.setText("Error: " + e.message);
                progressWindow.startCloseTimer(8000);
            }
        },

        // Add context menu item
        addMenuItem: function (doc) {
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
        removeMenuItem: function (doc) {
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
        registerPrefsPane: async function () {
            log("Registering preferences pane");
            try {
                this.prefsPaneId = await Zotero.PreferencePanes.register({
                    pluginID: this.id,
                    id: "mistral-ocr-preferences",
                    src: this.rootURI + "content/preferences.xhtml",
                    scripts: [this.rootURI + "content/preferences.js"],
                    label: "Mistral OCR",
                    image: this.rootURI + "icon.png"
                });
                log("Preferences pane registered with ID: " + this.prefsPaneId);
            } catch (e) {
                log("Failed to register preferences pane: " + e);
            }
        },

        // Initialize on window load
        onMainWindowLoad: function ({ window }) {
            log("Main window loaded");
            this.addMenuItem(window.document);
        },

        // Cleanup on window unload
        onMainWindowUnload: function ({ window }) {
            log("Main window unloaded");
            this.removeMenuItem(window.document);
        }
    };

    // Register preferences pane
    MistralOCR.installDiagnostics();

    // Wait for Zotero to be ready
    await Zotero.initializationPromise;

    // Register preferences defaults
    registerPrefs();
    await MistralOCR.registerPrefsPane();

    // Register window listeners
    Zotero.getMainWindows().forEach(win => {
        MistralOCR.onMainWindowLoad({ window: win });
    });

    // Listen for new windows
    Services.wm.addListener({
        onOpenWindow: function (xulWindow) {
            const domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindow);
            domWindow.addEventListener("load", function listener() {
                domWindow.removeEventListener("load", listener);
                if (domWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
                    if (MistralOCR && MistralOCR.onMainWindowLoad) {
                        MistralOCR.onMainWindowLoad({ window: domWindow });
                    }
                }
            });
        },
        onCloseWindow: function (xulWindow) { },
        onWindowTitleChange: function (xulWindow, newTitle) { }
    });

    log("Plugin startup complete");
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
    log("Plugin shutting down");

    if (MistralOCR) {
        if (MistralOCR.fileGetContentsOriginal) {
            Zotero.File.getContentsFromURL = MistralOCR.fileGetContentsOriginal;
            MistralOCR.fileGetContentsOriginal = null;
        }
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
    branch.setCharPref("zoteroLibraryId", "");
    branch.setCharPref("zoteroApiKey", "");
}
