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
            let commitTimer = null;
            let recvPackets = 0;
            let appendSent = 0;
            let commitSent = 0;
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
                            commitSent += 1;
                            if (autoResponseCreate) {
                                elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
                            }
                            if (commitSent <= 3 || commitSent % 10 === 0) {
                                console.log(`[ElevenLabs] ✅ Commit sent (total: ${commitSent})`);
                            }
                        } catch (e) {
                            console.error('[ElevenLabs] ❌ Commit error:', e.message || e);
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
                        const initialConfig = {
                            type: 'conversation_initiation_client_data',
                            conversation_config_override: {
                                agent: {
                                    first_message: "Hello! Thank you for calling Infobip Capital. I'm your AI assistant. How can I help you today?"
                                }
                            }
                        };
                        elevenLabsWs.send(JSON.stringify(initialConfig));
                        console.log('[ElevenLabs] Sent conversation config with first_message');
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);
                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] ✅ Conversation initialized');
                                    console.log('[ElevenLabs] Waiting for agent first message (must be configured in agent settings)');
                                    break;
                                case 'audio': {
                                    const buff = Buffer.from(message.audio_event.audio_base_64, 'base64');
                                    if (infobipWs.readyState === WebSocket.OPEN) {
                                        infobipWs.send(buff);
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
                                case 'user_transcript':
                                    console.log(`[ElevenLabs] 🎤 User: "${message.user_transcription_event?.user_transcript || ''}"`);
                                    break;
                                case 'agent_response':
                                    console.log(`[ElevenLabs] 🤖 Agent: "${message.agent_response_event?.agent_response || ''}"`);
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
                        // Control JSON from Infobip
                        console.log('[Infobip] JSON control:', message);
                        return; // JSON control events ignored
                    }

                    // Binary PCM from Infobip
                    recvPackets += 1;
                    if (recvPackets <= 3 || recvPackets % 100 === 0) {
                        console.log(`[Infobip] 🔊 Binary audio packet #${recvPackets} (${message.length} bytes)`);
                    }

                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        const b64 = Buffer.from(message).toString('base64');
                        elevenLabsWs.send(JSON.stringify({
                            type: 'input_audio_buffer.append',
                            audio: b64
                        }));
                        appendSent += 1;
                        if (appendSent <= 3 || appendSent % 100 === 0) {
                            console.log(`[Infobip → ElevenLabs] 📤 append sent #${appendSent}`);
                        }
                        scheduleCommit();
                    } else {
                        console.warn('[Infobip → ElevenLabs] WS not open, dropping packet');
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', () => {
                clearCommit();
                console.log(`[Infobip] Client disconnected — recvPackets=${recvPackets}, appends=${appendSent}, commits=${commitSent}`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    elevenLabsWs.close();
                }
            });
        });

        this.wss.on('error', (error) => {
            console.error('❌ WebSocket Server error:', error);
        });
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
