#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkRequiredEnvVar(name, description) {
  const value = process.env[name];
  if (!value || value.includes('your_') || value.includes('here')) {
    log(`❌ ${name}: Not configured - ${description}`, colors.red);
    return false;
  } else {
    log(`✅ ${name}: Configured`, colors.green);
    return true;
  }
}

function checkOptionalEnvVar(name, description) {
  const value = process.env[name];
  if (!value || value.includes('your_') || value.includes('here')) {
    log(`⚠️  ${name}: Not configured - ${description}`, colors.yellow);
    return false;
  } else {
    log(`✅ ${name}: Configured`, colors.green);
    return true;
  }
}

async function validateElevenLabsConnection() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey.includes('your_')) {
    log('⏭️  Skipping ElevenLabs connection test - API key not configured', colors.yellow);
    return false;
  }

  try {
    const fetch = require('node-fetch');
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: {
        'xi-api-key': apiKey
      }
    });

    if (response.ok) {
      const data = await response.json();
      log(`✅ ElevenLabs API: Connected (User: ${data.email || 'Unknown'})`, colors.green);
      return true;
    } else {
      log(`❌ ElevenLabs API: Invalid API key or connection failed`, colors.red);
      return false;
    }
  } catch (error) {
    log(`❌ ElevenLabs API: Connection error - ${error.message}`, colors.red);
    return false;
  }
}

async function validateInfobipConnection() {
  const apiKey = process.env.INFOBIP_API_KEY;
  const baseUrl = process.env.INFOBIP_BASE_URL;
  
  if (!apiKey || apiKey.includes('your_') || !baseUrl) {
    log('⏭️  Skipping Infobip connection test - API key or URL not configured', colors.yellow);
    return false;
  }

  try {
    const fetch = require('node-fetch');
    const response = await fetch(`${baseUrl}/account/1/balance`, {
      headers: {
        'Authorization': `App ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      log(`✅ Infobip API: Connected`, colors.green);
      return true;
    } else {
      log(`❌ Infobip API: Invalid API key or connection failed`, colors.red);
      return false;
    }
  } catch (error) {
    log(`❌ Infobip API: Connection error - ${error.message}`, colors.red);
    return false;
  }
}

async function main() {
  log('\n🔍 Dynamic Fintech Demo - Configuration Validation\n', colors.cyan);

  let allGood = true;

  // Check required environment variables
  log('📋 Checking Required Configuration:', colors.blue);
  allGood &= checkRequiredEnvVar('INFOBIP_API_KEY', 'Required for Infobip Voice API calls');
  allGood &= checkRequiredEnvVar('INFOBIP_BASE_URL', 'Base URL for Infobip API');
  allGood &= checkRequiredEnvVar('ELEVENLABS_API_KEY', 'Required for ElevenLabs voice generation');
  
  log('\n📋 Checking Optional Configuration:', colors.blue);
  checkOptionalEnvVar('INFOBIP_APPLICATION_ID', 'Needed for voice application configuration');
  checkOptionalEnvVar('ELEVENLABS_AGENT_ID', 'Required for conversational AI agent');
  checkOptionalEnvVar('ELEVENLABS_VOICE_ID', 'Specific voice to use for responses');
  checkOptionalEnvVar('MEDIA_STREAM_CONFIG_ID', 'Required for real-time audio streaming');
  checkOptionalEnvVar('DEMO_CALL_NUMBER', 'Phone number users will call for demo');

  // Check database
  log('\n📊 Checking Database:', colors.blue);
  const dbPath = process.env.DATABASE_PATH || './data/fintech_demo.db';
  if (fs.existsSync(dbPath)) {
    log(`✅ Database: Found at ${dbPath}`, colors.green);
  } else {
    log(`⚠️  Database: Not found at ${dbPath} - will be created on first run`, colors.yellow);
  }

  // Test API connections
  log('\n🌐 Testing API Connections:', colors.blue);
  await validateElevenLabsConnection();
  await validateInfobipConnection();

  // Check webhook configuration
  log('\n🔗 Webhook Configuration:', colors.blue);
  const webhookUrl = process.env.WEBHOOK_BASE_URL;
  if (webhookUrl && !webhookUrl.includes('localhost')) {
    log(`✅ Webhook URL: Configured for production (${webhookUrl})`, colors.green);
  } else {
    log(`⚠️  Webhook URL: Using localhost - you'll need ngrok or similar for Infobip webhooks`, colors.yellow);
  }

  // Final summary
  log('\n📋 Configuration Summary:', colors.cyan);
  if (allGood) {
    log('🎉 All required configurations are set! Ready to proceed.', colors.green);
  } else {
    log('⚠️  Some required configurations are missing. Please update your .env file.', colors.yellow);
  }

  log('\n📖 Next Steps:', colors.blue);
  log('1. Update missing environment variables in .env file');
  log('2. Set up Infobip Voice Application and Media Streaming');
  log('3. Configure ElevenLabs Conversational Agent');
  log('4. Set up ngrok for webhook testing (if using localhost)');
  log('5. Test with npm run dev:all\n');
}

main().catch(console.error);