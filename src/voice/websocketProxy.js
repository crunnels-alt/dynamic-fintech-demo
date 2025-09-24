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

        infobipWs.on('error', (error) => {
            console.error(`❌ Infobip WebSocket error for ${connectionId}:`, error);
        });

        // Get signed URL for ElevenLabs connection
        const getSignedUrl = async () => {
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
                    throw new Error(`Failed to get signed URL: ${response.statusText}`);
                }

                const data = await response.json();
                return data.signed_url;
            } catch (error) {
                console.error('❌ Error getting ElevenLabs signed URL:', error);
                throw error;
            }
        };

        const setupElevenLabs = async () => {
            try {
                const signedUrl = await getSignedUrl();
                elevenLabsWs = new WebSocket(signedUrl);

                // Update connection tracking
                const connection = this.activeConnections.get(connectionId);
                if (connection) {
                    connection.elevenLabsWs = elevenLabsWs;
                }

                elevenLabsWs.on('open', () => {
                    console.log(`🤖 [${connectionId}] Connected to ElevenLabs Conversational AI`);

                    // Send initial configuration
                    const initialConfig = {
                        type: 'conversation_initiation_client_data',
                        // You can add custom instructions here based on user context
                        conversation_config: userContext ? this.buildConversationConfig(userContext) : this.getDefaultConfig()
                    };

                    elevenLabsWs.send(JSON.stringify(initialConfig));
                });

                elevenLabsWs.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.handleElevenLabsMessage(connectionId, message, infobipWs);
                    } catch (error) {
                        console.error(`❌ [${connectionId}] Error parsing ElevenLabs message:`, error);
                    }
                });

                elevenLabsWs.on('error', (error) => {
                    console.error(`❌ [${connectionId}] ElevenLabs WebSocket error:`, error);
                });

                elevenLabsWs.on('close', () => {
                    console.log(`🤖 [${connectionId}] ElevenLabs disconnected`);
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
                    // JSON event from Infobip - might contain metadata
                    try {
                        const jsonMessage = JSON.parse(message);
                        if (jsonMessage.metadata && jsonMessage.metadata.userContext) {
                            // Extract user context from metadata
                            userContext = JSON.parse(jsonMessage.metadata.userContext);
                            const connection = this.activeConnections.get(connectionId);
                            if (connection) {
                                connection.userContext = userContext;
                            }
                            console.log(`👤 [${connectionId}] Received user context for ${userContext.name}`);
                            
                            // Update ElevenLabs with personalized context
                            if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                                this.updateElevenLabsContext(elevenLabsWs, userContext);
                            }
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                    return;
                }

                // Binary audio data from Infobip
                if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                    const audioMessage = {
                        user_audio_chunk: Buffer.from(message).toString('base64'),
                    };
                    elevenLabsWs.send(JSON.stringify(audioMessage));
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

    handleElevenLabsMessage(connectionId, message, infobipWs) {
        switch (message.type) {
            case 'conversation_initiation_metadata':
                console.log(`🤖 [${connectionId}] Conversation initialized`);
                break;

            case 'audio':
                // Forward audio from ElevenLabs to Infobip
                const audioBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');
                if (infobipWs.readyState === WebSocket.OPEN) {
                    infobipWs.send(audioBuffer);
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
                    const connection = this.activeConnections.get(connectionId);
                    if (connection?.elevenLabsWs) {
                        connection.elevenLabsWs.send(JSON.stringify({
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
     * Build conversation configuration based on user context
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
}

module.exports = WebSocketProxy;