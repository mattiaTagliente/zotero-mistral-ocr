// Mistral OCR Preferences Script

var MistralOCR_Prefs = {
    init: function () {
        Zotero.debug("Mistral OCR: Preferences pane loaded");
        // Load current values into fields
        this.loadPrefs();
    },

    loadPrefs: function () {
        const libraryIdInput = document.getElementById('mistral-ocr-pref-libraryid');
        const zoteroApiKeyInput = document.getElementById('mistral-ocr-pref-zotero-apikey');
        const hostInput = document.getElementById('mistral-ocr-pref-host');
        const portInput = document.getElementById('mistral-ocr-pref-port');
        const apiKeyInput = document.getElementById('mistral-ocr-pref-apikey');
        const pythonInput = document.getElementById('mistral-ocr-pref-python');

        if (libraryIdInput) {
            libraryIdInput.value = Zotero.Prefs.get('extensions.mistral-ocr.zoteroLibraryId', true) || '';
        }
        if (zoteroApiKeyInput) {
            zoteroApiKeyInput.value = Zotero.Prefs.get('extensions.mistral-ocr.zoteroApiKey', true) || '';
        }
        if (hostInput) {
            hostInput.value = Zotero.Prefs.get('extensions.mistral-ocr.serverHost', true) || '127.0.0.1';
        }
        if (portInput) {
            portInput.value = Zotero.Prefs.get('extensions.mistral-ocr.serverPort', true) || 8080;
        }
        if (apiKeyInput) {
            apiKeyInput.value = Zotero.Prefs.get('extensions.mistral-ocr.mistralApiKey', true) || '';
        }
        if (pythonInput) {
            pythonInput.value = Zotero.Prefs.get('extensions.mistral-ocr.pythonPath', true) || '';
        }
    },

    savePrefs: function () {
        const libraryIdInput = document.getElementById('mistral-ocr-pref-libraryid');
        const zoteroApiKeyInput = document.getElementById('mistral-ocr-pref-zotero-apikey');
        const hostInput = document.getElementById('mistral-ocr-pref-host');
        const portInput = document.getElementById('mistral-ocr-pref-port');
        const apiKeyInput = document.getElementById('mistral-ocr-pref-apikey');
        const pythonInput = document.getElementById('mistral-ocr-pref-python');

        if (libraryIdInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.zoteroLibraryId', libraryIdInput.value, true);
        }
        if (zoteroApiKeyInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.zoteroApiKey', zoteroApiKeyInput.value, true);
        }
        if (hostInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.serverHost', hostInput.value, true);
        }
        if (portInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.serverPort', parseInt(portInput.value) || 8080, true);
        }
        if (apiKeyInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.mistralApiKey', apiKeyInput.value, true);
        }
        if (pythonInput) {
            Zotero.Prefs.set('extensions.mistral-ocr.pythonPath', pythonInput.value, true);
        }

        Zotero.debug("Mistral OCR: Preferences saved");
    },

    testConnection: async function () {
        const statusLabel = document.getElementById('mistral-ocr-connection-status');
        const hostInput = document.getElementById('mistral-ocr-pref-host');
        const portInput = document.getElementById('mistral-ocr-pref-port');

        const host = hostInput ? hostInput.value : '127.0.0.1';
        const port = portInput ? portInput.value : 8080;
        const url = 'http://' + host + ':' + port + '/health';

        if (statusLabel) {
            statusLabel.value = 'Testing...';
            statusLabel.style.color = '#666';
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.status === 'ok') {
                    if (statusLabel) {
                        statusLabel.value = 'Connected! Server version: ' + (data.version || 'unknown');
                        statusLabel.style.color = 'green';
                    }
                } else {
                    if (statusLabel) {
                        statusLabel.value = 'Server responded but status not OK';
                        statusLabel.style.color = 'orange';
                    }
                }
            } else {
                if (statusLabel) {
                    statusLabel.value = 'Server error: ' + response.status;
                    statusLabel.style.color = 'red';
                }
            }
        } catch (e) {
            // Server not running - try to start it
            if (statusLabel) {
                statusLabel.value = 'Server not running. Starting...';
                statusLabel.style.color = '#666';
            }

            // Try to start the server using MistralOCR global object
            if (typeof MistralOCR !== 'undefined' && MistralOCR.startServer) {
                try {
                    const started = await MistralOCR.startServer();
                    if (started) {
                        // Server started, test again
                        try {
                            const response = await fetch(url, {
                                method: 'GET',
                                headers: { 'Accept': 'application/json' }
                            });
                            if (response.ok) {
                                const data = await response.json();
                                if (statusLabel) {
                                    statusLabel.value = 'Connected! Server version: ' + (data.version || 'unknown');
                                    statusLabel.style.color = 'green';
                                }
                            }
                        } catch (e2) {
                            if (statusLabel) {
                                statusLabel.value = 'Server started but connection still failed';
                                statusLabel.style.color = 'orange';
                            }
                        }
                    } else {
                        if (statusLabel) {
                            statusLabel.value = 'Failed to start server. Check configuration.';
                            statusLabel.style.color = 'red';
                        }
                    }
                } catch (startError) {
                    if (statusLabel) {
                        statusLabel.value = 'Error starting server: ' + startError.message;
                        statusLabel.style.color = 'red';
                    }
                }
            } else {
                if (statusLabel) {
                    statusLabel.value = 'Server not running (restart Zotero to enable auto-start)';
                    statusLabel.style.color = 'orange';
                }
            }
        }
    }
};
