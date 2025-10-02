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
        this.wss.on('connection', (infobipWs, req) => {
            const connId = Math.random().toString(36).substr(2, 6);
            const startTime = Date.now();
            console.log(`[Bridge] New Infobip connection conn_${connId}`);
            console.log(`[Bridge] Connection from: ${req.socket.remoteAddress}`);

            let elevenLabsWs = null;
            let audioChunksSent = 0;
            let lastAudioTime = null;
            let keepaliveInterval = null;

            // Create silence frame for keepalive (20ms of silence at 16kHz PCM)
            // 16000 Hz * 0.02 seconds * 2 bytes per sample (16-bit) = 640 bytes
            const silenceFrame = Buffer.alloc(640, 0);

            infobipWs.on('error', (error) => {
                console.error(`[Infobip conn_${connId}] Error:`, error);
            });

            const setupElevenLabs = async () => {
                try {
                    const signedUrl = await this.getSignedUrl();
                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        const elapsed = Date.now() - startTime;
                        console.log(`[ElevenLabs conn_${connId}] Connected to Conversational AI (${elapsed}ms after Infobip connected)`);
                        const initialConfig = {
                            type: 'conversation_initiation_client_data'
                        };
                        elevenLabsWs.send(JSON.stringify(initialConfig));

                        // Start keepalive - send silence every 20ms to prevent Infobip timeout
                        keepaliveInterval = setInterval(() => {
                            if (infobipWs.readyState === WebSocket.OPEN) {
                                // Only send keepalive if we haven't sent audio recently (within last 100ms)
                                const timeSinceLastAudio = lastAudioTime ? (Date.now() - lastAudioTime) : Infinity;
                                if (timeSinceLastAudio > 100) {
                                    infobipWs.send(silenceFrame);
                                }
                            }
                        }, 20); // Send every 20ms
                        console.log(`[Bridge conn_${connId}] Started audio keepalive (20ms silence frames)`);
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);
                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] Received initiation metadata');
                                    break;
                                case 'audio':
                                    const buff = Buffer.from(message.audio_event.audio_base_64, 'base64');
                                    audioChunksSent++;
                                    lastAudioTime = Date.now();
                                    const elapsed = Date.now() - startTime;
                                    console.log(`[ElevenLabs → Infobip conn_${connId}] Sending audio chunk #${audioChunksSent} (${buff.length} bytes) at ${elapsed}ms`);
                                    if (infobipWs.readyState === WebSocket.OPEN) {
                                        infobipWs.send(buff);
                                    } else {
                                        console.warn(`[ElevenLabs → Infobip conn_${connId}] Cannot send audio - Infobip WS not open (state: ${infobipWs.readyState})`);
                                    }
                                    break;
                                case 'agent_response_correction':
                                case 'interruption':
                                    if (infobipWs.readyState === WebSocket.OPEN) {
                                        infobipWs.send(JSON.stringify({
                                            action: 'clear'
                                        }));
                                    }
                                    break;
                                case 'ping':
                                    if (message.ping_event?.event_id) {
                                        elevenLabsWs.send(JSON.stringify({
                                            type: 'pong',
                                            event_id: message.ping_event.event_id
                                        }));
                                    }
                                    break;
                                case 'agent_response':
                                    console.log(`[ElevenLabs] Agent response: ${message.agent_response_event?.agent_response}`);
                                    break;
                                case 'user_transcript':
                                    console.log(`[ElevenLabs] User transcript: ${message.user_transcription_event?.user_transcript}`);
                                    break;
                                default:
                                    console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
                            }
                        } catch (error) {
                            console.error('[ElevenLabs] Error processing message:', error);
                        }
                    });

                    elevenLabsWs.on('error', (error) => {
                        console.error(`[ElevenLabs conn_${connId}] WebSocket error:`, error);
                    });

                    elevenLabsWs.on('close', (code, reason) => {
                        const duration = Date.now() - startTime;
                        console.log(`[ElevenLabs conn_${connId}] Disconnected - Code: ${code}, Reason: ${reason || 'No reason provided'}`);
                        console.log(`[ElevenLabs conn_${connId}] Connection lasted ${duration}ms, sent ${audioChunksSent} audio chunks`);

                        // Clean up keepalive interval
                        if (keepaliveInterval) {
                            clearInterval(keepaliveInterval);
                        }
                    });
                } catch (error) {
                    console.error('[ElevenLabs] Setup error:', error);
                }
            };

            // Set up ElevenLabs connection
            setupElevenLabs();

            // Handle messages from Infobip
            infobipWs.on('message', (message) => {
                try {
                    if (typeof message === 'string') {
                        // JSON event, we ignore those for now
                        return;
                    }

                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        const audioMessage = {
                            user_audio_chunk: Buffer.from(message).toString('base64')
                        };
                        elevenLabsWs.send(JSON.stringify(audioMessage));
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', (code, reason) => {
                const duration = Date.now() - startTime;
                console.log(`[Infobip conn_${connId}] Client disconnected - Code: ${code}, Reason: ${reason || 'No reason provided'}`);
                console.log(`[Infobip conn_${connId}] Connection lasted ${duration}ms`);
                console.log(`[Infobip conn_${connId}] Total audio chunks sent: ${audioChunksSent}`);
                if (lastAudioTime) {
                    const timeSinceLastAudio = Date.now() - lastAudioTime;
                    console.log(`[Infobip conn_${connId}] Time since last audio: ${timeSinceLastAudio}ms`);
                }
                if (duration < 5000) {
                    console.error(`[Infobip conn_${connId}] ⚠️  PREMATURE DISCONNECT - Call ended after only ${duration}ms!`);
                }

                // Clean up keepalive interval
                if (keepaliveInterval) {
                    clearInterval(keepaliveInterval);
                    console.log(`[Bridge conn_${connId}] Stopped audio keepalive`);
                }

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
