#!/usr/bin/env node

require('dotenv').config();
const WebSocketProxy = require('./src/voice/websocketProxy');

console.log('🚀 Starting Infobip Capital WebSocket Proxy Server...');
console.log('📍 Environment:', process.env.NODE_ENV || 'development');

// Validate required environment variables
const requiredEnvVars = {
    ELEVENLABS_API_KEY: 'ElevenLabs API key',
    ELEVENLABS_AGENT_ID: 'ElevenLabs Agent ID'
};

const missingVars = [];
for (const [envVar, description] of Object.entries(requiredEnvVars)) {
    if (!process.env[envVar]) {
        missingVars.push(`${envVar} (${description})`);
    }
}

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varInfo => console.error(`   - ${varInfo}`));
    console.error('\n💡 Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

// Create and start the WebSocket proxy
const proxy = new WebSocketProxy();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔄 Shutting down WebSocket Proxy Server gracefully...');
    proxy.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
    proxy.stop();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    proxy.stop();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    proxy.stop();
    process.exit(1);
});

// Start the proxy server
try {
    proxy.start();
    
    console.log('\n📊 Proxy Server Status:');
    console.log(`   🔌 WebSocket Port: ${process.env.WS_PROXY_PORT || 3500}`);
    console.log(`   🤖 ElevenLabs Agent: ${process.env.ELEVENLABS_AGENT_ID}`);
    console.log(`   🎙️  Audio Format: PCM 16000 Hz`);
    
    console.log('\n🎯 Ready to bridge Infobip ↔ ElevenLabs for AI voice banking!');
    
} catch (error) {
    console.error('❌ Failed to start WebSocket Proxy Server:', error);
    process.exit(1);
}