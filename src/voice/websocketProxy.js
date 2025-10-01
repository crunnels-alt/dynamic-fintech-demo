const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');
const callsHandler = require('./callsHandler');
const { safeStringify } = require('../utils/jsonSanitizer');

class WebSocketProxy {
    constructor() {
        this.elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID;
        this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        this.port = process.env.WS_PROXY_PORT || 3500;

        this.server = http.createServer();
        this.wss = new WebSocket.Server({ server: this.server });

        // Active connections tracking
        this.activeConnections = new Map();

        // Pre-established ElevenLabs connections ready for incoming calls
        this.pendingElevenLabsConnections = new Map();

        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (infobipWs, request) => {
            const connectionId = this.generateConnectionId();
            console.log(`🔌 New WebSocket connection ${connectionId} from Infobip`);
            
            this.handleWebsocketConnection(infobipWs, connectionId);
        });

        this.wss.on('error', (error) => {
            console.error('❌ WebSocket Server error:', error);
        });
    }

    generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Pre-establish ElevenLabs WebSocket connection for a call
     * @param {string} callId - The call ID to associate with this connection
     * @param {object} userContext - User context for personalization
     * @returns {Promise<object>} - Object with WebSocket and signed URL
     */
    async prepareElevenLabsConnection(callId, userContext) {
        console.log(`🚀 [${callId}] Pre-establishing ElevenLabs connection...`);

        try {
            const signedUrl = await this.getSignedUrl(callId);
            if (!signedUrl) {
                console.error(`❌ [${callId}] Could not get signed URL`);
                return null;
            }

            const elevenLabsWs = new WebSocket(signedUrl);

            // Wait for connection to open with timeout
            const connectionPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('ElevenLabs connection timeout'));
                }, 10000);

                elevenLabsWs.on('open', () => {
                    clearTimeout(timeout);
                    console.log(`✅ [${callId}] ElevenLabs connection ready BEFORE dialog creation`);
                    resolve();
                });

                elevenLabsWs.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            await connectionPromise;

            // Store the ready connection
            this.pendingElevenLabsConnections.set(callId, {
                ws: elevenLabsWs,
                userContext,
                createdAt: Date.now()
            });

            console.log(`✅ [${callId}] ElevenLabs connection stored and ready for use`);
            return { ws: elevenLabsWs, signedUrl };

        } catch (error) {
            console.error(`❌ [${callId}] Failed to prepare ElevenLabs connection:`, error.message);
            return null;
        }
    }

    /**
     * Get signed URL for ElevenLabs connection
     * @param {string} identifier - Call or connection identifier for logging
     * @returns {Promise<string|null>} - Signed URL or null
     */
    async getSignedUrl(identifier) {
        try {
            console.log(`🔗 [${identifier}] Getting ElevenLabs signed URL...`);
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
                console.error(`❌ [${identifier}] Signed URL request failed: ${response.status} ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            console.log(`✅ [${identifier}] Got signed URL successfully`);
            return data.signed_url;
        } catch (error) {
            console.error(`❌ [${identifier}] Error getting ElevenLabs signed URL:`, error.message);
            return null;
        }
    }

    /**
     * Set up message handlers for ElevenLabs WebSocket
     * @param {string} connectionId - Connection identifier
     * @param {WebSocket} elevenLabsWs - ElevenLabs WebSocket
     * @param {WebSocket} infobipWs - Infobip WebSocket
     */
    setupElevenLabsMessageHandlers(connectionId, elevenLabsWs, infobipWs) {
        elevenLabsWs.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleElevenLabsMessage(connectionId, message, infobipWs, elevenLabsWs);
            } catch (error) {
                console.error(`❌ [${connectionId}] Error parsing ElevenLabs message:`, error);
            }
        });

        elevenLabsWs.on('error', (error) => {
            console.error(`❌ [${connectionId}] ElevenLabs WebSocket error:`, error.message);
        });

        elevenLabsWs.on('close', (code, reason) => {
            console.log(`🤖 [${connectionId}] ElevenLabs WebSocket closed - Code: ${code}`);
            if (code !== 1000) {
                console.error(`⚠️  [${connectionId}] Abnormal ElevenLabs disconnection`);
            }
        });
    }

    /**
     * Set up message handlers for Infobip WebSocket
     * @param {string} connectionId - Connection identifier
     * @param {WebSocket} infobipWs - Infobip WebSocket
     * @param {WebSocket} elevenLabsWs - ElevenLabs WebSocket
     */
    setupInfobipMessageHandlers(connectionId, infobipWs, elevenLabsWs) {
        // Handle messages from Infobip
        infobipWs.on('message', (message) => {
            try {
                if (typeof message === 'string') {
                    // JSON event from Infobip - ignore for now
                    return;
                }

                // Binary audio data from Infobip - forward to ElevenLabs
                console.log(`🎤 [${connectionId}] Received ${message.length} bytes of audio from Infobip`);
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                    const audioMessage = {
                        user_audio_chunk: Buffer.from(message).toString('base64'),
                    };
                    elevenLabsWs.send(safeStringify(audioMessage));
                    console.log(`📤 [${connectionId}] Forwarded audio to ElevenLabs`);
                } else {
                    console.log(`⚠️  [${connectionId}] ElevenLabs WebSocket not ready, audio dropped`);
                }
            } catch (error) {
                console.error(`❌ [${connectionId}] Error processing Infobip message:`, error);
            }
        });

        // Handle WebSocket closure
        infobipWs.on('close', () => {
            console.log(`📞 [${connectionId}] Infobip client disconnected`);

            if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
            }

            // Clean up connection tracking
            this.activeConnections.delete(connectionId);
        });

        infobipWs.on('error', (error) => {
            console.error(`❌ Infobip WebSocket error for ${connectionId}:`, error);
        });
    }

    /**
     * Send conversation initialization to ElevenLabs
     * @param {string} connectionId - Connection identifier
     * @param {WebSocket} elevenLabsWs - ElevenLabs WebSocket
     * @param {object} userContext - User context for personalization
     */
    async sendConversationInitialization(connectionId, elevenLabsWs, userContext) {
        if (!userContext || !userContext.name || userContext.name === 'New Caller') {
            const conversationData = {
                type: "conversation_initiation_client_data",
                dynamicVariables: {
                    customer_name: 'New Caller',
                    verification_complete: false
                },
                overrides: {
                    agent: {
                        firstMessage: "Hello! Thank you for calling Infobip Capital. I'm your AI banking assistant. May I have your name so I can look up your account?"
                    }
                }
            };
            console.log(`📤 [${connectionId}] Sending generic conversation data`);
            elevenLabsWs.send(safeStringify(conversationData));
            return;
        }

        const balance = parseFloat(userContext.fakeAccountBalance || 0).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD'
        });

        const conversationData = {
            type: "conversation_initiation_client_data",
            dynamicVariables: {
                customer_name: userContext.name,
                company_name: userContext.companyName,
                account_number: userContext.fakeAccountNumber,
                current_balance: balance,
                phone_number: userContext.phoneNumber,
                loan_status: userContext.loanApplicationStatus || 'None',
                is_fraud_flagged: userContext.fraudScenario || false,
                verification_complete: true
            },
            overrides: {
                agent: {
                    firstMessage: "Hello {{customer_name}}! Thank you for calling Infobip Capital. I can see you're calling from your registered number, and your current account balance is {{current_balance}}. How can I help you today?"
                }
            }
        };

        console.log(`📤 [${connectionId}] Sending personalized conversation data for ${userContext.name}`);
        console.log(`🔍 [${connectionId}] Config:`, safeStringify(conversationData, 2));
        elevenLabsWs.send(safeStringify(conversationData));
    }

    async handleWebsocketConnection(infobipWs, connectionId) {
        let elevenLabsWs = null;
        let userContext = null;

        console.log(`📍 [${connectionId}] WebSocket connection established from Infobip`);

        // Store connection info
        this.activeConnections.set(connectionId, {
            infobipWs,
            elevenLabsWs: null,
            startTime: Date.now(),
            userContext: null
        });

        // 🎯 Try to get user context from active calls
        const activeCalls = callsHandler.getActiveCalls();
        console.log(`🔍 [${connectionId}] Active calls count:`, activeCalls.length);

        let callId = null;
        if (activeCalls.length > 0) {
            // Get the most recent call (likely the one that just connected)
            const recentCall = activeCalls[activeCalls.length - 1];
            callId = recentCall.callId;
            console.log(`🔍 [${connectionId}] Using recent call:`, callId, 'for user:', recentCall.userName);

            const callSession = callsHandler.getCallSession(callId);
            console.log(`🔍 [${connectionId}] Call session:`, callSession ? 'FOUND' : 'NOT FOUND');

            if (callSession?.userContext) {
                userContext = callSession.userContext;
                console.log(`🎯 [${connectionId}] Found user context for: ${userContext.name || 'Unknown User'}`);
                console.log(`🔍 [${connectionId}] User details:`, {
                    name: userContext.name,
                    company: userContext.companyName,
                    balance: userContext.fakeAccountBalance
                });

                // Update connection with user context
                const connection = this.activeConnections.get(connectionId);
                if (connection) {
                    connection.userContext = userContext;
                }
            } else {
                console.log(`⚠️  [${connectionId}] No user context found in call session`);
            }
        } else {
            console.log(`⚠️  [${connectionId}] No active calls found`);
        }

        // 🚀 NEW: Check if we have a pre-established ElevenLabs connection for this call
        if (callId && this.pendingElevenLabsConnections.has(callId)) {
            console.log(`⚡ [${connectionId}] Found pre-established ElevenLabs connection for call ${callId}`);
            const pending = this.pendingElevenLabsConnections.get(callId);
            elevenLabsWs = pending.ws;
            userContext = pending.userContext;

            // Remove from pending pool
            this.pendingElevenLabsConnections.delete(callId);

            // Update connection tracking
            const connection = this.activeConnections.get(connectionId);
            if (connection) {
                connection.elevenLabsWs = elevenLabsWs;
                connection.userContext = userContext;
            }

            // Set up message handlers for the pre-established connection
            this.setupElevenLabsMessageHandlers(connectionId, elevenLabsWs, infobipWs);

            // Send conversation initialization immediately since connection is ready
            await this.sendConversationInitialization(connectionId, elevenLabsWs, userContext);

            // Set up Infobip message handlers to forward audio to ElevenLabs
            this.setupInfobipMessageHandlers(connectionId, infobipWs, elevenLabsWs);

            console.log(`✅ [${connectionId}] Pre-established connection activated and ready`);
            return; // Exit early - all handlers are set up
        } else {
            console.log(`⚠️  [${connectionId}] No pre-established connection, falling back to on-demand setup`);
        }

        infobipWs.on('error', (error) => {
            console.error(`❌ Infobip WebSocket error for ${connectionId}:`, error);
        });

        // Get signed URL for ElevenLabs connection
        const getSignedUrl = async () => {
            try {
                console.log(`🔗 [${connectionId}] Getting ElevenLabs signed URL...`);
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
                    console.error(`❌ [${connectionId}] Signed URL request failed: ${response.status} ${response.statusText}`);
                    throw new Error(`Failed to get signed URL: ${response.statusText}`);
                }

                const data = await response.json();
                console.log(`✅ [${connectionId}] Got signed URL successfully`);
                return data.signed_url;
            } catch (error) {
                console.error(`❌ [${connectionId}] Error getting ElevenLabs signed URL:`, error.message);
                console.error(`❌ [${connectionId}] Error code:`, error.code);
                console.error(`❌ [${connectionId}] Error stack:`, error.stack);

                // Don't throw - this crashes the webhook and causes 502 errors
                // Instead return null so we can handle it gracefully
                return null;
            }
        };

        const setupElevenLabs = async () => {
            try {
                // Prepare conversation initialization data BEFORE getting signed URL
                let conversationData;

                if (userContext && userContext.name && userContext.name !== 'New Caller') {
                    console.log(`🎯 [${connectionId}] User context found: ${userContext.name} (${userContext.companyName})`);
                    console.log(`💰 [${connectionId}] Account balance: $${userContext.fakeAccountBalance}`);

                    // Format balance for display
                    const balance = parseFloat(userContext.fakeAccountBalance || 0).toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD'
                    });

                    conversationData = {
                        type: "conversation_initiation_client_data",
                        dynamicVariables: {
                            customer_name: userContext.name,
                            company_name: userContext.companyName,
                            account_number: userContext.fakeAccountNumber,
                            current_balance: balance,
                            phone_number: userContext.phoneNumber,
                            loan_status: userContext.loanApplicationStatus || 'None',
                            is_fraud_flagged: userContext.fraudScenario || false,
                            verification_complete: true
                        },
                        overrides: {
                            agent: {
                                firstMessage: "Hello {{customer_name}}! Thank you for calling Infobip Capital. I can see you're calling from your registered number, and your current account balance is {{current_balance}}. How can I help you today?"
                            }
                        }
                    };

                    console.log(`📤 [${connectionId}] Sending personalized greeting for ${userContext.name} with balance ${balance}`);
                    console.log(`🔍 [${connectionId}] Full config being sent:`, safeStringify(conversationData, 2));
                } else {
                    conversationData = {
                        type: "conversation_initiation_client_data",
                        dynamicVariables: {
                            customer_name: 'New Caller',
                            verification_complete: false
                        },
                        overrides: {
                            agent: {
                                firstMessage: "Hello! Thank you for calling Infobip Capital. I'm your AI banking assistant. May I have your name so I can look up your account?"
                            }
                        }
                    };

                    console.log(`📤 [${connectionId}] Sending basic config for unidentified caller`);
                }

                const signedUrl = await getSignedUrl();

                if (!signedUrl) {
                    console.error(`❌ [${connectionId}] Could not get signed URL from ElevenLabs - aborting connection`);
                    console.log(`📞 [${connectionId}] Call will continue without ElevenLabs (fallback mode)`);
                    return; // Exit gracefully without crashing
                }

                console.log(`🔗 [${connectionId}] Got signed URL, attempting WebSocket connection...`);
                console.log(`🔍 [${connectionId}] WebSocket URL: ${signedUrl.substring(0, 50)}...`);

                try {
                    elevenLabsWs = new WebSocket(signedUrl);
                    console.log(`✅ [${connectionId}] WebSocket object created, waiting for connection...`);
                } catch (wsCreateError) {
                    console.error(`❌ [${connectionId}] Failed to create WebSocket object:`, wsCreateError);
                    console.error(`❌ [${connectionId}] WebSocket creation error details:`, wsCreateError.message);
                    return;
                }

                // Update connection tracking
                const connection = this.activeConnections.get(connectionId);
                if (connection) {
                    connection.elevenLabsWs = elevenLabsWs;
                }

                // Add connection state monitoring
                console.log(`⏳ [${connectionId}] WebSocket readyState: ${elevenLabsWs.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);

                // Set up a timeout to detect if connection never happens
                const connectionTimeout = setTimeout(() => {
                    if (elevenLabsWs.readyState === WebSocket.CONNECTING) {
                        console.error(`⏰ [${connectionId}] ❌ TIMEOUT: WebSocket still connecting after 10 seconds`);
                        console.error(`⏰ [${connectionId}] This indicates network or ElevenLabs service issues`);
                        console.error(`⏰ [${connectionId}] Current readyState: ${elevenLabsWs.readyState}`);
                        elevenLabsWs.terminate(); // Force close the hanging connection
                    }
                }, 10000); // 10 second timeout

                elevenLabsWs.on('open', () => {
                    clearTimeout(connectionTimeout); // Clear timeout on successful connection
                    console.log(`🤖 [${connectionId}] ✅ SUCCESSFULLY connected to ElevenLabs Conversational AI`);
                    console.log(`✅ [${connectionId}] WebSocket readyState after open: ${elevenLabsWs.readyState}`);

                    // TESTING: If we already have hardcoded context, send it immediately
                    if (userContext && userContext.name === "Connor Runnels") {
                        console.log(`🚀 [${connectionId}] TESTING: Sending hardcoded conversation data immediately`);

                        const balance = parseFloat(userContext.fakeAccountBalance || 0).toLocaleString('en-US', {
                            style: 'currency',
                            currency: 'USD'
                        });

                        const testConversationData = {
                            type: "conversation_initiation_client_data",
                            dynamic_variables: {
                                customer_name: userContext.name,
                                company_name: userContext.companyName,
                                account_number: userContext.fakeAccountNumber,
                                current_balance: balance,
                                phone_number: userContext.phoneNumber,
                                loan_status: userContext.loanApplicationStatus || 'None',
                                is_fraud_flagged: userContext.fraudScenario || false,
                                verification_complete: true
                            },
                            overrides: {
                                agent: {
                                    firstMessage: "Hello {{customer_name}}! Thank you for calling Infobip Capital. I can see you're calling from your registered number, and your current account balance is {{current_balance}}. How can I help you today?"
                                }
                            }
                        };

                        console.log(`🔧 [${connectionId}] TEST conversation data:`, safeStringify(testConversationData, 2));
                        elevenLabsWs.send(safeStringify(testConversationData));

                        // Also try sending a follow-up message to explicitly set customer context
                        setTimeout(() => {
                            const contextMessage = {
                                type: "conversation_update",
                                customer_authenticated: true,
                                customer_info: {
                                    name: userContext.name,
                                    balance: balance,
                                    account: userContext.fakeAccountNumber,
                                    verification_status: "verified_by_phone"
                                },
                                instruction: `Customer ${userContext.name} has been verified via phone number ${userContext.phoneNumber}. Current balance: ${balance}. Skip all authentication - customer is already verified.`
                            };
                            console.log(`🔧 [${connectionId}] Sending context update:`, safeStringify(contextMessage, 2));
                            elevenLabsWs.send(safeStringify(contextMessage));
                        }, 500);

                        // Try sending a simple text message that tells the agent about the customer
                        setTimeout(() => {
                            const textMessage = {
                                type: "text",
                                text: `SYSTEM: Customer ${userContext.name} from ${userContext.companyName} is calling. Phone verified: ${userContext.phoneNumber}. Account balance: ${balance}. Account number: ${userContext.fakeAccountNumber}. Customer is PRE-AUTHENTICATED - skip all verification steps.`
                            };
                            console.log(`🔧 [${connectionId}] Sending text message:`, safeStringify(textMessage, 2));
                            elevenLabsWs.send(safeStringify(textMessage));
                        }, 1000);

                        return; // Skip the retry logic
                    }

                    // Try multiple times to get user context as call session may not be ready immediately
                    const tryGetUserContext = async (attempt = 1, maxAttempts = 3) => {
                        console.log(`🔄 [${connectionId}] Attempt ${attempt}/${maxAttempts} to find user context...`);

                        // Try to get user context again
                        const activeCalls = callsHandler.getActiveCalls();
                        console.log(`🔍 [${connectionId}] Active calls (attempt ${attempt}):`, activeCalls.length);

                        let finalUserContext = userContext;
                        if (!finalUserContext && activeCalls.length > 0) {
                            const recentCall = activeCalls[activeCalls.length - 1];
                            const callSession = callsHandler.getCallSession(recentCall.callId);
                            if (callSession?.userContext) {
                                finalUserContext = callSession.userContext;
                                console.log(`🎯 [${connectionId}] Found user context on attempt ${attempt}: ${finalUserContext.name}`);
                            }
                        }

                        if (finalUserContext || attempt >= maxAttempts) {
                            return finalUserContext;
                        }

                        // Wait longer and try again
                        console.log(`⏳ [${connectionId}] No user context yet, waiting ${attempt * 1000}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                        return tryGetUserContext(attempt + 1, maxAttempts);
                    };

                    setTimeout(async () => {
                        const finalUserContext = await tryGetUserContext();

                        // Rebuild conversation data with updated context
                        let finalConversationData;
                        if (finalUserContext && finalUserContext.name && finalUserContext.name !== 'New Caller') {
                            const balance = parseFloat(finalUserContext.fakeAccountBalance || 0).toLocaleString('en-US', {
                                style: 'currency',
                                currency: 'USD'
                            });

                            finalConversationData = {
                                type: "conversation_initiation_client_data",
                                dynamicVariables: {
                                    customer_name: finalUserContext.name,
                                    company_name: finalUserContext.companyName,
                                    account_number: finalUserContext.fakeAccountNumber,
                                    current_balance: balance,
                                    phone_number: finalUserContext.phoneNumber,
                                    loan_status: finalUserContext.loanApplicationStatus || 'None',
                                    is_fraud_flagged: finalUserContext.fraudScenario || false,
                                    verification_complete: true
                                },
                                overrides: {
                                    agent: {
                                        firstMessage: "Hello {{customer_name}}! Thank you for calling Infobip Capital. I can see you're calling from your registered number, and your current account balance is {{current_balance}}. How can I help you today?"
                                    }
                                }
                            };
                            console.log(`📤 [${connectionId}] Sending PERSONALIZED conversation data for ${finalUserContext.name}`);
                        } else {
                            finalConversationData = {
                                type: "conversation_initiation_client_data",
                                dynamicVariables: {
                                    customer_name: 'New Caller',
                                    verification_complete: false
                                },
                                overrides: {
                                    agent: {
                                        firstMessage: "Hello! Thank you for calling Infobip Capital. I'm your AI banking assistant. May I have your name so I can look up your account?"
                                    }
                                }
                            };
                            console.log(`📤 [${connectionId}] Sending GENERIC conversation data - no user context found`);
                        }

                        if (finalConversationData) {
                            console.log(`🔍 [${connectionId}] Final data being sent:`, safeStringify(finalConversationData, 2));
                            elevenLabsWs.send(safeStringify(finalConversationData));
                        }
                    }, 1000); // Wait 1 second for call session to be established
                });

                elevenLabsWs.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.handleElevenLabsMessage(connectionId, message, infobipWs, elevenLabsWs);
                    } catch (error) {
                        console.error(`❌ [${connectionId}] Error parsing ElevenLabs message:`, error);
                    }
                });

                elevenLabsWs.on('error', (error) => {
                    clearTimeout(connectionTimeout); // Clear timeout on error
                    console.error(`❌ [${connectionId}] ElevenLabs WebSocket ERROR occurred:`, error);
                    console.error(`❌ [${connectionId}] Error name:`, error.name);
                    console.error(`❌ [${connectionId}] Error message:`, error.message);
                    console.error(`❌ [${connectionId}] Error code:`, error.code);
                    console.error(`❌ [${connectionId}] WebSocket readyState during error: ${elevenLabsWs.readyState}`);

                    // If this is a connection error, it might explain why we never see 'open'
                    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                        console.error(`🚨 [${connectionId}] NETWORK CONNECTION ERROR: Cannot reach ElevenLabs servers`);
                    }
                });

                elevenLabsWs.on('close', (code, reason) => {
                    clearTimeout(connectionTimeout); // Clear timeout on close
                    console.log(`🤖 [${connectionId}] ElevenLabs WebSocket CLOSED - Code: ${code}, Reason: ${reason}`);
                    console.log(`📊 [${connectionId}] Close code meanings: 1000=Normal, 1001=GoingAway, 1002=ProtocolError, 1003=UnsupportedData, 1006=AbnormalClosure, 1011=ServerError`);

                    if (code !== 1000) {
                        console.error(`⚠️  [${connectionId}] ❌ ABNORMAL ElevenLabs disconnection with code ${code}`);

                        // Specific error code analysis
                        if (code === 1006) {
                            console.error(`🚨 [${connectionId}] Code 1006: Connection closed abnormally - likely network issue or server rejection`);
                        } else if (code === 1002) {
                            console.error(`🚨 [${connectionId}] Code 1002: Protocol error - possibly authentication or format issue`);
                        } else if (code === 1011) {
                            console.error(`🚨 [${connectionId}] Code 1011: Server error - ElevenLabs server issue`);
                        }
                    } else {
                        console.log(`✅ [${connectionId}] Normal WebSocket closure`);
                    }
                });

            } catch (error) {
                console.error(`❌ [${connectionId}] ElevenLabs setup error:`, error);
            }
        };

        // Set up ElevenLabs connection
        await setupElevenLabs();

        // Handle messages from Infobip
        infobipWs.on('message', (message) => {
            try {
                if (typeof message === 'string') {
                    // JSON event from Infobip - ignore for now (following tutorial approach)
                    return;
                }

                // Binary audio data from Infobip - forward to ElevenLabs
                console.log(`🎤 [${connectionId}] Received ${message.length} bytes of audio from Infobip`);
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                    const audioMessage = {
                        user_audio_chunk: Buffer.from(message).toString('base64'),
                    };
                    elevenLabsWs.send(safeStringify(audioMessage));
                    console.log(`📤 [${connectionId}] Forwarded audio to ElevenLabs`);
                } else {
                    console.log(`⚠️  [${connectionId}] ElevenLabs WebSocket not ready, audio dropped`);
                }
            } catch (error) {
                console.error(`❌ [${connectionId}] Error processing Infobip message:`, error);
            }
        });

        // Handle WebSocket closure
        infobipWs.on('close', () => {
            console.log(`📞 [${connectionId}] Infobip client disconnected`);
            
            if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
            }
            
            // Clean up connection tracking
            this.activeConnections.delete(connectionId);
        });
    }

    handleElevenLabsMessage(connectionId, message, infobipWs, elevenLabsWs) {
        switch (message.type) {
            case 'conversation_initiation_metadata':
                console.log(`🤖 [${connectionId}] Conversation initialized`);
                break;

            case 'audio':
                // Forward audio from ElevenLabs to Infobip
                console.log(`🎵 [${connectionId}] Received audio from ElevenLabs, forwarding to Infobip`);
                const audioBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');
                if (infobipWs.readyState === WebSocket.OPEN) {
                    infobipWs.send(audioBuffer);
                    console.log(`📤 [${connectionId}] Sent ${audioBuffer.length} bytes of audio to Infobip`);
                } else {
                    console.log(`⚠️  [${connectionId}] Infobip WebSocket not ready, audio dropped`);
                }
                break;

            case 'agent_response_correction':
            case 'interruption':
                // Handle interruptions by clearing the audio queue
                if (infobipWs.readyState === WebSocket.OPEN) {
                    infobipWs.send(safeStringify({ action: 'clear' }));
                }
                break;

            case 'ping':
                // Respond to ping events
                if (message.ping_event?.event_id) {
                    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(safeStringify({
                            type: 'pong',
                            event_id: message.ping_event.event_id,
                        }));
                    }
                }
                break;

            case 'agent_response':
                const agentResponse = message.agent_response_event?.agent_response;
                if (agentResponse) {
                    console.log(`🤖 [${connectionId}] AI Response: ${agentResponse}`);
                    this.handleAgentResponse(connectionId, agentResponse);
                }
                break;

            case 'user_transcript':
                const userTranscript = message.user_transcription_event?.user_transcript;
                if (userTranscript) {
                    console.log(`👤 [${connectionId}] User said: ${userTranscript}`);
                    this.handleUserTranscript(connectionId, userTranscript);
                }
                break;

            default:
                console.log(`🤖 [${connectionId}] Unhandled ElevenLabs message type: ${message.type}`);
        }
    }

    /**
     * Build personalized configuration for ElevenLabs based on user context
     * @param {string} connectionId - Connection identifier
     * @param {object} userContext - User's fintech data (can be null)
     * @returns {object} - ElevenLabs conversation configuration
     */
    buildPersonalizedConfig(connectionId, userContext) {
        if (!userContext) {
            // Default configuration for unidentified callers
            return {
                agent: {
                    prompt: {
                        prompt: `You are a professional voice assistant for Infobip Capital, an AI-powered banking service. 
                        
                        The caller hasn't been identified yet. Politely ask for their name and phone number to look up their account. 
                        If they're new, offer to help them register for our demo.
                        
                        Always be helpful, professional, and secure in all interactions.`,
                        llm: "gpt-4o-mini"
                    },
                    first_message: "Hello! Welcome to Infobip Capital. I'm your AI banking assistant. May I have your name and the phone number on your account so I can assist you better?",
                    language: "en"
                }
            };
        }

        if (userContext.scenario === 'voice_registration') {
            // Configuration for unregistered users doing voice registration
            return {
                agent: {
                    prompt: {
                        prompt: `You are a helpful voice assistant for Infobip Capital. 
                        
                        The caller hasn't registered for our demo yet. Help them register by collecting:
                        - Their name
                        - Their company name  
                        - Their desired demo account balance
                        
                        Be friendly and guide them through the process step by step.
                        Once you have all the information, confirm the details and thank them.`,
                        llm: "gpt-4o-mini"
                    },
                    first_message: "Hello! It looks like you haven't registered for our demo yet. I'd be happy to help you register over the phone. Could you start by telling me your name?",
                    language: "en"
                }
            };
        }

        // 🎯 PERSONALIZED configuration for registered users
        const balance = parseFloat(userContext.fakeAccountBalance || 0).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD'
        });

        const personalizedPrompt = `You are a professional voice assistant for Infobip Capital.
        
        CALLER INFORMATION:
        - Name: ${userContext.name}
        - Company: ${userContext.companyName}
        - Account Number: ${userContext.fakeAccountNumber}
        - Current Balance: ${balance}
        ${userContext.loanApplicationStatus && userContext.loanApplicationStatus !== 'None' ? 
            `- Loan Application Status: ${userContext.loanApplicationStatus}` : ''}
        ${userContext.fraudScenario ? 
            '- FRAUD ALERT ENABLED: If they mention fraud or suspicious activity, immediately offer to transfer to our fraud prevention team.' : ''}
        
        You can help them with:
        - Account balance inquiries (you know their balance is ${balance})
        - Loan application status${userContext.loanApplicationStatus !== 'None' ? ' (status: ' + userContext.loanApplicationStatus + ')' : ''}
        - Account activation and general banking questions
        - Fraud reporting (transfer to live agents immediately)
        
        Always greet them by name, be professional, secure, and helpful. Use the specific account information provided above.`;

        return {
            agent: {
                prompt: {
                    prompt: personalizedPrompt,
                    llm: "gpt-4o-mini"
                },
                first_message: `Hello ${userContext.name}! Welcome back to Infobip Capital. I can see your account is active with a current balance of ${balance}. How can I help you today?`,
                language: "en"
            }
        };
    }

    /**
     * Build conversation configuration based on user context (keeping for compatibility)
     * @param {object} userContext - User's fintech data
     * @returns {object} - Conversation configuration
     */
    buildConversationConfig(userContext) {
        const config = this.getDefaultConfig();
        
        if (userContext.scenario === 'voice_registration') {
            // Special configuration for unregistered users
            config.agent_prompt = `You are a helpful voice assistant for Infobip Capital. 
            The caller hasn't registered for our demo yet. Help them register by collecting:
            - Their name
            - Their company name  
            - Their desired demo account balance
            Be friendly and guide them through the process step by step.
            Once you have all the information, confirm the details and thank them.`;
        } else {
            // Personalized configuration for registered users
            const balance = parseFloat(userContext.fakeAccountBalance).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });

            config.agent_prompt = `You are a professional voice assistant for Infobip Capital.
            
            The caller is ${userContext.name} from ${userContext.companyName}.
            Their account number is ${userContext.fakeAccountNumber}.
            Their current balance is ${balance}.
            ${userContext.loanApplicationStatus && userContext.loanApplicationStatus !== 'None' ? 
                `They have a loan application with status: ${userContext.loanApplicationStatus}.` : ''}
            ${userContext.fraudScenario ? 
                'If they mention fraud or suspicious activity, immediately offer to transfer them to our fraud prevention team.' : ''}
            
            You can help them with:
            - Account balance inquiries
            - Loan application status
            - Account activation
            - Fraud reporting (with immediate transfer to live agents)
            - General banking questions
            
            Always be professional, secure, and helpful. Greet them by name.`;
        }

        return config;
    }

    /**
     * Get default conversation configuration
     * @returns {object} - Default configuration
     */
    getDefaultConfig() {
        return {
            agent_prompt: `You are a professional voice assistant for Infobip Capital, an AI-powered banking service. 
            Be helpful, professional, and secure in all interactions. 
            If users ask about sensitive operations like fraud, offer to transfer them to a live agent.`,
            language: 'en',
            agent_name: 'Infobip Capital Assistant'
        };
    }

    /**
     * Update ElevenLabs context with user information
     * @param {WebSocket} elevenLabsWs - ElevenLabs WebSocket connection
     * @param {object} userContext - User context data
     */
    updateElevenLabsContext(elevenLabsWs, userContext) {
        const contextUpdate = {
            type: 'context_update',
            context: this.buildConversationConfig(userContext)
        };

        elevenLabsWs.send(safeStringify(contextUpdate));
    }

    /**
     * Handle agent responses for special actions
     * @param {string} connectionId - Connection identifier
     * @param {string} response - Agent response text
     */
    handleAgentResponse(connectionId, response) {
        const lowerResponse = response.toLowerCase();
        
        // Detect if agent is suggesting a transfer
        if (lowerResponse.includes('transfer') && 
            (lowerResponse.includes('fraud') || lowerResponse.includes('agent') || lowerResponse.includes('specialist'))) {
            console.log(`🔄 [${connectionId}] Agent suggesting transfer, this could trigger live agent handoff`);
            // In a full implementation, this could trigger the calls handler to transfer the call
        }
        
        // Log important banking actions
        if (lowerResponse.includes('balance') || lowerResponse.includes('account')) {
            console.log(`💳 [${connectionId}] Banking transaction discussed`);
        }
    }

    /**
     * Handle user transcripts for intent detection
     * @param {string} connectionId - Connection identifier  
     * @param {string} transcript - User's spoken text
     */
    handleUserTranscript(connectionId, transcript) {
        const lowerTranscript = transcript.toLowerCase();
        
        // Log user intents for analytics
        if (lowerTranscript.includes('fraud') || lowerTranscript.includes('suspicious')) {
            console.log(`🚨 [${connectionId}] FRAUD ALERT - User mentioned: ${transcript}`);
        } else if (lowerTranscript.includes('balance') || lowerTranscript.includes('money')) {
            console.log(`💰 [${connectionId}] Balance inquiry: ${transcript}`);
        } else if (lowerTranscript.includes('loan') || lowerTranscript.includes('application')) {
            console.log(`📋 [${connectionId}] Loan inquiry: ${transcript}`);
        }
    }

    /**
     * Start the WebSocket proxy server
     */
    start() {
        this.server.listen(this.port, () => {
            console.log(`🔌 WebSocket Proxy Server running on port ${this.port}`);
            console.log(`📡 Ready to bridge Infobip ↔ ElevenLabs audio streams`);
        });
    }

    /**
     * Get active connections info
     * @returns {Array} - Array of active connection info
     */
    getActiveConnections() {
        return Array.from(this.activeConnections.entries()).map(([id, conn]) => ({
            connectionId: id,
            duration: Date.now() - conn.startTime,
            hasUserContext: !!conn.userContext,
            userName: conn.userContext?.name || 'Unknown'
        }));
    }

    /**
     * Stop the proxy server
     */
    stop() {
        console.log('🛑 Stopping WebSocket Proxy Server...');
        
        // Close all active connections
        for (const [id, connection] of this.activeConnections.entries()) {
            if (connection.elevenLabsWs) {
                connection.elevenLabsWs.close();
            }
            if (connection.infobipWs) {
                connection.infobipWs.close();
            }
        }
        
        this.activeConnections.clear();
        this.wss.close();
        this.server.close();
    }

    /**
     * Attach WebSocket server to existing HTTP server (for Railway single-port constraint)
     * @param {http.Server} httpServer - Existing HTTP server
     */
    attachToServer(httpServer) {
        this.wss = new WebSocket.Server({
            server: httpServer,
            path: '/websocket-voice'
        });

        this.setupWebSocketServer();

        console.log(`🔌 WebSocket Proxy attached to main server at /websocket-voice`);
        console.log(`📡 Ready to bridge Infobip ↔ ElevenLabs audio streams`);
    }
}

// Export singleton instance
let wsProxyInstance = null;

module.exports = WebSocketProxy;
module.exports.getInstance = () => wsProxyInstance;
module.exports.setInstance = (instance) => { wsProxyInstance = instance; };