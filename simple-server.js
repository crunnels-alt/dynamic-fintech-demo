require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const databaseManager = require('./src/database/databaseManager');
const PhoneNumberUtils = require('./src/utils/phoneUtils');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ message: 'Simple server is working!' });
});

// Registration endpoint (simplified)
app.post('/api/register', async (req, res) => {
    try {
        console.log('Registration request:', req.body);
        
        const { phoneNumber, name, companyName, fakeAccountBalance, loanApplicationStatus, fraudScenario } = req.body;

        // Validate required fields
        if (!phoneNumber || !name || !companyName) {
            return res.status(400).json({
                error: 'Missing required fields: phoneNumber, name, companyName'
            });
        }

        // Standardize phone number
        const standardizedPhone = PhoneNumberUtils.standardizeNorthAmerican(phoneNumber);
        if (!standardizedPhone) {
            return res.status(400).json({
                error: 'Invalid phone number format. Please provide a valid North American phone number.'
            });
        }

        console.log('Phone standardized:', phoneNumber, '->', standardizedPhone);

        // Prepare user data
        const userData = {
            phoneNumber: standardizedPhone,
            name,
            companyName,
            fakeAccountBalance: parseFloat(fakeAccountBalance) || 2500.00,
            loanApplicationStatus: loanApplicationStatus || 'None',
            fraudScenario: Boolean(fraudScenario)
        };

        // Register user
        const user = await databaseManager.registerUser(userData);
        
        console.log('User registered successfully:', user.name, user.phoneNumber);

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
                error: 'This phone number is already registered for the demo.'
            });
        }

        res.status(500).json({
            error: 'Registration failed. Please try again.',
            details: error.message
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            database: 'connected',
            server: 'running'
        }
    });
});

// Start server
async function startServer() {
    try {
        console.log('🚀 Starting Simple Infobip Capital Demo Server...');
        
        // Initialize database
        await databaseManager.initialize();
        console.log('✅ Database initialized');

        app.listen(PORT, () => {
            console.log(`🏦 Simple server running on port ${PORT}`);
            console.log(`📱 Form: http://localhost:${PORT}`);
            console.log(`🔧 Health: http://localhost:${PORT}/api/health`);
            console.log(`🧪 Test: http://localhost:${PORT}/test`);
        });

    } catch (error) {
        console.error('❌ Server startup failed:', error);
        process.exit(1);
    }
}

startServer();