const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');
const callsHandler = require('./callsHandler');
const SignedUrlPool = require('./SignedUrlPool');

class WebSocketProxy {
    constructor() {
        this.elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;
        this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        this.port = process.env.WS_PROXY_PORT || 3500;

        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });

        // Initialize signed URL pool
        this.signedUrlPool = new SignedUrlPool(() => this.getSignedUrl());

        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (infobipWs, req) => {
            console.log('[Bridge] New Infobip connection');

            // Extract customer context from active calls
            let customerContext = null;

            console.log('[Bridge] New Infobip WebSocket connection established');
            console.log('[Bridge] Request URL:', req.url);

            // Retrieve context from most recent active call
            const activeCalls = callsHandler.getActiveCalls();

            if (activeCalls.length > 0) {
                const recentCall = activeCalls[activeCalls.length - 1];
                const callSession = callsHandler.getCallSession(recentCall.callId);

                if (callSession && callSession.userContext) {
                    customerContext = callSession.userContext;
                    console.log('[Bridge] Retrieved context for:', customerContext.name);
                } else {
                    console.warn('[Bridge] Call session found but no user context');
                }
            } else {
                console.warn('[Bridge] No active calls found');
            }

            let elevenLabsWs = null;
            let elevenLabsReady = false; // Track when ElevenLabs is ready to receive audio
            let audioBuffer = []; // Buffer audio until ElevenLabs is connected
            let commitTimer = null;
            let audioChunksReceived = 0;
            let audioChunksSinceLastCommit = 0;
            let lastAudioTime = Date.now();
            let lastCommitTime = Date.now();
            const idleCommitMs = Number(process.env.ELEVENLABS_IDLE_COMMIT_MS || 500);
            const maxCommitIntervalMs = Number(process.env.ELEVENLABS_MAX_COMMIT_INTERVAL_MS || 2000);
            const autoResponseCreate = (process.env.ELEVENLABS_AUTO_RESPONSE_CREATE ?? 'true').toLowerCase() !== 'false';

            // Keepalive configuration
            const continuousKeepalive = (process.env.ELEVENLABS_CONTINUOUS_KEEPALIVE ?? 'true').toLowerCase() === 'true';
            const keepaliveIntervalMs = Number(process.env.ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS || 20);
            let lastTtsTime = 0;
            let keepaliveTimer = null;

            // Generate PCM silence frame (16-bit PCM, 16kHz, mono, 20ms = 640 bytes)
            const generateSilenceFrame = () => {
                return Buffer.alloc(640, 0); // 320 samples * 2 bytes per sample = 640 bytes
            };

            // Continuous audio keepalive - sends silence when no TTS audio
            const startAudioKeepalive = () => {
                if (!continuousKeepalive) return;

                keepaliveTimer = setInterval(() => {
                    const now = Date.now();
                    const timeSinceLastTts = now - lastTtsTime;

                    // Only send silence if >100ms since last TTS (avoid interfering with active audio)
                    if (timeSinceLastTts > 100 && infobipWs.readyState === WebSocket.OPEN) {
                        try {
                            const silenceFrame = generateSilenceFrame();
                            infobipWs.send(silenceFrame);
                        } catch (err) {
                            console.error('[Keepalive] Error sending silence frame:', err.message);
                        }
                    }
                }, keepaliveIntervalMs);

                console.log(`[Keepalive] Started continuous audio keepalive (${keepaliveIntervalMs}ms interval)`);
            };

            const stopAudioKeepalive = () => {
                if (keepaliveTimer) {
                    clearInterval(keepaliveTimer);
                    keepaliveTimer = null;
                }
            };

            // Set up WebSocket keepalive for Infobip connection
            const keepaliveInterval = setInterval(() => {
                if (infobipWs.readyState === WebSocket.OPEN) {
                    infobipWs.ping();
                }
            }, 30000); // Ping every 30 seconds

            const clearCommit = () => {
                if (commitTimer) {
                    clearTimeout(commitTimer);
                    commitTimer = null;
                }
            };

            const doCommit = () => {
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN && audioChunksSinceLastCommit > 0) {
                    try {
                        elevenLabsWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                        if (autoResponseCreate) {
                            elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
                        }
                        audioChunksSinceLastCommit = 0;
                        lastCommitTime = Date.now();
                    } catch (e) {
                        console.error('[ElevenLabs] Commit error:', e.message);
                    }
                }
            };

            const scheduleCommit = () => {
                // Force commit if we haven't committed in maxCommitIntervalMs (prevents infinite buffering)
                const timeSinceLastCommit = Date.now() - lastCommitTime;
                if (timeSinceLastCommit >= maxCommitIntervalMs) {
                    doCommit();
                    return;
                }

                // Otherwise schedule idle commit
                clearCommit();
                commitTimer = setTimeout(() => {
                    doCommit();
                }, idleCommitMs);
            };

            // Set up ElevenLabs connection
            (async () => {
                try {
                    // Use signed URL pool instead of direct API call (saves ~150ms)
                    const signedUrl = await this.signedUrlPool.get();
                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        console.log('[ElevenLabs] WebSocket connected');

                        // Build dynamic variables from customer context
                        const dynamicVariables = {};

                        if (customerContext) {
                            try {
                            // IMPORTANT: Only send the 8 variables defined in the ElevenLabs agent config
                            // Additional undefined variables will cause the conversation to fail

                            dynamicVariables.customer_name = customerContext.name || 'Valued Customer';
                            dynamicVariables.company_name = customerContext.companyName || 'Your Company';
                            dynamicVariables.current_balance = customerContext.fakeAccountBalance || '0.00';
                            dynamicVariables.account_number = customerContext.fakeAccountNumber || 'ACC000000000';
                            dynamicVariables.loan_status = customerContext.loanApplicationStatus || 'No Active Applications';
                            dynamicVariables.phone_number = customerContext.phoneNumber || '';
                            dynamicVariables.is_fraud_flagged = customerContext.fraudScenario ? true : false;
                            dynamicVariables.verification_complete = true;

                            console.log('[ElevenLabs] Loaded context for:', dynamicVariables.customer_name);

                            } catch (variableConstructionError) {
                                console.error('[ElevenLabs] Failed to construct dynamic variables:', variableConstructionError.message);
                            }
                        } else {
                            console.warn('[ElevenLabs] No customer context - using defaults');
                        }

                        // Use agent's configured prompt from dashboard - just send dynamic variables
                        // The prompt in the dashboard already has the correct {{variable}} placeholders
                        const initialConfig = {
                            type: 'conversation_initiation_client_data',
                            dynamic_variables: dynamicVariables
                        };

                        // Send configuration with dynamic variables to ElevenLabs
                        try {
                            elevenLabsWs.send(JSON.stringify(initialConfig));
                            console.log('[ElevenLabs] Sent configuration with', Object.keys(dynamicVariables).length, 'variables');
                        } catch (configSendError) {
                            console.error('[ElevenLabs] Failed to send configuration:', configSendError.message);
                            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                                elevenLabsWs.close(1011, 'Configuration send failure');
                            }
                        }

                        // Mark ElevenLabs as ready and flush buffered audio
                        elevenLabsReady = true;

                        // Start audio keepalive to prevent Infobip timeout
                        startAudioKeepalive();

                        if (audioBuffer.length > 0) {
                            console.log(`[Bridge] Flushing ${audioBuffer.length} buffered audio chunk(s) to ElevenLabs`);
                            audioBuffer.forEach(audioChunk => {
                                try {
                                    elevenLabsWs.send(JSON.stringify({
                                        user_audio_chunk: Buffer.from(audioChunk).toString('base64')
                                    }));
                                } catch (err) {
                                    console.error('[Bridge] Error flushing buffered audio:', err.message);
                                }
                            });
                            audioBuffer = []; // Clear buffer after flushing
                            console.log('[Bridge] Audio buffer flushed successfully');
                        }
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);

                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] Conversation initialized:', message.conversation_initiation_metadata_event?.conversation_id);
                                    break;
                                case 'audio': {
                                    // Extract audio data from ElevenLabs response
                                    const audioData = message.audio_event?.audio_base_64;

                                    if (audioData && infobipWs.readyState === WebSocket.OPEN) {
                                        const buff = Buffer.from(audioData, 'base64');
                                        infobipWs.send(buff);
                                        // Update last TTS time to prevent keepalive from interfering
                                        lastTtsTime = Date.now();
                                    } else if (!audioData) {
                                        console.error('[ElevenLabs] Audio event missing audio_base_64 field');
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
                                        const pingMs = message.ping_event.ping_ms || 0;
                                        setTimeout(() => {
                                            if (elevenLabsWs.readyState === WebSocket.OPEN) {
                                                elevenLabsWs.send(JSON.stringify({
                                                    type: 'pong',
                                                    event_id: message.ping_event.event_id
                                                }));
                                            }
                                        }, pingMs);
                                    }
                                    break;
                                case 'user_transcript':
                                    console.log(`[ElevenLabs] 🎤 User: "${message.user_transcription_event?.user_transcript || ''}"`);
                                    break;
                                case 'agent_response':
                                    console.log(`[ElevenLabs] 🤖 Agent: "${message.agent_response_event?.agent_response || ''}"`);
                                    break;
                                case 'error':
                                    console.error('[ElevenLabs] Error:', message.error?.message || JSON.stringify(message));
                                    break;
                                default:
                                    // Silently handle other message types (user_transcript, agent_response, etc.)
                                    break;
                            }
                        } catch (error) {
                            console.error('[ElevenLabs] Error processing message:', error);
                        }
                    });

                    elevenLabsWs.on('error', (error) => {
                        console.error('[ElevenLabs] WebSocket error:', error.message);
                    });

                    elevenLabsWs.on('close', (code, reason) => {
                        clearCommit();
                        stopAudioKeepalive();
                        console.log(`[ElevenLabs] Connection closed (code: ${code}${reason ? `, reason: ${reason}` : ''})`);

                        if (code !== 1000 && code !== 1005) {
                            console.warn(`[ElevenLabs] Abnormal close code ${code} - check connection stability`);
                        }
                    });
                } catch (error) {
                    console.error('[ElevenLabs] Setup failed:', error.message);
                    console.error('[ElevenLabs] Stack:', error.stack);
                }
            })();

            // Handle messages from Infobip
            infobipWs.on('message', (message) => {
                try {
                    // Ignore JSON control messages
                    if (typeof message === 'string') {
                        return;
                    }

                    // Check if binary message is actually JSON control message
                    try {
                        const msgStr = message.toString('utf8');
                        if ((msgStr.startsWith('{') || msgStr.startsWith(' {')) &&
                            (msgStr.includes('"call-id"') || msgStr.includes('"event"'))) {
                            return; // JSON control events ignored
                        }
                    } catch (e) {
                        // If toString fails, it's definitely binary audio
                    }

                    audioChunksReceived++;
                    audioChunksSinceLastCommit++;
                    lastAudioTime = Date.now();

                    // Buffer audio if ElevenLabs isn't ready yet
                    if (!elevenLabsReady) {
                        audioBuffer.push(message);
                        if (audioBuffer.length === 1) {
                            console.log('[Bridge] Buffering audio - ElevenLabs not ready yet');
                        }
                        return;
                    }

                    // Send audio to ElevenLabs
                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify({
                            user_audio_chunk: Buffer.from(message).toString('base64')
                        }));
                    } else {
                        console.warn('[Infobip] Cannot send audio - ElevenLabs WS not open');
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', (code, reason) => {
                clearCommit();
                clearInterval(keepaliveInterval);
                stopAudioKeepalive();
                console.log(`[Infobip] Client disconnected (code: ${code})`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    elevenLabsWs.close();
                }
            });
        });

        this.wss.on('error', (error) => {
            console.error('[Server] WebSocket error:', error);
        });
    }


    async getSignedUrl() {
        try {
            const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.elevenLabsAgentId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'xi-api-key': this.elevenLabsApiKey,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get signed URL: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (!data.signed_url) {
                throw new Error('Signed URL not found in API response');
            }

            return data.signed_url;
        } catch (error) {
            console.error('[ElevenLabs API] Failed to get signed URL:', error.message);
            throw error;
        }
    }

    async start() {
        // Start the signed URL pool
        await this.signedUrlPool.start();

        this.server.listen(this.port, () => {
            console.log(`WebSocket Proxy Server running on port ${this.port}`);
        });
    }

    async attachToServer(httpServer) {
        // Start the signed URL pool
        await this.signedUrlPool.start();

        this.wss = new WebSocket.Server({
            server: httpServer,
            path: '/websocket-voice'
        });

        this.setupWebSocketServer();

        console.log(`WebSocket Proxy attached to main server at /websocket-voice`);
    }

    stop() {
        console.log('Stopping WebSocket Proxy Server...');

        // Stop the signed URL pool
        this.signedUrlPool.stop();

        this.wss.close();
        this.server.close();
    }
}

// Export singleton instance
let wsProxyInstance = null;

module.exports = WebSocketProxy;
module.exports.getInstance = () => wsProxyInstance;
module.exports.setInstance = (instance) => { wsProxyInstance = instance; };
