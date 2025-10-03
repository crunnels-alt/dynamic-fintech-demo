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
            console.log('[Bridge] New Infobip connection');

            // Extract customer context from query params or headers
            const url = new URL(req.url, `http://${req.headers.host}`);
            const customerContextParam = url.searchParams.get('customerContext') ||
                                        req.headers['x-customer-context'];
            let customerContext = null;
            let contextParseError = null;

            console.log('[Bridge] Request headers:', JSON.stringify(req.headers));
            console.log('[Bridge] Request URL:', req.url);

            if (customerContextParam) {
                try {
                    customerContext = JSON.parse(decodeURIComponent(customerContextParam));
                    console.log('[Bridge] ✅ Successfully parsed customer context');
                    console.log('[Bridge] 👤 Customer name:', customerContext.name || 'MISSING');
                    console.log('[Bridge] 🏢 Company:', customerContext.companyName || 'MISSING');
                    console.log('[Bridge] 📊 Data check - loans:', customerContext.loanApplications?.length || 0, 'transactions:', customerContext.recentTransactions?.length || 0);

                    // Validate critical fields
                    const missingFields = [];
                    if (!customerContext.name) missingFields.push('name');
                    if (!customerContext.phoneNumber) missingFields.push('phoneNumber');
                    if (!customerContext.fakeAccountNumber) missingFields.push('fakeAccountNumber');

                    if (missingFields.length > 0) {
                        console.warn('[Bridge] ⚠️  Missing critical fields:', missingFields.join(', '));
                    }
                } catch (e) {
                    contextParseError = e;
                    console.error('[Bridge] ❌ Failed to parse customer context:', e.message);
                    console.error('[Bridge] 📋 Raw context param (first 200 chars):', customerContextParam.substring(0, 200));
                }
            } else {
                console.log('[Bridge] ⚠️  No customer context provided in request');
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
                    const signedUrl = await this.getSignedUrl();
                    elevenLabsWs = new WebSocket(signedUrl);

                    elevenLabsWs.on('open', () => {
                        console.log('[ElevenLabs] Connected to Conversational AI');

                        // Build dynamic variables from customer context
                        const dynamicVariables = {};
                        const variableErrors = [];

                        if (customerContext) {
                            try {
                            // Basic customer information (matching ElevenLabs agent config)
                            dynamicVariables.customer_name = customerContext.name || 'Valued Customer';
                            dynamicVariables.company_name = customerContext.companyName || '';
                            dynamicVariables.phone_number = customerContext.phoneNumber || '';

                            // Account information (matching ElevenLabs agent config)
                            dynamicVariables.account_number = customerContext.fakeAccountNumber || '';
                            dynamicVariables.current_balance = customerContext.fakeAccountBalance || '0';

                            // Also send account_balance for backward compatibility
                            dynamicVariables.account_balance = customerContext.fakeAccountBalance || '0';

                            // Call history
                            dynamicVariables.call_count = customerContext.callCount || 0;
                            dynamicVariables.last_call_date = customerContext.lastCallDate || 'First call';
                            dynamicVariables.is_returning_customer = (customerContext.callCount || 0) > 0 ? 'yes' : 'no';

                            // Loan application information
                            try {
                                dynamicVariables.loan_status = customerContext.loanApplicationStatus || 'None';
                                if (customerContext.loanApplications && customerContext.loanApplications.length > 0) {
                                    const loan = customerContext.loanApplications[0];
                                    dynamicVariables.loan_type = loan.loan_type || loan.loanType || '';
                                    dynamicVariables.loan_amount = loan.loan_amount || loan.loanAmount || '0';
                                    dynamicVariables.loan_next_step = loan.next_step || loan.nextStep || '';
                                    dynamicVariables.loan_officer = loan.assigned_officer || loan.assignedOfficer || 'Michael Chen';
                                } else {
                                    dynamicVariables.loan_type = 'None';
                                    dynamicVariables.loan_amount = '0';
                                    dynamicVariables.loan_next_step = 'No active loan application';
                                    dynamicVariables.loan_officer = '';
                                }
                            } catch (loanError) {
                                variableErrors.push({ section: 'loan_data', error: loanError.message });
                                console.error('[ElevenLabs] ❌ Error processing loan data:', loanError.message);
                                // Set safe defaults
                                dynamicVariables.loan_status = 'None';
                                dynamicVariables.loan_type = 'None';
                                dynamicVariables.loan_amount = '0';
                                dynamicVariables.loan_next_step = 'Error loading loan data';
                                dynamicVariables.loan_officer = '';
                            }

                            // Transaction history (last 3 transactions)
                            try {
                                if (customerContext.recentTransactions && customerContext.recentTransactions.length > 0) {
                                    const transactions = customerContext.recentTransactions.slice(0, 3);
                                    dynamicVariables.recent_transaction_count = transactions.length.toString();
                                    dynamicVariables.last_transaction_merchant = transactions[0].merchant || 'Unknown';
                                    dynamicVariables.last_transaction_amount = Math.abs(transactions[0].amount || 0).toString();
                                    dynamicVariables.last_transaction_type = transactions[0].transaction_type || transactions[0].transactionType || 'debit';
                                } else {
                                    dynamicVariables.recent_transaction_count = '0';
                                    dynamicVariables.last_transaction_merchant = 'None';
                                    dynamicVariables.last_transaction_amount = '0';
                                    dynamicVariables.last_transaction_type = '';
                                }
                            } catch (txError) {
                                variableErrors.push({ section: 'transaction_data', error: txError.message });
                                console.error('[ElevenLabs] ❌ Error processing transaction data:', txError.message);
                                // Set safe defaults
                                dynamicVariables.recent_transaction_count = '0';
                                dynamicVariables.last_transaction_merchant = 'Error';
                                dynamicVariables.last_transaction_amount = '0';
                                dynamicVariables.last_transaction_type = '';
                            }

                            // Security and fraud information (matching ElevenLabs agent config)
                            dynamicVariables.is_fraud_flagged = customerContext.fraudScenario ? true : false;
                            dynamicVariables.verification_complete = true; // Always true for registered users calling in

                            // Also send our own format for backward compatibility
                            dynamicVariables.fraud_alert = customerContext.fraudScenario ? 'yes' : 'no';
                            dynamicVariables.security_level = customerContext.fraudScenario ? 'high' : 'normal';

                            // Report errors if any occurred
                            if (variableErrors.length > 0) {
                                console.error('[ElevenLabs] ⚠️  Encountered', variableErrors.length, 'error(s) while building variables:');
                                variableErrors.forEach(err => console.error('  -', err.section + ':', err.error));
                            }

                            console.log('[ElevenLabs] ✅ Dynamic variables constructed successfully');
                            console.log('[ElevenLabs] 📋 Variable count:', Object.keys(dynamicVariables).length);
                            console.log('[ElevenLabs] 👤 Customer:', dynamicVariables.customer_name, 'from', dynamicVariables.company_name);
                            console.log('[ElevenLabs] 💰 Account:', dynamicVariables.account_number, '($' + dynamicVariables.current_balance + ')');
                            console.log('[ElevenLabs] 📞 Call history:', dynamicVariables.call_count, 'calls, last:', dynamicVariables.last_call_date);
                            console.log('[ElevenLabs] 🏦 Loan:', dynamicVariables.loan_status, '-', dynamicVariables.loan_type);
                            console.log('[ElevenLabs] 💳 Transactions:', dynamicVariables.recent_transaction_count, 'recent');
                            console.log('[ElevenLabs] 🔒 Fraud flagged:', dynamicVariables.is_fraud_flagged, '- Verified:', dynamicVariables.verification_complete);
                            console.log('[ElevenLabs] 📦 Full dynamic variables:', JSON.stringify(dynamicVariables, null, 2));

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

                        const initialConfig = {
                            type: 'conversation_initiation_client_data',
                            conversation_config_override: {
                                agent: {
                                    prompt: {
                                        prompt: `You are a professional AI banking assistant for Infobip Capital, a modern fintech platform.

CUSTOMER INFORMATION:
- Name: {{customer_name}}
- Company: {{company_name}}
- Account Number: {{account_number}}
- Current Balance: ${{current_balance}}
- Phone: {{phone_number}}
- Verification Status: {{verification_complete}}

LOAN STATUS:
- Status: {{loan_status}}
- Type: {{loan_type}}
- Amount: ${{loan_amount}}
- Next Step: {{loan_next_step}}
- Assigned Officer: {{loan_officer}}

RECENT ACTIVITY:
- Recent Transactions: {{recent_transaction_count}}
- Last Transaction: ${{last_transaction_amount}} at {{last_transaction_merchant}}

SECURITY:
- Fraud Flagged: {{is_fraud_flagged}}

INSTRUCTIONS:
- Greet the customer warmly by name
- If this is a returning customer, acknowledge their previous interactions
- Proactively mention their loan status if they have an active application
- If is_fraud_flagged is true, prioritize security and offer immediate transfer to fraud department
- Be professional, helpful, and reference their specific account details when relevant
- Offer to help with account inquiries, loan applications, or transfer to a live agent`
                                    },
                                    first_message: "Hello {{customer_name}}! Welcome back to Infobip Capital. I can see you're calling from {{company_name}}. How can I assist you today?",
                                    language: "en"
                                },
                                tts: {
                                    model_id: "eleven_turbo_v2_5"
                                },
                                asr: {
                                    quality: "high"
                                },
                                vad: {
                                    enabled: true,
                                    threshold: 0.3,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 700
                                }
                            },
                            dynamic_variables: dynamicVariables
                        };

                        // Send configuration to ElevenLabs with error handling
                        try {
                            console.log('[ElevenLabs] 📤 Sending configuration with', Object.keys(dynamicVariables).length, 'dynamic variables');
                            console.log('[ElevenLabs] 📋 Config preview:', JSON.stringify({
                                type: initialConfig.type,
                                has_dynamic_variables: !!initialConfig.dynamic_variables,
                                variable_count: Object.keys(initialConfig.dynamic_variables || {}).length,
                                has_prompt_override: !!initialConfig.conversation_config_override?.agent?.prompt
                            }));

                            elevenLabsWs.send(JSON.stringify(initialConfig));
                            console.log('[ElevenLabs] ✅ Configuration sent successfully');
                        } catch (configSendError) {
                            console.error('[ElevenLabs] ❌ CRITICAL: Failed to send configuration:', configSendError.message);
                            console.error('[ElevenLabs] Stack trace:', configSendError.stack);
                            // Close connection if config fails to send
                            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                                elevenLabsWs.close(1011, 'Configuration send failure');
                            }
                        }
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const message = JSON.parse(data);
                            switch (message.type) {
                                case 'conversation_initiation_metadata':
                                    console.log('[ElevenLabs] ✅ Conversation initialized successfully');
                                    console.log('[ElevenLabs] 🎯 Conversation ID:', message.conversation_initiation_metadata_event?.conversation_id || 'N/A');
                                    console.log('[ElevenLabs] 🤖 Agent ready with personalized context');
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

                    elevenLabsWs.on('error', (error) => console.error('[ElevenLabs] WebSocket error:', error));
                    elevenLabsWs.on('close', (code, reason) => {
                        clearCommit();
                        console.log(`[ElevenLabs] Disconnected - Code: ${code}, Reason: ${reason || 'No reason provided'}`);
                    });
                } catch (error) {
                    console.error('[ElevenLabs] Setup error:', error);
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
