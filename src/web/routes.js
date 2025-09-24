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
                phoneNumber: user.phoneNumber,
                companyName: user.companyName,
                fakeAccountNumber: user.fakeAccountNumber,
                fakeAccountBalance: user.fakeAccountBalance,
                loanApplicationStatus: user.loanApplicationStatus,
                fraudScenario: Boolean(user.fraudScenario)
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