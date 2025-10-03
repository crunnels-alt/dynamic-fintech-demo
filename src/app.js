// Load environment variables (Railway provides them directly in production)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Debug: Log some key environment variables
console.log('🔧 Environment Debug:');
console.log('   NODE_ENV:', process.env.NODE_ENV);
console.log('   DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('   DEMO_CALL_NUMBER:', process.env.DEMO_CALL_NUMBER);
console.log('   Railway env vars:', Object.keys(process.env).filter(k => k.startsWith('RAILWAY')).length);
const express = require('express');
const cors = require('cors');
const path = require('path');
const DatabaseFactory = require('./database/DatabaseFactory');
const routes = require('./web/routes');
const WebSocketProxy = require('./voice/websocketProxy');

// Initialize database manager based on environment
const databaseManager = DatabaseFactory.create();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// API routes
app.use('/', routes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize database and start server
async function startServer() {
    try {
        console.log('🚀 Starting Infobip Capital Demo Server...');
        console.log('📍 Environment:', process.env.NODE_ENV || 'development');
        
        // Initialize database
        await databaseManager.initialize();
        console.log('✅ Database initialized successfully');

        // Check service configurations
        const services = {
            database: '✅ Connected',
            sms: process.env.INFOBIP_SMS_API_KEY || process.env.INFOBIP_API_KEY ? '✅ Configured' : '⚠️  Not configured',
            voice: process.env.INFOBIP_API_KEY ? '✅ Configured' : '⚠️  Not configured',
            openai: process.env.OPENAI_API_KEY ? '✅ Configured' : '⚠️  Not configured'
        };

        console.log('\n📊 Service Status:');
        Object.entries(services).forEach(([service, status]) => {
            console.log(`   ${service.padEnd(10)}: ${status}`);
        });

        // Start server
        const server = app.listen(PORT, () => {
            console.log(`\n🏦 Infobip Capital Demo Server running on port ${PORT}`);
            console.log(`📱 Registration form: http://localhost:${PORT}`);
            console.log(`🔧 Health check: http://localhost:${PORT}/api/health`);
            console.log(`📋 Demo scenarios: http://localhost:${PORT}/api/scenarios`);

            if (process.env.NODE_ENV !== 'production') {
                console.log('\n🧪 Development Mode:');
                console.log('   - Detailed error messages enabled');
                console.log('   - CORS enabled for all origins');
                console.log('   - Database logs enabled');
            }

            console.log('\n🎯 Ready for Dev Days NYC demo!');
        });

        // Start WebSocket proxy for voice calls using the same server
        console.log('🔌 Starting WebSocket proxy for voice integration...');
        const wsProxy = new WebSocketProxy();
        WebSocketProxy.setInstance(wsProxy); // Store singleton instance
        await wsProxy.attachToServer(server); // Wait for signed URL pool to initialize
        console.log('✅ WebSocket proxy initialized with signed URL pool');

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down server gracefully...');
    try {
        const wsProxy = WebSocketProxy.getInstance();
        if (wsProxy) {
            wsProxy.stop();
            console.log('✅ WebSocket proxy stopped');
        }
        await databaseManager.close();
        console.log('✅ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
    try {
        const wsProxy = WebSocketProxy.getInstance();
        if (wsProxy) {
            wsProxy.stop();
            console.log('✅ WebSocket proxy stopped');
        }
        await databaseManager.close();
        console.log('✅ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app;