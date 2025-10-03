const axios = require('axios');
const DatabaseFactory = require('../database/DatabaseFactory');
const PhoneNumberUtils = require('../utils/phoneUtils');
const { safeStringify } = require('../utils/jsonSanitizer');

// Initialize database manager based on environment
const databaseManager = DatabaseFactory.create();

class CallsHandler {
    constructor() {
        this.infobipApiKey = process.env.INFOBIP_API_KEY;
        this.mediaStreamConfigId = process.env.MEDIA_STREAM_CONFIG_ID;
        this.infobipBaseUrl = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';
        
        // Initialize Infobip client
        this.ibClient = axios.create({
            headers: {
                'Authorization': `App ${this.infobipApiKey}`
            }
        });

        // Active call sessions for tracking
        this.activeCalls = new Map();
    }

    /**
     * Handle incoming call received event from Infobip
     * @param {object} event - Call received event from Infobip webhook
     */
    async handleCallReceived(event) {
        try {
            const callId = event.callId;
            const callerId = event.properties?.call?.from; // Phone number of the caller

            console.log(`📞 Received call ${callId} from ${callerId}`);
            console.log(`🔍 WEBHOOK - callerId type: ${typeof callerId}, value: "${callerId}"`);
            
            // Identify the caller by their phone number
            const userContext = await this.identifyCallerAndGetContext(callerId);
            
            if (!userContext) {
                console.log(`❌ Caller ${callerId} not registered. Handling unregistered user flow.`);
                await this.handleUnregisteredUser(callId, callerId);
                return;
            }

            console.log(`✅ Caller identified: ${userContext.name} from ${userContext.companyName}`);

            // Store call session info
            this.activeCalls.set(callId, {
                callerId,
                userContext,
                startTime: Date.now(),
                status: 'connected'
            });

            // Create dialog connecting the call to our WebSocket endpoint
            try {
                await this.createDialogWithAI(callId, userContext);
                console.log(`✅ Created dialog for call ${callId}`);
            } catch (dialogError) {
                console.error(`❌ Failed to create dialog for call ${callId}:`, dialogError);
                throw dialogError; // Re-throw as this is critical
            }
            
            // Update call statistics in database with error handling
            try {
                await databaseManager.updateUserCallStats(userContext.phoneNumber);
                console.log(`✅ Updated call stats for ${userContext.phoneNumber}`);
            } catch (error) {
                console.log(`⚠️ Failed to update call stats:`, error.message);
            }

            try {
                await databaseManager.logCall(userContext.phoneNumber, 'ai_conversation', null, true);
                console.log(`✅ Logged call for ${userContext.phoneNumber}`);
            } catch (error) {
                console.log(`⚠️ Failed to log call:`, error.message);
            }

        } catch (error) {
            console.error('❌ Error handling call received:', error);
            // In a production environment, you might want to handle this more gracefully
            // perhaps by playing an error message to the caller
        }
    }

