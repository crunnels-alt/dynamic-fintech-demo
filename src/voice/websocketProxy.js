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
            let audioPacketCount = 0;
            let audioSentCount = 0;
            let audioBuffer = []; // Buffer to hold audio until ElevenLabs is ready
            let commitTimer = null;
            const idleCommitMs = 500; // Commit audio after 500ms of silence
            
            console.log('[Bridge] Using ElevenLabs server-side VAD with commit logic');

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
                                    prompt: {
                                        prompt: "You are a helpful AI assistant for Infobip Capital, a modern fintech platform. Greet the caller warmly and ask how you can help them today."
                                    },
                                    first_message: "Hello! Welcome to Infobip Capital. How can I assist you today?",
                                    language: "en"
                                },
                                tts: {
                                    model_id: "eleven_turbo_v2_5"
                                },
                                asr: {
                                    quality: "high",
                                    keywords: []
                                },
                                vad: {
                                    enabled: true,
                                    threshold: 0.5
                                },
                                audio: {
                                    input: {
                                        encoding: "pcm_16000",
                                        sample_rate: 16000,
                                        channels: 1
                                    },
                                    output: {
                                        encoding: "pcm_16000",
                                        sample_rate: 16000,
                                        channels: 1
                                    }
                                }
                            }
                        };
                        elevenLabsWs.send(JSON.stringify(initialConfig));
                        console.log('[ElevenLabs] Sent conversation_initiation_client_data with VAD enabled');
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);
                            console.log(`[ElevenLabs] Received message type: ${message.type}`);
                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] Conversation initialized - READY FOR AUDIO');
                                    elevenLabsReady = true;
                                    
                                    // Send any buffered audio packets first
                                    if (audioBuffer.length > 0) {
                                        console.log(`[ElevenLabs] Sending ${audioBuffer.length} buffered audio packets...`);
                                        audioBuffer.forEach(bufferedAudio => {
                                            elevenLabsWs.send(JSON.stringify({
                                                type: 'input_audio_buffer.append',
                                                audio: bufferedAudio
                                            }));
                                        });
                                        audioBuffer = []; // Clear buffer
                                    }
                                    
                                    // Trigger initial greeting
                                    console.log('[ElevenLabs] Triggering initial greeting...');
                                    elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
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
                                case 'user_transcript':
                                    console.log(`[ElevenLabs] 🎤 User said: "${message.user_transcription_event?.user_transcript || 'N/A'}"`);
                                    break;
                                case 'agent_response':
                                    console.log(`[ElevenLabs] 🤖 Agent responding: "${message.agent_response_event?.agent_response || 'N/A'}"`);
                                    break;
                                case 'internal_tentative_agent_response':
                                    console.log('[ElevenLabs] 💭 Agent is thinking...');
                                    break;
                                case 'user_audio_start':
                                    console.log('[ElevenLabs] 🟢 VAD detected speech START');
                                    break;
                                case 'user_audio_end':
                                    console.log('[ElevenLabs] 🔴 VAD detected speech END');
                                    break;
                                case 'internal_vad_detected_speech':
                                    console.log('[ElevenLabs] 🎙️ VAD processing speech...');
                                    break;
                                default:
                                    console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
                                    break;
                            }
                        } catch (error) {
                            console.error('[ElevenLabs] Error processing message:', error);
                        }
                    });

                    elevenLabsWs.on('error', (error) => console.error('[ElevenLabs] WebSocket error:', error));
                    elevenLabsWs.on('close', () => { 
                        console.log('[ElevenLabs] Disconnected');
                        if (commitTimer) {
                            clearTimeout(commitTimer);
                            commitTimer = null;
                        }
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
                    
                    // Analyze audio to detect if it's silence or actual speech
                    if (audioPacketCount === 1 || audioPacketCount === 50 || audioPacketCount === 100) {
                        const audioLevel = this.analyzeAudioLevel(message);
                        console.log(`[Infobip → ElevenLabs] Audio packet #${audioPacketCount} (${message.length} bytes) - Audio level: ${audioLevel}`);
                    } else if (audioPacketCount % 100 === 0) {
                        console.log(`[Infobip → ElevenLabs] Audio packet #${audioPacketCount} (${message.length} bytes)`);
                    }

                    const base64Audio = Buffer.from(message).toString('base64');
                    
                    if (!elevenLabsReady) {
                        // Buffer audio until ElevenLabs is ready
                        audioBuffer.push(base64Audio);
                        if (audioPacketCount === 1) {
                            console.warn('[Infobip → ElevenLabs] ⚠️ ElevenLabs not ready yet, buffering audio...');
                        }
                        return;
                    }

                    // Send audio continuously to ElevenLabs
                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify({
                            type: 'input_audio_buffer.append',
                            audio: base64Audio
                        }));
                        
                        // Schedule a commit after idle period (critical for speech detection!)
                        if (commitTimer) {
                            clearTimeout(commitTimer);
                        }
                        commitTimer = setTimeout(() => {
                            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                                try {
                                    elevenLabsWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                                    elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
                                    console.log('[ElevenLabs] ✅ Committed audio buffer and requested response');
                                } catch (e) {
                                    console.error('[ElevenLabs] ❌ Commit error:', e.message);
                                }
                            }
                        }, idleCommitMs);
                    } else {
                        console.warn('[Infobip → ElevenLabs] ⚠️ ElevenLabs WS not open, dropping audio');
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', () => {
                console.log(`[Infobip] Client disconnected - Total audio packets: ${audioPacketCount} received, ${audioSentCount} sent`);
                if (commitTimer) {
                    clearTimeout(commitTimer);
                    commitTimer = null;
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

    generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    analyzeAudioLevel(buffer) {
        // Calculate RMS (Root Mean Square) of audio samples to detect speech
        // PCM 16-bit samples range from -32768 to 32767
        let sum = 0;
        const samples = buffer.length / 2; // 16-bit = 2 bytes per sample
        
        for (let i = 0; i < buffer.length - 1; i += 2) {
            const sample = buffer.readInt16LE(i);
            sum += sample * sample;
        }
        
        const rms = Math.sqrt(sum / samples);
        const dbLevel = 20 * Math.log10(rms / 32768); // Convert to dB
        
        if (rms < 100) return 'SILENCE (near zero)';
        if (rms < 500) return 'Very quiet';
        if (rms < 2000) return 'Quiet speech';
        if (rms < 5000) return 'Normal speech';
        return 'Loud speech';
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
