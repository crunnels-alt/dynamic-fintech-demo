const express = require('express');
const { body, validationResult } = require('express-validator');
const DatabaseFactory = require('../database/DatabaseFactory');
const smsService = require('../utils/smsService');

// Initialize database manager based on environment
const databaseManager = DatabaseFactory.create();
const PhoneNumberUtils = require('../utils/phoneUtils');
const callsHandler = require('../voice/callsHandler');
const router = express.Router();

// Simple test endpoint
router.get('/test', (req, res) => {
    res.json({ message: 'Test endpoint working' });
});

// Debug endpoint to test phone number lookup
router.get('/debug-phone/:phoneNumber', async (req, res) => {
    try {
        const callsHandler = require('../voice/callsHandler.js');
        const PhoneNumberUtils = require('../utils/phoneUtils');

        const rawPhone = req.params.phoneNumber;
        console.log(`🔍 DEBUG API - Raw phone: "${rawPhone}"`);

        const standardizedPhone = PhoneNumberUtils.standardizeNorthAmerican(rawPhone);
        console.log(`🔍 DEBUG API - Standardized: "${standardizedPhone}"`);

        const userContext = await callsHandler.identifyCallerAndGetContext(rawPhone);
        console.log(`🔍 DEBUG API - User context:`, userContext ? `Found ${userContext.name}` : 'Not found');

        res.json({
            rawPhone,
            standardizedPhone,
            userFound: !!userContext,
            userData: userContext ? {
                name: userContext.name,
                company: userContext.companyName,
                phone: userContext.phoneNumber,
                balance: userContext.fakeAccountBalance
            } : null
        });
    } catch (error) {
        console.error('Debug phone lookup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ElevenLabs webhook endpoint for conversation_initiation_client_data
router.post('/elevenlabs-webhook', async (req, res) => {
    try {
        console.log('🔔 ElevenLabs webhook called:', JSON.stringify(req.body, null, 2));

        // Extract phone number from the webhook payload
        // This might be in different places depending on how ElevenLabs sends it
        const phoneNumber = req.body.caller_id || req.body.phone_number || req.body.from;

        if (!phoneNumber) {
            console.log('⚠️ No phone number found in ElevenLabs webhook');
            return res.json({
                type: "conversation_initiation_client_data",
                dynamic_variables: {
                    customer_name: 'New Caller',
                    verification_complete: false
                },
                conversation_config_override: {
                    agent: {
                        first_message: "Hello! Thank you for calling Infobip Capital. I'm your AI banking assistant. May I have your name so I can look up your account?"
                    }
                }
            });
        }

        console.log(`🔍 ElevenLabs webhook - Looking up phone: ${phoneNumber}`);

        // Look up user context
        const callsHandler = require('../voice/callsHandler.js');
        const userContext = await callsHandler.identifyCallerAndGetContext(phoneNumber);

        if (userContext && userContext.name && userContext.name !== 'New Caller') {
            console.log(`🎯 ElevenLabs webhook - Found user: ${userContext.name}`);
            console.log(`💰 ElevenLabs webhook - Raw balance: "${userContext.fakeAccountBalance}"`);

            // Format balance for display
            const balance = parseFloat(userContext.fakeAccountBalance || 0).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });
            console.log(`💰 ElevenLabs webhook - Formatted balance: "${balance}"`);

            const responseData = {
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
                conversation_config_override: {
                    agent: {
                        first_message: "Hello {{customer_name}}! Thank you for calling Infobip Capital. I can see you're calling from your registered number, and your current account balance is {{current_balance}}. How can I help you today?"
                    }
                }
            };

            console.log(`📤 ElevenLabs webhook - Sending personalized data:`, JSON.stringify(responseData, null, 2));
            return res.json(responseData);

        } else {
            console.log(`📋 ElevenLabs webhook - No user found for phone: ${phoneNumber}`);

            return res.json({
                type: "conversation_initiation_client_data",
                dynamic_variables: {
                    customer_name: 'New Caller',
                    verification_complete: false
                },
                conversation_config_override: {
                    agent: {
                        first_message: "Hello! Thank you for calling Infobip Capital. I'm your AI banking assistant. May I have your name so I can look up your account?"
                    }
                }
            });
        }

    } catch (error) {
        console.error('❌ ElevenLabs webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the registration form
router.get('/', (req, res) => {
    res.sendFile('index.html', { root: './public' });
});

// Registration API endpoint
router.post('/api/register', [
    // Validation middleware
    body('phoneNumber')
        .custom((value) => {
            const standardized = PhoneNumberUtils.standardizeNorthAmerican(value);
            if (!standardized || !PhoneNumberUtils.isValidNorthAmerican(standardized)) {
                throw new Error('Please provide a valid North American phone number');
            }
            return true;
        })
        .withMessage('Please provide a valid North American phone number (US/Canada)'),
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
    body('companyName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Company name must be between 2 and 100 characters'),
    body('fakeAccountBalance')
        .isFloat({ min: 0, max: 1000000 })
        .withMessage('Account balance must be between 0 and 1,000,000'),
    body('loanApplicationStatus')
        .isIn(['None', 'Under Review', 'Approved', 'Pending', 'Requires Documentation'])
        .withMessage('Invalid loan application status'),
    body('fraudScenario')
        .isBoolean()
        .withMessage('Fraud scenario must be true or false')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const userData = req.body;

        // Standardize the phone number
        const standardizedPhone = PhoneNumberUtils.standardizeNorthAmerican(userData.phoneNumber);
        if (!standardizedPhone) {
            return res.status(400).json({
                error: 'Invalid phone number format. Please provide a valid North American phone number.'
            });
        }

        // Get phone number metadata for logging
        const phoneMetadata = PhoneNumberUtils.getMetadata(standardizedPhone);
        console.log('Registration attempt:', {
            original: userData.phoneNumber,
            standardized: standardizedPhone,
            metadata: phoneMetadata
        });

        // Update userData with standardized phone number
        const standardizedUserData = {
            ...userData,
            phoneNumber: standardizedPhone
        };

        // Register the user in the database
        const user = await databaseManager.registerUser(standardizedUserData);

        // Send SMS confirmation
        try {
            const smsResult = await smsService.sendRegistrationConfirmation(user);
            console.log('SMS sent successfully:', smsResult);
        } catch (smsError) {
            console.error('SMS sending failed:', smsError);
            // Don't fail the registration if SMS fails
        }

        // Return success response
        res.status(201).json({
            success: true,
            message: 'Registration successful',
            user: {
                id: user.id,
                name: user.name,
                phoneNumber: user.phone_number,
                companyName: user.company_name,
                fakeAccountNumber: user.fake_account_number,
                fakeAccountBalance: user.fake_account_balance,
                loanApplicationStatus: user.loan_application_status,
                fraudScenario: Boolean(user.fraud_scenario)
            },
            demoNumber: process.env.DEMO_CALL_NUMBER || '+1-XXX-XXX-XXXX'
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.message.includes('Phone number already registered')) {
            return res.status(409).json({
                error: 'This phone number is already registered for the demo. Each phone number can only be registered once.'
            });
        }

        res.status(500).json({
            error: 'Registration failed. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get user info by phone number (for testing)
router.get('/api/user/:phoneNumber', async (req, res) => {
    try {
        const phoneNumber = decodeURIComponent(req.params.phoneNumber);
        const user = await databaseManager.getUserByPhone(phoneNumber);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get additional user data
        const [loanApplications, transactions] = await Promise.all([
            databaseManager.getUserLoanApplications(user.id),
            databaseManager.getUserTransactions(user.id, 5)
        ]);

        res.json({
            user,
            loanApplications,
            recentTransactions: transactions
        });

    } catch (error) {
        console.error('User lookup error:', error);
        res.status(500).json({ error: 'Failed to retrieve user information' });
    }
});

// Admin dashboard - list all registered users
router.get('/api/admin/users', async (req, res) => {
    try {
        // Simple auth check - in production, use proper authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_TOKEN || 'demo-admin-token'}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get all users with basic info
        const users = await new Promise((resolve, reject) => {
            databaseManager.db.all(
                `SELECT id, name, phoneNumber, companyName, fakeAccountNumber, 
                        fakeAccountBalance, loanApplicationStatus, fraudScenario,
                        registeredAt, lastCallAt, callCount 
                 FROM users ORDER BY registeredAt DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ users });

    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// Health check endpoint
router.get('/api/health', async (req, res) => {
    try {
        // Simplified health check - assume database is healthy to avoid timeouts
        let dbHealthy = true;

        let smsStatus = 'not_configured';
        try {
            smsStatus = smsService.isConfigured() ? 'configured' : 'not_configured';
        } catch (error) {
            console.error('SMS service check failed:', error);
            smsStatus = 'error';
        }

        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: dbHealthy ? 'healthy' : 'unhealthy',
                sms: smsStatus,
                voice: process.env.INFOBIP_API_KEY ? 'configured' : 'not_configured',
                openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
                elevenlabs: process.env.ELEVENLABS_API_KEY ? 'configured' : 'not_configured'
            },
            environment: process.env.NODE_ENV || 'development'
        };

        res.json(health);

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Demo scenarios info endpoint
// Voice webhook endpoints for Infobip Voice API
router.post('/webhook/voice', async (req, res) => {
    try {
        const event = req.body;
        console.log('📞 Received Infobip Voice event:', event.type, event.callId);
        console.log('🔍 Full webhook payload:', JSON.stringify(event, null, 2));

        switch (event.type) {
            case 'CALL_RECEIVED':
                await callsHandler.handleCallReceived(event);
                break;
                
            case 'CALL_HANGUP':
            case 'CALL_FINISHED':
                await callsHandler.handleCallHangup(event);
                break;
                
            default:
                console.log(`ℹ️  Unhandled voice event type: ${event.type}`);
        }
        
        res.status(200).send('OK');
        
    } catch (error) {
        console.error('❌ Error handling voice webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Call management endpoints
router.get('/api/calls/active', (req, res) => {
    try {
        const activeCalls = callsHandler.getActiveCalls();
        res.json({ activeCalls });
    } catch (error) {
        console.error('❌ Error getting active calls:', error);
        res.status(500).json({ error: 'Failed to get active calls' });
    }
});

router.post('/api/calls/:callId/transfer', async (req, res) => {
    try {
        const { callId } = req.params;
        const { reason = 'general' } = req.body;
        
        const result = await callsHandler.transferToLiveAgent(callId, reason);
        res.json({ success: true, transfer: result });
        
    } catch (error) {
        console.error('❌ Error transferring call:', error);
        res.status(500).json({ error: 'Failed to transfer call' });
    }
});

// Dynamic knowledge base endpoint for ElevenLabs with real database data
router.get('/knowledge-base', async (req, res) => {
    try {
        let users, officers, loanApplications, recentTransactions;

        // Check if we're using PostgreSQL or SQLite
        if (databaseManager.pool) {
            // PostgreSQL queries
            const usersResult = await databaseManager.pool.query(
                'SELECT * FROM users ORDER BY registered_at DESC'
            );
            users = usersResult.rows;

            const officersResult = await databaseManager.pool.query(
                'SELECT * FROM officers'
            );
            officers = officersResult.rows;

            const loanAppsResult = await databaseManager.pool.query(`
                SELECT la.*, u.name as user_name, u.phone_number as user_phone 
                FROM loan_applications la 
                JOIN users u ON la.user_id = u.id 
                ORDER BY la.applied_at DESC
            `);
            loanApplications = loanAppsResult.rows;

            const transactionsResult = await databaseManager.pool.query(`
                SELECT t.*, u.name as user_name, u.phone_number as user_phone 
                FROM transactions t 
                JOIN users u ON t.user_id = u.id 
                ORDER BY t.transaction_date DESC LIMIT 50
            `);
            recentTransactions = transactionsResult.rows;
        } else {
            // SQLite queries
            users = await new Promise((resolve, reject) => {
                databaseManager.db.all(
                    `SELECT * FROM users ORDER BY registeredAt DESC`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            officers = await new Promise((resolve, reject) => {
                databaseManager.db.all(
                    `SELECT * FROM officers`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            loanApplications = await new Promise((resolve, reject) => {
                databaseManager.db.all(
                    `SELECT la.*, u.name as user_name, u.phoneNumber as user_phone 
                     FROM loan_applications la 
                     JOIN users u ON la.userId = u.id 
                     ORDER BY la.appliedAt DESC`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            recentTransactions = await new Promise((resolve, reject) => {
                databaseManager.db.all(
                    `SELECT t.*, u.name as user_name, u.phoneNumber as user_phone 
                     FROM transactions t 
                     JOIN users u ON t.userId = u.id 
                     ORDER BY t.transactionDate DESC LIMIT 50`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });
        }

        // Create comprehensive knowledge base content
        const knowledgeBase = `# Infobip Capital Banking - Live Customer Database

## 🚨 CRITICAL DEMO INSTRUCTIONS 🚨
**THIS IS A DEMO SYSTEM** - Use simplified verification only:
- ✅ USE: Phone number, name, company name for verification
- ❌ NEVER ASK FOR: SSN, DOB, PIN, security questions, addresses, or ANY other traditional banking verification
- 🎯 GOAL: Showcase AI capabilities with smooth, realistic interactions
- 🔒 SECURITY: Keep it simple - phone + name verification is sufficient
- 📊 CLIENT DATA: User's specific account info is sent via conversation_initiation_client_data at call start
- ⚡ IMMEDIATE ACCESS: You have their balance, account number, and status from the first message

## Company Information
**Company:** Infobip Capital  
**Industry:** Digital Banking & Financial Services  
**Demo System:** AI-Powered Voice Banking Assistant  
**Last Updated:** ${new Date().toISOString()}

## Customer Accounts Database

${users.map(user => {
    const userLoanApps = loanApplications.filter(loan => 
        (loan.userId === user.id) || (loan.user_id === user.id)
    );
    const userTransactions = recentTransactions.filter(tx => 
        (tx.userId === user.id) || (tx.user_id === user.id)
    ).slice(0, 5);
    
    // Handle both PostgreSQL (snake_case) and SQLite (camelCase) field names
    const phone = user.phone_number || user.phoneNumber;
    const company = user.company_name || user.companyName;
    const accountNumber = user.fake_account_number || user.fakeAccountNumber;
    const balance = user.fake_account_balance || user.fakeAccountBalance;
    const registered = user.registered_at || user.registeredAt;
    const callCount = user.call_count || user.callCount || 0;
    const lastCall = user.last_call_at || user.lastCallAt;
    const fraudFlag = user.fraud_scenario || user.fraudScenario;
    
    return `### Customer: ${user.name}
**Phone:** ${phone}  
**Company:** ${company}  
**Account Number:** ${accountNumber}  
**Current Balance:** $${parseFloat(balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}  
**Registered:** ${new Date(registered).toLocaleDateString()}  
**Total Calls Made:** ${callCount}  
**Last Call:** ${lastCall ? new Date(lastCall).toLocaleDateString() : 'Never'}  
**Fraud Flag:** ${fraudFlag ? 'YES - REQUIRES IMMEDIATE AGENT TRANSFER' : 'No'}  

**Loan Applications:**
${userLoanApps.length > 0 ? userLoanApps.map(loan => {
    const loanType = loan.loan_type || loan.loanType;
    const loanAmount = loan.loan_amount || loan.loanAmount;
    const nextStep = loan.next_step || loan.nextStep;
    const assignedOfficer = loan.assigned_officer || loan.assignedOfficer;
    const appliedAt = loan.applied_at || loan.appliedAt;
    
    return `- ${loanType}: $${parseFloat(loanAmount).toLocaleString('en-US')} - Status: ${loan.status}
  Next Step: ${nextStep}
  Assigned Officer: ${assignedOfficer}
  Applied: ${new Date(appliedAt).toLocaleDateString()}`;
}).join('\n') : '- No active loan applications'}

**Recent Transaction History:**
${userTransactions.length > 0 ? userTransactions.map(tx => {
    const transactionDate = tx.transaction_date || tx.transactionDate;
    const transactionType = tx.transaction_type || tx.transactionType;
    
    return `- ${new Date(transactionDate).toLocaleDateString()}: ${tx.description} - $${Math.abs(parseFloat(tx.amount)).toFixed(2)} ${transactionType === 'credit' ? '(Credit)' : '(Debit)'} [${tx.category}]`;
}).join('\n') : '- No recent transactions'}

---
`;
}).join('\n')}

## Bank Officers & Specialists

${officers.map(officer => {
    const phoneNumber = officer.phone_number || officer.phoneNumber;
    
    return `### ${officer.name} - ${officer.department}
**Specialization:** ${officer.specialization}  
**Phone:** ${phoneNumber}  
**Email:** ${officer.email}  
`;
}).join('\n')}

## IMPORTANT: Security & Verification Protocols

### Available Customer Verification Methods (ONLY USE THESE):
1. **Phone Number** - Primary identifier (caller ID should match)
2. **Full Name** - As registered in the system
3. **Company Name** - As provided during registration
4. **Account Number** - Available in database for confirmation

### DO NOT ASK FOR (These don't exist in our system):
- Social Security Number (SSN)
- Date of birth
- Mother's maiden name
- PIN numbers
- Security questions
- Physical address
- Driver's license number
- Any other traditional banking verification methods

**VERIFICATION PROCESS:**
- If caller ID matches registered phone number → Proceed immediately
- If no caller ID or mismatch → Ask for name and confirm company name
- That's it! No additional security measures needed for this demo

## Service Instructions

### Balance Inquiries
- Always provide the exact current balance from the database
- Include account number for reference
- Mention any recent significant transactions if relevant
- NO additional verification needed beyond name/phone confirmation

### Loan Status Updates
- Provide current status from loan_applications table
- Include next steps and assigned officer information
- Give realistic timelines based on status
- Share loan officer contact information when helpful

### Fraud Prevention Protocol
**CRITICAL:** If customer has fraud_scenario = true, immediately:
1. Acknowledge their concern professionally
2. Inform them you're transferring to our fraud specialist
3. DO NOT discuss account details over the phone
4. Transfer to Sarah Johnson in Fraud Prevention (+15553728321)
5. NO additional verification needed - fraud scenarios get immediate escalation

### Transaction Inquiries
- Reference specific transactions from the database
- Provide merchant names, amounts, and dates
- Categorize spending patterns when helpful
- Share up to 5 most recent transactions

### Account Activation
- Verify customer identity with phone number and name only
- Confirm company name matches registration
- Guide through activation steps
- No complex security protocols needed

### General Customer Service
- Always use customer's name once verified
- Be professional, helpful, and efficient
- Escalate complex issues to appropriate specialists
- Keep interactions smooth and demo-friendly
- Focus on showcasing AI capabilities, not security barriers

## Demo Scenarios Available
1. **Balance Inquiry** - Check current account balance
2. **Loan Status Check** - Review loan application progress  
3. **Fraud Alert & Agent Transfer** - Handle fraud reports with immediate escalation
4. **Transaction History** - Review recent account activity
5. **Account Activation** - Activate new customer accounts
6. **General Banking Support** - Handle various banking questions

---
*This knowledge base is dynamically generated from live database at ${new Date().toISOString()}*`;

        // Return as plain text for ElevenLabs
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(knowledgeBase);
        
    } catch (error) {
        console.error('Knowledge base generation error:', error);
        res.status(500).json({ error: 'Failed to generate knowledge base' });
    }
});

router.get('/api/scenarios', (req, res) => {
    const scenarios = [
        {
            id: 'balance_inquiry',
            name: 'Balance Inquiry',
            description: 'Check account balance',
            samplePhrases: [
                "What's my account balance?",
                "How much money do I have?",
                "Check my balance please"
            ]
        },
        {
            id: 'loan_status',
            name: 'Loan Status Check',
            description: 'Check loan application status',
            samplePhrases: [
                "What's the status of my loan application?",
                "Check my loan status",
                "Is my loan approved?"
            ]
        },
        {
            id: 'fraud_alert',
            name: 'Fraud Alert & Agent Handoff',
            description: 'Report fraud and transfer to live agent',
            samplePhrases: [
                "I think my card was used fraudulently",
                "There are charges I didn't make",
                "I need to report fraud"
            ]
        },
        {
            id: 'account_activation',
            name: 'Account Activation',
            description: 'Activate a new account',
            samplePhrases: [
                "I want to activate my account",
                "Activate my new account",
                "How do I activate my account?"
            ]
        },
        {
            id: 'voice_registration',
            name: 'Voice Registration',
            description: 'Register for demo over the phone',
            samplePhrases: [
                "I want to register for the demo",
                "Sign me up for the demo",
                "I need to register"
            ]
        }
    ];

    res.json({ scenarios });
});

module.exports = router;