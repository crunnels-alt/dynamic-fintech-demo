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
        
        // Active connections tracking
        this.activeConnections = new Map();
        
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

    async handleWebsocketConnection(infobipWs, connectionId) {
        let elevenLabsWs = null;
        let userContext = null;

        // Store connection info
        this.activeConnections.set(connectionId, {
            infobipWs,
            elevenLabsWs: null,
            startTime: Date.now(),
            userContext: null
        });

        // 🎯 NEW: Try to get user context from active calls
        // We'll look for the most recent active call to associate with this WebSocket
        const activeCalls = callsHandler.getActiveCalls();
        if (activeCalls.length > 0) {
            // Get the most recent call (likely the one that just connected)
            const recentCall = activeCalls[activeCalls.length - 1];
            const callSession = callsHandler.getCallSession(recentCall.callId);
            if (callSession?.userContext) {
                userContext = callSession.userContext;
                console.log(`🎯 [${connectionId}] Found user context for: ${userContext.name || 'Unknown User'}`);
                
                // Update connection with user context
                const connection = this.activeConnections.get(connectionId);
                if (connection) {
                    connection.userContext = userContext;
                }
            } else {
                console.log(`⚠️  [${connectionId}] No user context found in active calls`);
            }
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
                    console.log(`🔍 [${connectionId}] Full config being sent:`, JSON.stringify(conversationData, null, 2));
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

                elevenLabsWs = new WebSocket(signedUrl);

                // Update connection tracking
                const connection = this.activeConnections.get(connectionId);
                if (connection) {
                    connection.elevenLabsWs = elevenLabsWs;
                }

                elevenLabsWs.on('open', () => {
                    console.log(`🤖 [${connectionId}] Connected to ElevenLabs Conversational AI`);

                    if (conversationData) {
                        console.log(`📤 [${connectionId}] Sending conversation initiation data`);
                        console.log(`🔍 [${connectionId}] Data being sent:`, JSON.stringify(conversationData, null, 2));
                        elevenLabsWs.send(JSON.stringify(conversationData));
                    } else {
                        console.log(`📱 [${connectionId}] No conversation data to send - agent should start with default greeting`);
                    }
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
                    console.error(`❌ [${connectionId}] ElevenLabs WebSocket error:`, error);
                    console.error(`❌ [${connectionId}] Error details:`, error.message);
                });

                elevenLabsWs.on('close', (code, reason) => {
                    console.log(`🤖 [${connectionId}] ElevenLabs disconnected - Code: ${code}, Reason: ${reason}`);
                    if (code !== 1000) {
                        console.error(`⚠️  [${connectionId}] Abnormal ElevenLabs disconnection`);
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
                    elevenLabsWs.send(JSON.stringify(audioMessage));
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
                    infobipWs.send(JSON.stringify({ action: 'clear' }));
                }
                break;

            case 'ping':
                // Respond to ping events
                if (message.ping_event?.event_id) {
                    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify({
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
        
        elevenLabsWs.send(JSON.stringify(contextUpdate));
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

module.exports = WebSocketProxy;