    /**
     * Identify caller by phone number and retrieve their fintech context
     * @param {string} callerId - Phone number of the caller
     * @returns {object|null} - User context or null if not found
     */
    async identifyCallerAndGetContext(callerId) {
        try {
            console.log(`🔍 RAW caller ID from Infobip: "${callerId}"`);

            // Standardize the phone number format
            const standardizedPhone = PhoneNumberUtils.standardizeNorthAmerican(callerId);
            console.log(`🔍 STANDARDIZED phone: "${standardizedPhone}"`);

            if (!standardizedPhone) {
                console.log(`⚠️  Could not standardize phone number: ${callerId}`);
                return null;
            }

            // Look up user in database
            console.log(`🔍 SEARCHING database for phone: "${standardizedPhone}"`);
            const user = await databaseManager.getUserByPhone(standardizedPhone);
            console.log(`🔍 DATABASE RESULT:`, user ? `FOUND user: ${user.name} (${user.phoneNumber})` : 'NOT FOUND');

            if (!user) {
                console.log(`📋 No user found for phone: ${standardizedPhone}`);

                // Debug: Let's also check what phone numbers ARE in the database
                console.log(`🔍 DEBUG: Checking first 5 phone numbers in database...`);
                try {
                    const allUsers = await databaseManager.getAllUsers ? await databaseManager.getAllUsers() : [];
                    const phoneNumbers = allUsers.slice(0, 5).map(u => u.phoneNumber);
                    console.log(`🔍 DEBUG: Sample phone numbers in DB:`, phoneNumbers);
                } catch (debugError) {
                    console.log(`🔍 DEBUG: Could not fetch sample users:`, debugError.message);
                }

                return null;
            }

            // Get additional user data for context - simplified to avoid timeout issues
            let loanApplications = [];
            let recentTransactions = [];
            let dataFetchErrors = [];

            try {
                loanApplications = await databaseManager.getUserLoanApplications(user.id) || [];
                console.log(`✅ Fetched ${loanApplications.length} loan application(s) for user ${user.id}`);
            } catch (error) {
                console.error(`❌ Failed to get loan applications for user ${user.id}:`, error.message);
                dataFetchErrors.push({ type: 'loan_applications', error: error.message });
            }

            try {
                recentTransactions = await databaseManager.getUserTransactions(user.id, 3) || [];
                console.log(`✅ Fetched ${recentTransactions.length} recent transaction(s) for user ${user.id}`);
            } catch (error) {
                console.error(`❌ Failed to get transactions for user ${user.id}:`, error.message);
                dataFetchErrors.push({ type: 'transactions', error: error.message });
            }

            if (dataFetchErrors.length > 0) {
                console.warn(`⚠️  ${dataFetchErrors.length} data fetch error(s) occurred. Context will be incomplete.`);
            }

            const userContext = {
                ...user,
                loanApplications,
                recentTransactions,
                // Ensure phoneNumber field is properly set
                phoneNumber: user.phoneNumber || user.phone_number || standardizedPhone,
                // Add some contextual information for the AI
                lastCallDate: user.lastCallAt ? new Date(user.lastCallAt).toLocaleDateString() : 'First call',
                callCount: user.callCount + 1,
                // Add error tracking
                _dataFetchErrors: dataFetchErrors.length > 0 ? dataFetchErrors : undefined
            };

            // Validate critical fields before returning
            const requiredFields = ['name', 'phoneNumber', 'fakeAccountNumber', 'fakeAccountBalance'];
            const missingRequiredFields = requiredFields.filter(field => !userContext[field]);

            if (missingRequiredFields.length > 0) {
                console.error(`❌ CRITICAL: Missing required fields in user context:`, missingRequiredFields);
                console.error(`❌ This may cause dynamic variables to fail. User data:`, {
                    id: user.id,
                    phoneNumber: userContext.phoneNumber,
                    name: userContext.name
                });
            }

            return userContext;

        } catch (error) {
            console.error('❌ Error identifying caller:', error);
            return null;
        }
    }

    /**
     * Create a dialog connecting the call to our AI-powered WebSocket endpoint
     * @param {string} callId - The ID of the incoming call
     * @param {object} userContext - User's fintech context
     */
    async createDialogWithAI(callId, userContext) {
        try {
            console.log(`🔗 Creating dialog for call ${callId}...`);
            console.log(`📊 Customer context summary:`, {
                name: userContext.name,
                company: userContext.companyName,
                loanStatus: userContext.loanApplicationStatus,
                loanAppsCount: userContext.loanApplications?.length || 0,
                transactionsCount: userContext.recentTransactions?.length || 0,
                callCount: userContext.callCount,
                fraudScenario: userContext.fraudScenario
            });

            // Store context in active calls map so WebSocket can retrieve it
            const callSession = this.activeCalls.get(callId);
            if (callSession) {
                callSession.userContext = userContext;
                console.log(`💾 Stored user context for call ${callId}`);
            }

            const response = await this.ibClient.post(`${this.infobipBaseUrl}/calls/1/dialogs`, {
                parentCallId: callId,
                maxDuration: 3600, // Allow up to 1 hour (3600 seconds)
                childCallRequest: {
                    endpoint: {
                        type: 'WEBSOCKET',
                        websocketEndpointConfigId: this.mediaStreamConfigId,
                        // Store call ID in customData so we can look up context later
                        customData: {
                            parentCallId: callId
                        }
                    }
                }
            });

            const dialogData = response.data;
            console.log(`✅ Created dialog with ID ${dialogData.id}`);

            // Update call session with dialog info
            const callSession = this.activeCalls.get(callId);
            if (callSession) {
                callSession.dialogId = dialogData.id;
                callSession.status = 'dialog_created';
            }

            return dialogData;

        } catch (error) {
            console.error('❌ Error creating dialog:', error);
            throw error;
        }
    }

