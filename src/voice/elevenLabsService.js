const fetch = require('node-fetch');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const { safeStringify } = require('../utils/jsonSanitizer');

// Fallback function for uuid generation
function generateUUID() {
    return randomUUID();
}

class ElevenLabsService {
    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY;
        this.voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Bella voice
        this.modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
        this.baseUrl = 'https://api.elevenlabs.io/v1';
        
        // Active conversation sessions
        this.activeSessions = new Map();
    }

    /**
     * Initialize a conversational session with ElevenLabs
     * @param {string} sessionId - Unique session identifier
     * @param {object} userContext - User context for personalization
     * @returns {Promise<WebSocket>} - WebSocket connection
     */
    async initializeConversation(sessionId, userContext) {
        if (!this.apiKey) {
            throw new Error('ElevenLabs API key not configured');
        }

        const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.voiceId}`;
        
        const ws = new WebSocket(wsUrl, {
            headers: {
                'xi-api-key': this.apiKey
            }
        });

        return new Promise((resolve, reject) => {
            ws.on('open', () => {
                console.log(`ElevenLabs conversation started for session ${sessionId}`);
                
                // Store session info
                this.activeSessions.set(sessionId, {
                    ws,
                    userContext,
                    startTime: Date.now(),
                    conversationHistory: []
                });

                // Send initial context
                this.sendUserContext(sessionId, userContext);
                
                resolve(ws);
            });

            ws.on('error', (error) => {
                console.error('ElevenLabs WebSocket error:', error);
                reject(error);
            });

            ws.on('close', () => {
                console.log(`ElevenLabs conversation ended for session ${sessionId}`);
                this.activeSessions.delete(sessionId);
            });

            ws.on('message', (data) => {
                this.handleElevenLabsMessage(sessionId, data);
            });
        });
    }

    /**
     * Send user context to personalize the conversation
     * @param {string} sessionId - Session identifier
     * @param {object} userContext - User's fintech data
     */
    sendUserContext(sessionId, userContext) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const contextMessage = {
            type: 'context',
            data: {
                user: {
                    name: userContext.name,
                    accountNumber: userContext.fakeAccountNumber,
                    balance: userContext.fakeAccountBalance,
                    company: userContext.companyName,
                    loanStatus: userContext.loanApplicationStatus,
                    fraudAlert: userContext.fraudScenario
                },
                personality: {
                    role: 'Professional banking assistant',
                    tone: 'Helpful, secure, and efficient',
                    instructions: `You are a voice assistant for Infobip Capital. 
                    The caller is ${userContext.name} from ${userContext.companyName}.
                    Their account balance is $${userContext.fakeAccountBalance}.
                    ${userContext.loanApplicationStatus !== 'None' ? 
                        `They have a loan application that is ${userContext.loanApplicationStatus}.` : ''}
                    ${userContext.fraudScenario ? 
                        'If they mention fraud, immediately offer to transfer to a live agent.' : ''}
                    Always be professional and secure. Verify identity through voice recognition.`
                }
            }
        };

        session.ws.send(safeStringify(contextMessage));
    }

    /**
     * Handle messages from ElevenLabs
     * @param {string} sessionId - Session identifier
     * @param {Buffer} data - Message data
     */
    handleElevenLabsMessage(sessionId, data) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'conversation_initiation_metadata':
                    console.log('Conversation initialized:', message);
                    break;
                    
                case 'user_transcript':
                    console.log(`User said: ${message.user_transcript}`);
                    session.conversationHistory.push({
                        type: 'user',
                        text: message.user_transcript,
                        timestamp: Date.now()
                    });
                    this.processUserIntent(sessionId, message.user_transcript);
                    break;
                    
                case 'agent_response':
                    console.log(`Assistant responded: ${message.agent_response}`);
                    session.conversationHistory.push({
                        type: 'assistant',
                        text: message.agent_response,
                        timestamp: Date.now()
                    });
                    break;
                    
                case 'audio':
                    // Forward audio to Infobip
                    this.forwardAudioToInfobip(sessionId, message.audio_data);
                    break;
                    
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing ElevenLabs message:', error);
        }
    }

    /**
     * Process user intent and trigger appropriate banking actions
     * @param {string} sessionId - Session identifier
     * @param {string} transcript - User's spoken text
     */
    processUserIntent(sessionId, transcript) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const lowerTranscript = transcript.toLowerCase();
        const { userContext } = session;

        // Detect banking intents
        if (lowerTranscript.includes('balance') || lowerTranscript.includes('money')) {
            this.handleBalanceInquiry(sessionId);
        } else if (lowerTranscript.includes('loan') || lowerTranscript.includes('application')) {
            this.handleLoanInquiry(sessionId);
        } else if (lowerTranscript.includes('fraud') || lowerTranscript.includes('suspicious') || 
                  lowerTranscript.includes('unauthorized')) {
            this.handleFraudAlert(sessionId);
        } else if (lowerTranscript.includes('activate') || lowerTranscript.includes('activation')) {
            this.handleAccountActivation(sessionId);
        } else if (lowerTranscript.includes('register') || lowerTranscript.includes('sign up')) {
            this.handleVoiceRegistration(sessionId);
        }
    }

    /**
     * Handle balance inquiry
     * @param {string} sessionId - Session identifier
     */
    handleBalanceInquiry(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const balance = parseFloat(session.userContext.fakeAccountBalance).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD'
        });

        const response = {
            type: 'function_response',
            data: {
                function: 'get_account_balance',
                result: {
                    balance,
                    accountNumber: session.userContext.fakeAccountNumber,
                    message: `Your current account balance is ${balance}. Is there anything else I can help you with today?`
                }
            }
        };

        session.ws.send(safeStringify(response));
    }

    /**
     * Handle loan inquiry
     * @param {string} sessionId - Session identifier
     */
    handleLoanInquiry(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const loanStatus = session.userContext.loanApplicationStatus;
        
        if (loanStatus === 'None') {
            const response = {
                type: 'function_response',
                data: {
                    function: 'check_loan_status',
                    result: {
                        status: 'No application found',
                        message: 'I don\'t see any loan applications on file for your account. Would you like information about applying for a loan?'
                    }
                }
            };
            session.ws.send(safeStringify(response));
        } else {
            const response = {
                type: 'function_response',
                data: {
                    function: 'check_loan_status',
                    result: {
                        status: loanStatus,
                        message: `Your loan application status is: ${loanStatus}. Our loan officer Michael Chen will contact you with next steps. Would you like me to connect you to him now?`
                    }
                }
            };
            session.ws.send(safeStringify(response));
        }
    }

    /**
     * Handle fraud alert
     * @param {string} sessionId - Session identifier
     */
    handleFraudAlert(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const response = {
            type: 'function_response',
            data: {
                function: 'handle_fraud_alert',
                result: {
                    action: 'transfer_to_agent',
                    message: 'I understand your concern about suspicious activity. For security reasons, I\'m going to connect you immediately to our fraud prevention team. Please hold while I transfer your call.'
                }
            }
        };

        session.ws.send(safeStringify(response));
        
        // Trigger call transfer
        setTimeout(() => {
            this.transferToLiveAgent(sessionId, 'fraud');
        }, 2000);
    }

    /**
     * Handle account activation
     * @param {string} sessionId - Session identifier
     */
    handleAccountActivation(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        const response = {
            type: 'function_response',
            data: {
                function: 'activate_account',
                result: {
                    status: 'activated',
                    accountNumber: session.userContext.fakeAccountNumber,
                    message: `Perfect! Your account ${session.userContext.fakeAccountNumber} is now fully activated and ready to use. You can access all our banking services. Is there anything else I can help you with?`
                }
            }
        };

        session.ws.send(safeStringify(response));
    }

    /**
     * Transfer call to live agent
     * @param {string} sessionId - Session identifier
     * @param {string} reason - Reason for transfer
     */
    transferToLiveAgent(sessionId, reason) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        // In a real implementation, this would use Infobip's call transfer API
        console.log(`Transferring call ${sessionId} to live agent. Reason: ${reason}`);
        
        const transferInfo = {
            sessionId,
            reason,
            userContext: session.userContext,
            conversationHistory: session.conversationHistory,
            timestamp: new Date().toISOString()
        };

        // Store transfer info for agent
        // This would typically be sent to an agent dashboard
        console.log('Transfer info for agent:', safeStringify(transferInfo, 2));

        // Close the ElevenLabs session
        session.ws.close();
    }

    /**
     * Forward audio data to Infobip
     * @param {string} sessionId - Session identifier
     * @param {string} audioData - Base64 encoded audio
     */
    forwardAudioToInfobip(sessionId, audioData) {
        // This would forward audio back to Infobip Voice API
        // Implementation depends on the specific Infobip integration
        console.log(`Forwarding audio for session ${sessionId}`);
    }

    /**
     * End a conversation session
     * @param {string} sessionId - Session identifier
     */
    endConversation(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.ws.close();
            this.activeSessions.delete(sessionId);
            console.log(`Conversation ended for session ${sessionId}`);
        }
    }

    /**
     * Get session information
     * @param {string} sessionId - Session identifier
     * @returns {object|null} - Session info
     */
    getSession(sessionId) {
        return this.activeSessions.get(sessionId) || null;
    }

    /**
     * Get all active sessions
     * @returns {Array} - Array of session info
     */
    getActiveSessions() {
        return Array.from(this.activeSessions.entries()).map(([id, session]) => ({
            sessionId: id,
            userContext: session.userContext,
            startTime: session.startTime,
            duration: Date.now() - session.startTime
        }));
    }
}

// Create singleton instance
const elevenLabsService = new ElevenLabsService();

module.exports = elevenLabsService;