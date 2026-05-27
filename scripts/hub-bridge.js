/**
 * Hub Bridge — dünne Schicht zwischen iframe-Raum und Hub (Parent-Fenster).
 *
 * Richtung Parent: z. B. room:ready, room:progress, room:complete (siehe Methoden unten).
 * Richtung Raum: hub:init → onInit; hub:selftest → onSelfTest, Antwort room:selftest_result.
 *
 * Pfad: scripts/hub-bridge.js / neben index.html einbinden.
 *
 * @version 1.0.0
 */

class HubBridge {
    constructor() {
        this.threshold = 70;
        this.roomId = '';
        this.userData = {};
        /** Inhalte aus dem Hub (z. B. Fragen), sonst null */
        this.templateData = null;
        this.isInitialized = false;

        /** Vom Raum gesetzt: function(data) { … } — läuft nach erstem hub:init */
        this.onInit = null;

        /**
         * Vom Raum gesetzt: sync oder async, Rückgabe { passed: boolean, logs: string[] }.
         * Nur passed === true zählt als bestanden.
         */
        this.onSelfTest = null;

        this._bindMessageListener();
    }
    
    /**
     * Bindet den Message-Listener für Hub-Nachrichten
     * @private
     */
    _bindMessageListener() {
        window.addEventListener('message', (event) => {
            this._handleMessage(event.data);
        });
    }
    
    /**
     * Verarbeitet eingehende Nachrichten vom Hub
     * @private
     * @param {Object} data - Nachrichtendaten
     */
    _handleMessage(data) {
        try {
            if (!data || !data.type) return;

            switch (data.type) {
                case 'hub:init':
                    this._handleInit(data.payload);
                    break;
                case 'hub:selftest':
                    this._handleSelfTest();
                    break;
            }
        } catch (e) {
            console.error('[HubBridge]', e);
        }
    }
    
    /**
     * Verarbeitet die Initialisierung vom Hub
     * @private
     * @param {Object} payload
     */
    _handleInit(payload) {
        try {
            payload = payload || {};
            this.threshold = payload.threshold || 70;
            this.roomId = payload.roomId || '';
            this.userData = payload.userData || {};
            this.templateData = payload.templateData || null;
            this.isInitialized = true;

            console.log('[HubBridge] Initialisiert:', {
                threshold: this.threshold,
                roomId: this.roomId,
                hasTemplateData: !!this.templateData
            });

            if (this.onInit) {
                console.log('[HubBridge] OnInit');
                try {
                    this.onInit({
                        threshold: this.threshold,
                        roomId: this.roomId,
                        userData: this.userData,
                        templateData: this.templateData
                    });
                } catch (e) {
                    console.error('[HubBridge] onInit', e);
                }
            }
        } catch (e) {
            console.error('[HubBridge]', e);
        }
    }

    /**
     * Hub Self-Test: ruft onSelfTest auf und meldet room:selftest_result.
     * @private
     */
    _handleSelfTest() {
        const sendResult = (passed, logs) => {
            const safeLogs = Array.isArray(logs) ? logs : [];
            this._sendToHub('room:selftest_result', {
                passed: passed === true,
                logs: safeLogs
            });
        };

        if (typeof this.onSelfTest !== 'function') {
            sendResult(false, ['onSelfTest fehlt — Callback im Raum setzen.']);
            return;
        }

        try {
            const out = this.onSelfTest();
            const finish = (result) => {
                const passed = result && result.passed === true;
                let logs = result && result.logs;
                if (!Array.isArray(logs)) {
                    logs = [];
                }
                sendResult(passed, logs);
            };

            if (out && typeof out.then === 'function') {
                out.then(finish).catch((e) => {
                    const msg = e && e.message ? String(e.message) : String(e);
                    sendResult(false, [msg]);
                });
            } else {
                finish(out);
            }
        } catch (e) {
            const msg = e && e.message ? String(e.message) : String(e);
            sendResult(false, [msg]);
        }
    }

