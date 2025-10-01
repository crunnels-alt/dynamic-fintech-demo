const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');

class WebSocketProxy {
    constructor() {
        this.elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;
        this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        this.port = process.env.WS_PROXY_PORT || 3500;

        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });

        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (infobipWs) => {
            console.log('[Bridge] New Infobip connection');
            
            let elevenLabsWs = null;
            let elevenLabsReady = false;
            let commitTimer = null;
            let audioPacketCount = 0;
            let audioSentCount = 0;
            const idleCommitMs = Number(process.env.ELEVENLABS_IDLE_COMMIT_MS || 500);
            const autoResponseCreate = (process.env.ELEVENLABS_AUTO_RESPONSE_CREATE ?? 'true').toLowerCase() !== 'false';

            const clearCommit = () => { 
                if (commitTimer) { 
                    clearTimeout(commitTimer); 
                    commitTimer = null; 
                } 
            };

            const scheduleCommit = () => {
                clearCommit();
                commitTimer = setTimeout(() => {
                    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                        try {
                            elevenLabsWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                            if (autoResponseCreate) {
                                elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
                            }
                        } catch (e) {
                            console.error('[Bridge] commit error:', e.message || e);
                        }
                    }
                }, idleCommitMs);
            };

            // Set up ElevenLabs connection
            (async () => {
                try {
                    const signedUrl = await this.getSignedUrl();
                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        console.log('[ElevenLabs] Connected to Conversational AI');
                        const initialConfig = { type: 'conversation_initiation_client_data' };
                        elevenLabsWs.send(JSON.stringify(initialConfig));
                        console.log('[ElevenLabs] Sent conversation_initiation_client_data');
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);
                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] Conversation initialized - READY FOR AUDIO');
                                    elevenLabsReady = true;
                                    break;
                                case 'audio': {
                                    const buff = Buffer.from(message.audio_event.audio_base_64, 'base64');
                                    audioSentCount++;
                                    if (audioSentCount === 1 || audioSentCount % 50 === 0) {
                                        console.log(`[ElevenLabs → Infobip] Audio packet #${audioSentCount} (${buff.length} bytes)`);
                                    }
                                    if (infobipWs.readyState === WebSocket.OPEN) {
                                        infobipWs.send(buff);
                                    } else {
                                        console.warn('[ElevenLabs → Infobip] ⚠️ Infobip WS not open, dropping audio');
                                    }
                                    break;
                                }
                                case 'agent_response_correction':
                                case 'interruption':
                                    if (infobipWs.readyState === WebSocket.OPEN) {
                                        infobipWs.send(JSON.stringify({ action: 'clear' }));
                                    }
                                    break;
                                case 'ping':
                                    if (message.ping_event?.event_id) {
                                        elevenLabsWs.send(JSON.stringify({ type: 'pong', event_id: message.ping_event.event_id }));
                                    }
                                    break;
                                default:
                                    break;
                            }
                        } catch (error) {
                            console.error('[ElevenLabs] Error processing message:', error);
                        }
                    });

                    elevenLabsWs.on('error', (error) => console.error('[ElevenLabs] WebSocket error:', error));
                    elevenLabsWs.on('close', () => { 
                        clearCommit(); 
                        console.log('[ElevenLabs] Disconnected'); 
                    });
                } catch (error) {
                    console.error('[ElevenLabs] Setup error:', error);
                }
            })();

            // Handle messages from Infobip
            infobipWs.on('message', (message) => {
                try {
                    if (typeof message === 'string') {
                        console.log('[Infobip] Received JSON control message:', message);
                        return; // JSON control events ignored here
                    }

                    // Audio data from Infobip
                    audioPacketCount++;
                    if (audioPacketCount === 1 || audioPacketCount % 50 === 0) {
                        console.log(`[Infobip → ElevenLabs] Audio packet #${audioPacketCount} (${message.length} bytes)`);
                    }

                    if (!elevenLabsReady) {
                        if (audioPacketCount === 1) {
                            console.warn('[Infobip → ElevenLabs] ⚠️ ElevenLabs not ready yet, buffering audio...');
                        }
                        return;
                    }

                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify({
                            type: 'input_audio_buffer.append',
                            audio: Buffer.from(message).toString('base64')
                        }));
                        scheduleCommit();
                    } else {
                        console.warn('[Infobip → ElevenLabs] ⚠️ ElevenLabs WS not open, dropping audio');
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', () => {
                clearCommit();
                console.log(`[Infobip] Client disconnected - Total audio packets: ${audioPacketCount} received, ${audioSentCount} sent`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    elevenLabsWs.close();
                }
            });
        });

        this.wss.on('error', (error) => {
            console.error('❌ WebSocket Server error:', error);
        });
    }

    generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async getSignedUrl() {
        try {
            const response = await fetch(
                `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.elevenLabsAgentId}`,
                {
                    method: 'GET',
                    headers: {
                        'xi-api-key': this.elevenLabsApiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.signed_url;
        } catch (error) {
            console.error('❌ Error getting ElevenLabs signed URL:', error.message);
            throw error;
        }
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`🔌 WebSocket Proxy Server running on port ${this.port}`);
            console.log(`📡 Ready to bridge Infobip ↔ ElevenLabs audio streams`);
        });
    }

    attachToServer(httpServer) {
        this.wss = new WebSocket.Server({
            server: httpServer,
            path: '/websocket-voice'
        });

        this.setupWebSocketServer();

        console.log(`🔌 WebSocket Proxy attached to main server at /websocket-voice`);
        console.log(`📡 Ready to bridge Infobip ↔ ElevenLabs audio streams`);
    }

    stop() {
        console.log('🛑 Stopping WebSocket Proxy Server...');
        this.wss.close();
        this.server.close();
    }
}

// Export singleton instance
let wsProxyInstance = null;

module.exports = WebSocketProxy;
module.exports.getInstance = () => wsProxyInstance;
module.exports.setInstance = (instance) => { wsProxyInstance = instance; };
