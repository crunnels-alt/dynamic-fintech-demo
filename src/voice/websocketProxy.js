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
            const connectionStartTime = Date.now();
            console.log('[Bridge] New Infobip connection');

            // Extract customer context from active calls
            let customerContext = null;
            let matchedCallId = null;

            console.log('[Bridge] New Infobip WebSocket connection established');
            console.log('[Bridge] Request URL:', req.url);
            console.log('[Bridge] Request headers:', JSON.stringify(req.headers, null, 2));

            // Try to extract call ID or dialog ID from the WebSocket connection
            // Infobip may send this in the URL query params or initial message
            let callIdFromUrl = null;
            let dialogIdFromUrl = null;

            if (req.url) {
                const url = new URL(req.url, 'http://localhost');
                callIdFromUrl = url.searchParams.get('callId') || url.searchParams.get('call-id');
                dialogIdFromUrl = url.searchParams.get('dialogId') || url.searchParams.get('dialog-id');

                if (callIdFromUrl) {
                    console.log('[Bridge] Found callId in URL:', callIdFromUrl);
                }
                if (dialogIdFromUrl) {
                    console.log('[Bridge] Found dialogId in URL:', dialogIdFromUrl);
                }
            }

            // Strategy 1: If we have a callId from the URL, look up that specific session
            if (callIdFromUrl) {
                const callSession = callsHandler.getCallSession(callIdFromUrl);
                if (callSession && callSession.userContext) {
                    customerContext = callSession.userContext;
                    matchedCallId = callIdFromUrl;
                    console.log('[Bridge] Matched call by URL callId:', callIdFromUrl);
                }
            }

            // Strategy 2: If no match yet, look for dialogId match in active calls
            if (!customerContext && dialogIdFromUrl) {
                const activeCalls = callsHandler.getActiveCalls();
                for (const call of activeCalls) {
                    const session = callsHandler.getCallSession(call.callId);
                    if (session && session.dialogId === dialogIdFromUrl) {
                        customerContext = session.userContext;
                        matchedCallId = call.callId;
                        console.log('[Bridge] Matched call by dialogId:', dialogIdFromUrl);
                        break;
                    }
                }
            }

            // Strategy 3: Wait for initial message with call metadata (will be handled below)
            // Strategy 4: Fall back to most recent call (existing behavior) with warning
            if (!customerContext) {
                const activeCalls = callsHandler.getActiveCalls();

                if (activeCalls.length > 0) {
                    const recentCall = activeCalls[activeCalls.length - 1];
                    const callSession = callsHandler.getCallSession(recentCall.callId);

                    if (callSession && callSession.userContext) {
                        customerContext = callSession.userContext;
                        matchedCallId = recentCall.callId;

                        if (activeCalls.length > 1) {
                            console.warn('[Bridge] ⚠️  Multiple active calls detected! Using most recent call as fallback.');
                            console.warn('[Bridge] ⚠️  This may cause issues with concurrent callers.');
                            console.warn('[Bridge] Active calls:', activeCalls.map(c => c.callId));
                        } else {
                            console.log('[Bridge] Retrieved context for:', customerContext.name);
                        }
                    } else {
                        console.warn('[Bridge] Call session found but no user context');
                    }
                } else {
                    console.warn('[Bridge] No active calls found');
                }
            } else {
                console.log('[Bridge] ✅ Successfully matched context for:', customerContext.name, '(callId:', matchedCallId, ')');
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
            let lastTtsTime = 0; // Start at 0 - will be updated when TTS audio arrives
            let keepaliveTimer = null;
            let silenceFrameCount = 0;
            let keepaliveStarted = false; // Track if keepalive has been started

            // Generate PCM silence frame (16-bit PCM, 16kHz, mono, 20ms = 640 bytes)
            const generateSilenceFrame = () => {
                return Buffer.alloc(640, 0); // 320 samples * 2 bytes per sample = 640 bytes
            };

            // Continuous audio keepalive - sends silence when no TTS audio
            const startAudioKeepalive = () => {
                if (!continuousKeepalive || keepaliveStarted) return;

                // Don't start keepalive until at least 1500ms have passed
                // This gives the agent time to generate proactive greeting
                const timeSinceConnection = Date.now() - connectionStartTime;
                const minDelayMs = 1500;

                if (timeSinceConnection < minDelayMs) {
                    const remainingDelay = minDelayMs - timeSinceConnection;
                    console.log(`[Keepalive] Deferring start by ${remainingDelay}ms (need ${minDelayMs}ms minimum)`);
                    setTimeout(startAudioKeepalive, remainingDelay);
                    return;
                }

                keepaliveStarted = true;
                keepaliveTimer = setInterval(() => {
                    if (infobipWs.readyState !== WebSocket.OPEN) return;

                    const now = Date.now();
                    const timeSinceLastTts = lastTtsTime === 0 ? Infinity : (now - lastTtsTime);

                    // Send silence if: never had TTS OR >100ms since last TTS
                    if (timeSinceLastTts > 100) {
                        try {
                            const silenceFrame = generateSilenceFrame();
                            infobipWs.send(silenceFrame);
                            silenceFrameCount++;

                            // Log every 50 frames (~1 second) to avoid spam
                            if (silenceFrameCount % 50 === 0) {
                                console.log(`[Keepalive] Sent ${silenceFrameCount} silence frames`);
                            }
                        } catch (err) {
                            console.error('[Keepalive] Error sending silence frame:', err.message);
                        }
                    }
                }, keepaliveIntervalMs);

                const keepaliveStartTime = Date.now() - connectionStartTime;
                console.log(`[Keepalive] Started continuous audio keepalive at ${keepaliveStartTime}ms (${keepaliveIntervalMs}ms interval)`);
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
                    const signedUrlStart = Date.now();
                    const signedUrl = await this.signedUrlPool.get();
                    const signedUrlTime = Date.now() - signedUrlStart;
                    console.log(`[Timing] Signed URL retrieved in ${signedUrlTime}ms`);

                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        const elevenLabsConnectTime = Date.now() - connectionStartTime;
                        console.log('[ElevenLabs] WebSocket connected');
                        console.log(`[Timing] ElevenLabs connected in ${elevenLabsConnectTime}ms from Infobip connection`);

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
                            console.log('[ElevenLabs] 📋 Dynamic variables:', JSON.stringify(dynamicVariables, null, 2));

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

                        // Analyze buffered audio for silence BEFORE committing
                        if (audioBuffer.length > 0) {
                            // Calculate average amplitude to detect silence
                            let totalAmplitude = 0;
                            let sampleCount = 0;

                            audioBuffer.forEach(audioChunk => {
                                // Sample first 100 bytes of each chunk to detect silence
                                const sampleSize = Math.min(100, audioChunk.length);
                                for (let i = 0; i < sampleSize; i++) {
                                    // For 8-bit PCM, pure silence is around 128 (DC offset)
                                    // Calculate deviation from silence baseline
                                    const deviation = Math.abs(audioChunk[i] - 128);
                                    totalAmplitude += deviation;
                                    sampleCount++;
                                }
                            });

                            const avgAmplitude = sampleCount > 0 ? totalAmplitude / sampleCount : 0;
                            const isSilence = avgAmplitude < 5; // Threshold for silence detection

                            console.log(`[Bridge] Buffer analysis: ${audioBuffer.length} chunks, avg amplitude: ${avgAmplitude.toFixed(2)}, silence: ${isSilence}`);

                            if (isSilence) {
                                console.log('[Bridge] ⏭️  Discarding silent buffer - letting agent send proactive greeting');
                                audioBuffer = []; // Discard silent buffer
                                // Don't start keepalive yet - wait for agent greeting first
                            } else {
                                console.log(`[Bridge] Flushing ${audioBuffer.length} buffered audio chunk(s) to ElevenLabs`);
                                audioBuffer.forEach(audioChunk => {
                                    try {
                                        elevenLabsWs.send(JSON.stringify({
                                            user_audio_chunk: Buffer.from(audioChunk).toString('base64')
                                        }));
                                        audioChunksSinceLastCommit++;
                                    } catch (err) {
                                        console.error('[Bridge] Error flushing buffered audio:', err.message);
                                    }
                                });
                                audioBuffer = []; // Clear buffer after flushing
                                console.log('[Bridge] Audio buffer flushed successfully');

                                // Commit the buffered audio immediately so ElevenLabs processes it
                                if (audioChunksSinceLastCommit > 0) {
                                    console.log('[Bridge] Committing buffered audio to ElevenLabs');
                                    doCommit();
                                }

                                // Note: Keepalive will start automatically when agent responds
                                console.log('[Bridge] Waiting for agent response before starting keepalive');
                            }
                        } else {
                            console.log('[Bridge] No buffered audio to process');
                        }
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);

                            // Debug: Log all message types to understand structure
                            if (message.type !== 'audio' && message.type !== 'ping') {
                                console.log(`[ElevenLabs Debug] Message type: ${message.type}`, JSON.stringify(message, null, 2));
                            }

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

                                        // Start keepalive after first audio (agent is responding)
                                        if (!keepaliveStarted) {
                                            startAudioKeepalive();
                                        }
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
                                    const userText = message.user_transcription_event?.user_transcript || message.user_transcript || '';
                                    if (userText) {
                                        console.log(`\n[TRANSCRIPT] 🎤 User: "${userText}"`);
                                    }
                                    break;
                                case 'agent_response':
                                    const agentText = message.agent_response_event?.agent_response || message.agent_response || '';
                                    if (agentText) {
                                        console.log(`[TRANSCRIPT] 🤖 Agent: "${agentText}"\n`);
                                    }

                                    // Start keepalive after first agent response (proactive greeting received)
                                    if (!keepaliveStarted) {
                                        startAudioKeepalive();
                                    }
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
                    // Handle JSON control messages (may contain call metadata)
                    if (typeof message === 'string') {
                        try {
                            const controlMsg = JSON.parse(message);

                            // Strategy 3: Extract call/dialog ID from control message if we don't have context yet
                            if (!customerContext && (controlMsg['call-id'] || controlMsg['dialog-id'])) {
                                const msgCallId = controlMsg['call-id'];
                                const msgDialogId = controlMsg['dialog-id'];

                                console.log('[Bridge] Found call metadata in control message:', {
                                    callId: msgCallId,
                                    dialogId: msgDialogId
                                });

                                // Try to match by call ID first
                                if (msgCallId) {
                                    const callSession = callsHandler.getCallSession(msgCallId);
                                    if (callSession && callSession.userContext) {
                                        customerContext = callSession.userContext;
                                        matchedCallId = msgCallId;
                                        console.log('[Bridge] ✅ Matched call by control message callId:', msgCallId);
                                    }
                                }

                                // Try to match by dialog ID if still no match
                                if (!customerContext && msgDialogId) {
                                    const activeCalls = callsHandler.getActiveCalls();
                                    for (const call of activeCalls) {
                                        const session = callsHandler.getCallSession(call.callId);
                                        if (session && session.dialogId === msgDialogId) {
                                            customerContext = session.userContext;
                                            matchedCallId = call.callId;
                                            console.log('[Bridge] ✅ Matched call by control message dialogId:', msgDialogId);
                                            break;
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // Not valid JSON, ignore
                        }
                        return; // Don't process JSON messages as audio
                    }

                    // Check if binary message is actually JSON control message
                    try {
                        const msgStr = message.toString('utf8');
                        if ((msgStr.startsWith('{') || msgStr.startsWith(' {')) &&
                            (msgStr.includes('"call-id"') || msgStr.includes('"event"'))) {

                            // Try to parse and extract metadata even from binary JSON messages
                            try {
                                const controlMsg = JSON.parse(msgStr);

                                if (!customerContext && (controlMsg['call-id'] || controlMsg['dialog-id'])) {
                                    const msgCallId = controlMsg['call-id'];
                                    const msgDialogId = controlMsg['dialog-id'];

                                    console.log('[Bridge] Found call metadata in binary control message:', {
                                        callId: msgCallId,
                                        dialogId: msgDialogId
                                    });

                                    if (msgCallId) {
                                        const callSession = callsHandler.getCallSession(msgCallId);
                                        if (callSession && callSession.userContext) {
                                            customerContext = callSession.userContext;
                                            matchedCallId = msgCallId;
                                            console.log('[Bridge] ✅ Matched call by binary control message callId:', msgCallId);
                                        }
                                    }

                                    if (!customerContext && msgDialogId) {
                                        const activeCalls = callsHandler.getActiveCalls();
                                        for (const call of activeCalls) {
                                            const session = callsHandler.getCallSession(call.callId);
                                            if (session && session.dialogId === msgDialogId) {
                                                customerContext = session.userContext;
                                                matchedCallId = call.callId;
                                                console.log('[Bridge] ✅ Matched call by binary control message dialogId:', msgDialogId);
                                                break;
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                // Parsing failed, ignore
                            }

                            return; // JSON control events ignored for audio processing
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