    /**
     * Sendet eine Nachricht an den Hub
     * @private
     * @param {string} type - Nachrichtentyp
     * @param {Object} payload - Nachrichteninhalt
     */
    _sendToHub(type, payload = {}) {
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type, payload }, '*');
            } else {
                console.log('[HubBridge] Standalone-Modus - Nachricht:', type, payload);
            }
        } catch (e) {
            console.error('[HubBridge] postMessage', e);
        }
    }
    
    /**
     * Signalisiert dem Hub, dass der Raum bereit ist
     * MUSS beim Laden aufgerufen werden!
     * @public
     */
    ready() {
        this._sendToHub('room:ready');
        console.log('[HubBridge] Ready gesendet');
    }
    
    /**
     * Sendet einen Fortschritts-Update an den Hub
     * @public
     * @param {number} progress - Aktueller Fortschritt (0-100)
     */
    updateProgress(progress) {
        const clampedProgress = Math.min(100, Math.max(0, progress));
        this._sendToHub('room:progress', { progress: clampedProgress });
    }
    
    /**
     * Sendet eine Nachricht an die Hub-Chatbox
     * @public
     * @param {string} text - Nachrichtentext
     * @param {string} type - 'default' | 'system' | 'warning' | 'success' | 'error'
     */
    sendMessage(text, type = 'default') {
        this._sendToHub('room:message', { text, messageType: type });
    }
    
    /**
     * Signalisiert dem Hub, dass der Raum abgeschlossen wurde
     * @public
     * @param {number} finalProgress - Endgültiger Fortschritt
     * @param {Object} data - Optionale zusätzliche Daten
     */
    complete(finalProgress, data = {}) {
        this._sendToHub('room:complete', { finalProgress, data });
    }
    
    /**
     * Signalisiert dem Hub, dass der Raum abgebrochen wurde
     * @public
     */
    cancel() {
        this._sendToHub('room:cancel');
        console.log('[HubBridge] Cancel gesendet');
    }
    
    /**
     * Markiert eine Aufgabe als abgeschlossen
     * Die Aufgabennummer muss mit der Reihenfolge in der Datenbank übereinstimmen
     * @public 
     * @param {number} taskNumber - Aufgabennummer (1, 2, 3, ...)
     */
    completeTask(taskNumber) {
        try {
            const num = parseInt(taskNumber, 10);
            if (isNaN(num) || num < 1) {
                console.warn('[HubBridge] Ungültige Aufgabennummer:', taskNumber);
                return;
            }
            this._sendToHub('room:task_complete', { taskNumber: num });
            console.log('[HubBridge] Task abgeschlossen:', num);
        } catch (e) {
            console.error(e);
        }
    }
    
    /**
     * Gibt den konfigurierten Schwellwert zurück
     * @public
     * @returns {number}
     */
    getThreshold() {
        return this.threshold;
    }
    
    /**
     * Prüft ob der aktuelle Fortschritt den Schwellwert erreicht
     * @public
     * @param {number} progress - Zu prüfender Fortschritt
     * @returns {boolean}
     */
    isThresholdReached(progress) {
        return progress >= this.threshold;
    }
    
    /**
     * Gibt die Template-Daten zurück (für Template-basierte Räume)
     * @public
     * @returns {Object|null}
     */
    getTemplateData() {
        return this.templateData;
    }
    
    /**
     * Prüft ob dieser Raum Template-basiert ist
     * @public
     * @returns {boolean}
     */
    isTemplateBased() {
        return this.templateData !== null;
    }
    
    /**
     * Prüft ob der Raum im Hub läuft
     * @public
     * @returns {boolean}
     */
    isInHub() {
        return window.parent && window.parent !== window;
    }
}

/** Eine Instanz für den ganzen Raum; nach dem Laden hubBridge.ready() aufrufen. */
const hubBridge = new HubBridge();