    /**
     * Handle calls from unregistered users (voice registration flow)
     * @param {string} callId - The ID of the incoming call
     * @param {string} callerId - Phone number of the caller
     */
    async handleUnregisteredUser(callId, callerId) {
        try {
            console.log(`🎙️  Handling unregistered user: ${callerId}`);

            // Create a special context for unregistered users
            const unregisteredContext = {
                phoneNumber: callerId,
                name: 'New Caller',
                scenario: 'voice_registration',
                isRegistered: false,
                greeting: 'Hello! It looks like you haven\'t registered for our demo yet. Would you like to do that now over the phone?'
            };

            // Store call session info for unregistered user
            this.activeCalls.set(callId, {
                callerId,
                userContext: unregisteredContext,
                startTime: Date.now(),
                status: 'unregistered_flow'
            });

            // Create dialog with special context for registration flow
            const response = await this.ibClient.post(`${this.infobipBaseUrl}/calls/1/dialogs`, {
                parentCallId: callId,
                maxDuration: 3600, // Allow up to 1 hour (3600 seconds)
                childCallRequest: {
                    endpoint: {
                        type: 'WEBSOCKET',
                        websocketEndpointConfigId: this.mediaStreamConfigId
                    }
                }
            });

            console.log(`✅ Created registration dialog for unregistered caller ${callerId}`);

        } catch (error) {
            console.error('❌ Error handling unregistered user:', error);
        }
    }

    /**
     * Handle call hangup events
     * @param {object} event - Call hangup event from Infobip
     */
    async handleCallHangup(event) {
        try {
            const callId = event.callId;
            const callSession = this.activeCalls.get(callId);
            
            if (callSession) {
                const duration = Date.now() - callSession.startTime;
                const durationSeconds = Math.floor(duration / 1000);
                
                console.log(`📴 Call ${callId} ended. Duration: ${durationSeconds}s`);
                
                // Log the call completion
                if (callSession.userContext.phoneNumber) {
                    await databaseManager.logCall(
                        callSession.userContext.phoneNumber,
                        callSession.userContext.scenario || 'general',
                        durationSeconds,
                        true // successful
                    );
                }

                // Clean up active call session
                this.activeCalls.delete(callId);
            }

        } catch (error) {
            console.error('❌ Error handling call hangup:', error);
        }
    }

    /**
     * Transfer a call to a live agent
     * @param {string} callId - The ID of the call to transfer
     * @param {string} reason - Reason for transfer (e.g., 'fraud', 'loan_inquiry')
     */
    async transferToLiveAgent(callId, reason = 'general') {
        try {
            const callSession = this.activeCalls.get(callId);
            if (!callSession) {
                console.error(`❌ No active call session found for ${callId}`);
                return;
            }

            console.log(`🔄 Transferring call ${callId} to live agent. Reason: ${reason}`);

            const liveAgentNumber = process.env.LIVE_AGENT_NUMBER;
            if (!liveAgentNumber) {
                console.error('❌ Live agent number not configured');
                return;
            }

            // Create a new call to the live agent
            const transferResponse = await this.ibClient.post(`${this.infobipBaseUrl}/calls/1/calls`, {
                endpoint: {
                    type: 'PHONE',
                    phoneNumber: liveAgentNumber
                },
                from: process.env.DEMO_CALL_NUMBER,
                metadata: {
                    transferReason: reason,
                    originalCallId: callId,
                    userContext: safeStringify(callSession.userContext),
                    timestamp: new Date().toISOString()
                }
            });

            const agentCallId = transferResponse.data.callId;
            console.log(`📞 Created agent call ${agentCallId}`);

            // Connect the customer call with the agent call
            const bridgeResponse = await this.ibClient.post(`${this.infobipBaseUrl}/calls/1/calls/${callId}/connect`, {
                callId: agentCallId
            });

            console.log(`🌉 Bridged customer call ${callId} with agent call ${agentCallId}`);

            // Update call session
            callSession.status = 'transferred_to_agent';
            callSession.transferReason = reason;
            callSession.agentCallId = agentCallId;

            return bridgeResponse.data;

        } catch (error) {
            console.error('❌ Error transferring to live agent:', error);
            throw error;
        }
    }

    /**
     * Get information about an active call
     * @param {string} callId - The ID of the call
     * @returns {object|null} - Call session info or null
     */
    getCallSession(callId) {
        return this.activeCalls.get(callId) || null;
    }

    /**
     * Get all active calls
     * @returns {Array} - Array of active call sessions
     */
    getActiveCalls() {
        return Array.from(this.activeCalls.entries()).map(([callId, session]) => ({
            callId,
            callerId: session.callerId,
            userName: session.userContext.name,
            duration: Date.now() - session.startTime,
            status: session.status
        }));
    }
}

// Create singleton instance
const callsHandler = new CallsHandler();

module.exports = callsHandler;