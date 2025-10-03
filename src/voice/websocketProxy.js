const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');
const callsHandler = require('./callsHandler');

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
            console.log('[Bridge] New Infobip connection');

            // Extract customer context from active calls
            let customerContext = null;

            console.log('[Bridge] New Infobip WebSocket connection established');
            console.log('[Bridge] Request URL:', req.url);

            // Retrieve context from most recent active call
            console.log('[Bridge] 🔍 Looking up customer context from active calls...');
            const activeCalls = callsHandler.getActiveCalls();
            console.log('[Bridge] 📊 Found', activeCalls.length, 'active call(s)');

            if (activeCalls.length > 0) {
                // Get the most recent call (the one being connected now)
                const recentCall = activeCalls[activeCalls.length - 1];
                const callSession = callsHandler.getCallSession(recentCall.callId);

                if (callSession && callSession.userContext) {
                    customerContext = callSession.userContext;
                    console.log('[Bridge] ✅ Retrieved customer context from call:', recentCall.callId);
                    console.log('[Bridge] 👤 Customer:', customerContext.name || 'MISSING');
                    console.log('[Bridge] 🏢 Company:', customerContext.companyName || 'MISSING');
                    console.log('[Bridge] 📊 Loan apps:', customerContext.loanApplications?.length || 0,
                               '| Transactions:', customerContext.recentTransactions?.length || 0);

                    // Validate critical fields
                    const missingFields = [];
                    if (!customerContext.name) missingFields.push('name');
                    if (!customerContext.phoneNumber) missingFields.push('phoneNumber');
                    if (!customerContext.fakeAccountNumber) missingFields.push('fakeAccountNumber');

                    if (missingFields.length > 0) {
                        console.warn('[Bridge] ⚠️  Missing required fields:', missingFields.join(', '));
                    }
                } else {
                    console.log('[Bridge] ⚠️  Call session found but no user context');
                }
            } else {
                console.log('[Bridge] ⚠️  No active calls found');
            }

            let elevenLabsWs = null;
            let commitTimer = null;
            let audioChunksReceived = 0;
            let audioChunksSinceLastCommit = 0;
            let lastAudioTime = Date.now();
            let lastCommitTime = Date.now();
            const idleCommitMs = Number(process.env.ELEVENLABS_IDLE_COMMIT_MS || 500);
            const maxCommitIntervalMs = Number(process.env.ELEVENLABS_MAX_COMMIT_INTERVAL_MS || 2000);
            const autoResponseCreate = (process.env.ELEVENLABS_AUTO_RESPONSE_CREATE ?? 'true').toLowerCase() !== 'false';

            const clearCommit = () => {
                if (commitTimer) {
                    clearTimeout(commitTimer);
                    commitTimer = null;
                }
            };

            const doCommit = () => {
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN && audioChunksSinceLastCommit > 0) {
                    try {
                        const timeSinceLastCommit = Date.now() - lastCommitTime;
                        console.log(`[ElevenLabs] ✅ Committing audio buffer (${audioChunksSinceLastCommit} chunks, ${timeSinceLastCommit}ms since last commit)`);
                        elevenLabsWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                        if (autoResponseCreate) {
                            elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
                        }
                        audioChunksSinceLastCommit = 0;
                        lastCommitTime = Date.now();
                    } catch (e) {
                        console.error('[ElevenLabs] ❌ Commit error:', e.message || e);
                    }
                }
            };

            const scheduleCommit = () => {
                // Force commit if we haven't committed in maxCommitIntervalMs (prevents infinite buffering)
                const timeSinceLastCommit = Date.now() - lastCommitTime;
                if (timeSinceLastCommit >= maxCommitIntervalMs) {
                    console.log(`[ElevenLabs] ⚡ Force committing - ${timeSinceLastCommit}ms since last commit`);
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
                    console.log('[ElevenLabs] 🔄 Requesting signed URL...');
                    const signedUrlStartTime = Date.now();

                    const signedUrl = await this.getSignedUrl();

                    const signedUrlDuration = Date.now() - signedUrlStartTime;
                    console.log(`[ElevenLabs] ✅ Got signed URL in ${signedUrlDuration}ms`);
                    console.log(`[ElevenLabs] 🔗 URL preview: ${signedUrl.substring(0, 80)}...`);

                    console.log('[ElevenLabs] 🔌 Attempting WebSocket connection...');
                    const wsConnectStartTime = Date.now();
                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        const wsConnectDuration = Date.now() - wsConnectStartTime;
                        console.log(`[ElevenLabs] ✅ WebSocket connected in ${wsConnectDuration}ms`);
                        console.log('[ElevenLabs] 📡 Connection state: OPEN (readyState: 1)');

                        // Build dynamic variables from customer context
                        const dynamicVariables = {};
                        const variableErrors = [];

                        if (customerContext) {
                            try {
                            // ONLY send the 8 variables defined in the ElevenLabs agent
                            // Sending extra variables causes ElevenLabs to reject the conversation!

                            // 1. customer_name
                            dynamicVariables.customer_name = customerContext.name || 'Valued Customer';

                            // 2. company_name
                            dynamicVariables.company_name = customerContext.companyName || 'Your Company';

                            // 3. current_balance
                            dynamicVariables.current_balance = customerContext.fakeAccountBalance || '0.00';

                            // 4. account_number
                            dynamicVariables.account_number = customerContext.fakeAccountNumber || 'ACC000000000';

                            // 5. loan_status
                            dynamicVariables.loan_status = customerContext.loanApplicationStatus || 'No Active Applications';

                            // 6. phone_number
                            dynamicVariables.phone_number = customerContext.phoneNumber || '';

                            // 7. is_fraud_flagged
                            dynamicVariables.is_fraud_flagged = customerContext.fraudScenario ? true : false;

                            // 8. verification_complete
                            dynamicVariables.verification_complete = true; // Always true for registered users

                            console.log('[ElevenLabs] ✅ Dynamic variables constructed (8 variables matching agent config)');
                            console.log('[ElevenLabs] 👤 Customer:', dynamicVariables.customer_name, 'from', dynamicVariables.company_name);
                            console.log('[ElevenLabs] 💰 Account:', dynamicVariables.account_number, '($' + dynamicVariables.current_balance + ')');
                            console.log('[ElevenLabs] 🏦 Loan status:', dynamicVariables.loan_status);
                            console.log('[ElevenLabs] 🔒 Fraud:', dynamicVariables.is_fraud_flagged, '| Verified:', dynamicVariables.verification_complete);
                            console.log('[ElevenLabs] 📦 All variables:', JSON.stringify(dynamicVariables, null, 2));

                            } catch (variableConstructionError) {
                                console.error('[ElevenLabs] ❌ CRITICAL: Failed to construct dynamic variables:', variableConstructionError.message);
                                console.error('[ElevenLabs] Stack trace:', variableConstructionError.stack);
                                // Continue with empty variables rather than crashing
                            }
                        } else {
                            console.log('[ElevenLabs] ⚠️  No customer context available - conversation will use default/generic behavior');
                            if (contextParseError) {
                                console.error('[ElevenLabs] 💥 Context parse error details:', contextParseError.message);
                            }
                        }

                        // Use agent's configured prompt from dashboard - just send dynamic variables
                        // The prompt in the dashboard already has the correct {{variable}} placeholders
                        const initialConfig = {
                            type: 'conversation_initiation_client_data',
                            dynamic_variables: dynamicVariables
                        };

                        // Send configuration to ElevenLabs with error handling
                        try {
                            console.log('[ElevenLabs] 📤 Preparing to send configuration...');
                            console.log('[ElevenLabs] 📊 Config stats:', {
                                variable_count: Object.keys(dynamicVariables).length,
                                has_prompt: !!initialConfig.conversation_config_override?.agent?.prompt,
                                has_first_message: !!initialConfig.conversation_config_override?.agent?.first_message,
                                prompt_length: initialConfig.conversation_config_override?.agent?.prompt?.prompt?.length || 0
                            });

                            // Validate config is valid JSON before sending
                            const configJson = JSON.stringify(initialConfig);
                            console.log(`[ElevenLabs] 📏 Config size: ${configJson.length} characters`);

                            if (configJson.length > 50000) {
                                console.warn('[ElevenLabs] ⚠️  Large config size, might cause issues');
                            }

                            console.log('[ElevenLabs] 📡 Sending config to ElevenLabs...');
                            elevenLabsWs.send(configJson);
                            console.log('[ElevenLabs] ✅ Configuration sent successfully');
                        } catch (configSendError) {
                            console.error('[ElevenLabs] ❌ CRITICAL: Failed to send configuration');
                            console.error('[ElevenLabs] 💥 Error:', configSendError.message);
                            console.error('[ElevenLabs] 📋 Stack:', configSendError.stack);
                            // Close connection if config fails to send
                            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                                console.log('[ElevenLabs] 🔌 Closing connection due to config error');
                                elevenLabsWs.close(1011, 'Configuration send failure');
                            }
                        }
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);

                            // Log ALL message types to debug audio flow
                            console.log(`[ElevenLabs] 📥 Received message type: ${message.type}`);

                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] ✅ Conversation initialized successfully');
                                    console.log('[ElevenLabs] 🎯 Conversation ID:', message.conversation_initiation_metadata_event?.conversation_id || 'N/A');
                                    console.log('[ElevenLabs] 🤖 Agent ready with personalized context');
                                    break;
                                case 'audio': {
                                    console.log('[ElevenLabs] 🔊 AUDIO EVENT RECEIVED!');
                                    console.log('[ElevenLabs] 🔊 Message keys:', Object.keys(message));

                                    // Check different possible audio field locations
                                    let audioData = null;
                                    if (message.audio_event?.audio_base_64) {
                                        audioData = message.audio_event.audio_base_64;
                                        console.log('[ElevenLabs] 🔊 Audio found at: message.audio_event.audio_base_64');
                                    } else if (message.audio_base_64) {
                                        audioData = message.audio_base_64;
                                        console.log('[ElevenLabs] 🔊 Audio found at: message.audio_base_64');
                                    } else if (message.audio) {
                                        audioData = message.audio;
                                        console.log('[ElevenLabs] 🔊 Audio found at: message.audio');
                                    } else {
                                        console.error('[ElevenLabs] ❌ NO AUDIO DATA FOUND IN MESSAGE');
                                        console.error('[ElevenLabs] ❌ Message structure:', JSON.stringify(message, null, 2));
                                    }

                                    if (audioData) {
                                        const buff = Buffer.from(audioData, 'base64');
                                        console.log('[ElevenLabs] 🔊 Audio buffer size:', buff.length, 'bytes');

                                        if (infobipWs.readyState === WebSocket.OPEN) {
                                            infobipWs.send(buff);
                                            console.log('[ElevenLabs → Infobip] ✅ Sent audio chunk');
                                        } else {
                                            console.error('[ElevenLabs → Infobip] ❌ Cannot send audio - Infobip WS not open. State:', infobipWs.readyState);
                                        }
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
                                case 'error':
                                    console.error(`[ElevenLabs] ❌ ERROR EVENT RECEIVED:`, JSON.stringify(message, null, 2));
                                    if (message.error) {
                                        console.error(`[ElevenLabs] 💥 Error type:`, message.error.type || 'unknown');
                                        console.error(`[ElevenLabs] 💥 Error message:`, message.error.message || 'no message');
                                        console.error(`[ElevenLabs] 💥 Error code:`, message.error.code || 'no code');
                                    }
                                    // Check if error is related to dynamic variables
                                    const errorStr = JSON.stringify(message).toLowerCase();
                                    if (errorStr.includes('variable') || errorStr.includes('dynamic') || errorStr.includes('substitution')) {
                                        console.error(`[ElevenLabs] ⚠️  ERROR MAY BE RELATED TO DYNAMIC VARIABLES`);
                                        console.error(`[ElevenLabs] 📋 Variables that were sent:`, Object.keys(dynamicVariables));
                                    }
                                    break;
                                default:
                                    console.log(`[ElevenLabs] Unknown message type: ${message.type}`);
                                    break;
                            }
                        } catch (error) {
                            console.error('[ElevenLabs] Error processing message:', error);
                        }
                    });

                    elevenLabsWs.on('error', (error) => {
                        console.error('[ElevenLabs] ❌ WebSocket ERROR occurred');
                        console.error('[ElevenLabs] 💥 Error message:', error.message || 'No message');
                        console.error('[ElevenLabs] 📊 Error details:', {
                            type: error.type,
                            code: error.code,
                            errno: error.errno,
                            syscall: error.syscall,
                            address: error.address,
                            port: error.port
                        });
                    });

                    elevenLabsWs.on('close', (code, reason) => {
                        clearCommit();
                        console.log('[ElevenLabs] 🔌 WebSocket CLOSED');
                        console.log(`[ElevenLabs] 📊 Close code: ${code}`);
                        console.log(`[ElevenLabs] 📋 Close reason: ${reason ? `"${reason}"` : 'No reason provided'}`);

                        // Interpret close codes
                        const closeCodeMeanings = {
                            1000: '✅ Normal closure - connection completed successfully',
                            1001: '⚠️  Going away - endpoint going down or browser navigated away',
                            1002: '❌ Protocol error - endpoint received malformed frame',
                            1003: '❌ Unsupported data - endpoint received data it cannot accept',
                            1006: '❌ Abnormal closure - connection lost without close frame',
                            1007: '❌ Invalid data - message with inconsistent data type',
                            1008: '❌ Policy violation - endpoint received message that violates policy',
                            1009: '❌ Message too big - data frame too large',
                            1010: '❌ Extension required - client expected negotiation',
                            1011: '❌ Server error - server terminating due to unexpected condition',
                            1015: '❌ TLS handshake failure - failed to perform TLS handshake'
                        };

                        const meaning = closeCodeMeanings[code] || `⚠️  Unknown close code: ${code}`;
                        console.log(`[ElevenLabs] 📖 Meaning: ${meaning}`);

                        if (code !== 1000) {
                            console.error('[ElevenLabs] ⚠️  Abnormal disconnection detected!');
                        }
                    });
                } catch (error) {
                    console.error('[ElevenLabs] ❌ CRITICAL: Setup failed');
                    console.error('[ElevenLabs] 💥 Error type:', error.constructor.name);
                    console.error('[ElevenLabs] 💥 Error message:', error.message);
                    console.error('[ElevenLabs] 📋 Stack trace:', error.stack);

                    // Check for specific error types
                    if (error.message?.includes('getSignedUrl')) {
                        console.error('[ElevenLabs] ⚠️  Failed to get signed URL from ElevenLabs API');
                    } else if (error.message?.includes('WebSocket')) {
                        console.error('[ElevenLabs] ⚠️  WebSocket connection failed');
                    } else if (error.message?.includes('timeout')) {
                        console.error('[ElevenLabs] ⚠️  Connection timeout');
                    }
                }
            })();

            // Handle messages from Infobip
            infobipWs.on('message', (message) => {
                try {
                    // Try to parse as JSON first (control messages)
                    if (typeof message === 'string') {
                        console.log('[Infobip] Received JSON string message:', message);
                        return; // JSON control events ignored
                    }

                    // Check if binary message is actually JSON (proper detection)
                    // JSON control messages are usually ASCII text starting with { or space
                    // Real audio will have binary data throughout
                    try {
                        const msgStr = message.toString('utf8');
                        // Only treat as JSON if it's valid JSON AND contains expected keys
                        if ((msgStr.startsWith('{') || msgStr.startsWith(' {')) &&
                            (msgStr.includes('"call-id"') || msgStr.includes('"event"'))) {
                            console.log('[Infobip] Received JSON control message:', msgStr.substring(0, 100));
                            return; // JSON control events ignored
                        }
                    } catch (e) {
                        // If toString fails, it's definitely binary audio
                    }

                    audioChunksReceived++;
                    audioChunksSinceLastCommit++;
                    lastAudioTime = Date.now();

                    // Log first REAL audio chunk details for debugging
                    if (audioChunksReceived === 1) {
                        console.log(`[Infobip] First REAL audio chunk: ${message.length} bytes`);
                        console.log(`[Infobip] First 20 bytes (hex):`, Buffer.from(message).slice(0, 20).toString('hex'));
                    }

                    // Detect if we ever receive non-silence audio
                    const hasNonZero = Buffer.from(message).some(byte => byte !== 0);
                    if (hasNonZero && audioChunksReceived % 100 === 0) {
                        console.log(`[Infobip] ✅ Received non-silence audio at chunk ${audioChunksReceived}`);
                    }

                    if (audioChunksReceived % 50 === 0) {
                        console.log(`[Infobip → ElevenLabs] Sent ${audioChunksReceived} audio chunks (${message.length} bytes each)`);
                    }

                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                        // Use the OLD API format that was working on Sept 26
                        elevenLabsWs.send(JSON.stringify({
                            user_audio_chunk: Buffer.from(message).toString('base64')
                        }));
                        // No need to schedule commits with old API - it handles audio automatically
                    } else {
                        console.warn(`[Infobip] Cannot send audio - ElevenLabs WS not open (state: ${elevenLabsWs?.readyState})`);
                    }
                } catch (error) {
                    console.error('[Infobip] Error processing message:', error);
                }
            });

            // Handle WebSocket closure
            infobipWs.on('close', (code, reason) => {
                clearCommit();
                console.log(`[Infobip] Client disconnected - Code: ${code}, Reason: ${reason || 'No reason provided'}`);
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
            console.log('[ElevenLabs API] 🔑 Requesting signed URL...');
            console.log('[ElevenLabs API] 🆔 Agent ID:', this.elevenLabsAgentId);

            const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.elevenLabsAgentId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'xi-api-key': this.elevenLabsApiKey,
                },
            });

            console.log('[ElevenLabs API] 📡 Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[ElevenLabs API] ❌ API Error Response:', errorText);
                throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            console.log('[ElevenLabs API] ✅ Successfully received signed URL');
            console.log('[ElevenLabs API] 📊 Response keys:', Object.keys(data));

            if (!data.signed_url) {
                console.error('[ElevenLabs API] ❌ Missing signed_url in response:', data);
                throw new Error('Signed URL not found in API response');
            }

            return data.signed_url;
        } catch (error) {
            console.error('[ElevenLabs API] ❌ Failed to get signed URL');
            console.error('[ElevenLabs API] 💥 Error:', error.message);
            console.error('[ElevenLabs API] 📋 Stack:', error.stack);
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
