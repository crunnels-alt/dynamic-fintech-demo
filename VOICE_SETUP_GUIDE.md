# Dynamic Fintech Demo - Voice Configuration Guide

This guide will walk you through setting up the voice infrastructure for your Dynamic Fintech Demo at Dev Days NYC.

## 🔧 Step 1: Validate Your Current Configuration

First, let's check what's already configured:

```bash
npm run validate-config
```

This will show you which environment variables need to be set and test API connections.

## 🔑 Step 2: Get Your API Keys

### Infobip Voice API
1. Log into your [Infobip Portal](https://portal.infobip.com)
2. Go to **Developers > API Keys**
3. Copy your API key and update in `.env`:
   ```env
   INFOBIP_API_KEY=your_actual_api_key_here
   ```

### ElevenLabs API
1. Log into [ElevenLabs](https://elevenlabs.io)
2. Go to **Profile & API Key** in your account settings
3. Copy your API key and update in `.env`:
   ```env
   ELEVENLABS_API_KEY=your_actual_api_key_here
   ```

## 📞 Step 3: Configure Infobip Voice Application

### Create a Voice Application
1. In Infobip Portal, go to **Voice & Video > Applications**
2. Click **Create Application**
3. Configure:
   - **Name**: `Dynamic Fintech Demo`
   - **Type**: `Voice`
   - **Webhook URL**: `https://your-ngrok-url.ngrok.io/api/voice/webhook` (see Step 6)
4. Save and copy the **Application ID** to your `.env`:
   ```env
   INFOBIP_APPLICATION_ID=your_application_id_here
   ```

### Configure Media Streaming
1. In the same Voice Application, go to **Media Streaming**
2. Create a new configuration:
   - **Name**: `Fintech Demo Streaming`
   - **WebSocket URL**: `wss://your-ngrok-url.ngrok.io/ws-proxy`
   - **Audio Format**: `LINEAR16` (16kHz, mono)
   - **Enable bidirectional streaming**: Yes
3. Save and copy the **Media Stream Config ID**:
   ```env
   MEDIA_STREAM_CONFIG_ID=your_media_stream_config_id_here
   ```

### Get a Demo Phone Number
1. Go to **Numbers > My Numbers** in Infobip Portal
2. Purchase or assign a US phone number for your demo
3. Configure it to use your Voice Application
4. Update your `.env`:
   ```env
   DEMO_CALL_NUMBER=+1XXXXXXXXXX
   ```

## 🤖 Step 4: Configure ElevenLabs Conversational Agent

### Create a Conversational Agent
1. Go to [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai)
2. Create a new agent with these settings:
   - **Name**: `Infobip Capital Banking Assistant`
   - **Conversation Config**:
     ```json
     {
       "agent": {
         "prompt": {
           "prompt": "You are a helpful banking assistant for Infobip Capital. You can help customers with account balances, loan applications, and fraud alerts. Always be professional, friendly, and secure. If you detect potential fraud, immediately offer to transfer to a live agent.",
           "llm": "gpt-4o-mini"
         },
         "first_message": "Hello! Welcome to Infobip Capital. I'm your AI banking assistant. How can I help you today?",
         "language": "en"
       }
     }
     ```
   - **Voice Settings**:
     - Choose a professional, clear voice (recommend `Rachel` or `Adam`)
     - **Stability**: 0.5
     - **Similarity**: 0.75
     - **Style**: 0.25

3. Copy the **Agent ID** to your `.env`:
   ```env
   ELEVENLABS_AGENT_ID=your_agent_id_here
   ELEVENLABS_VOICE_ID=your_chosen_voice_id
   ```

## 🌐 Step 5: Set Up Public Webhooks with ngrok

Since Infobip needs to send webhooks to your server, you need a public URL:

### Install ngrok
```bash
# macOS
brew install ngrok

# Or download from https://ngrok.com/download
```

### Expose Your Local Server
```bash
# Start your demo servers first
npm run dev:all

# In another terminal, expose port 3002
ngrok http 3002
```

### Update Webhook URLs
Copy the ngrok URL (e.g., `https://abc123.ngrok.io`) and update your `.env`:
```env
WEBHOOK_BASE_URL=https://abc123.ngrok.io
```

**Important**: Update the webhook URLs in your Infobip Voice Application settings to use this ngrok URL.

## ✅ Step 6: Validate Complete Configuration

Run the validation script again to ensure everything is configured:

```bash
npm run validate-config
```

You should see all green checkmarks for:
- ✅ Infobip API connection
- ✅ ElevenLabs API connection  
- ✅ All required environment variables
- ✅ Webhook URL configured

## 🚀 Step 7: Test the Voice Flow

### Start the Demo
```bash
npm run dev:all
```

This starts both:
- Main server on port 3002 (web form + voice webhooks)
- WebSocket proxy on port 3001 (ElevenLabs bridge)

### Test the Complete Flow
1. **Register a user**: Visit `http://localhost:3002` and register with your phone number
2. **Receive SMS**: Check for the SMS with demo instructions
3. **Make a voice call**: Call your demo number from the registered phone
4. **Talk to AI**: The system should:
   - Recognize your phone number
   - Load your personalized financial data
   - Connect you to the ElevenLabs AI assistant
   - Handle banking queries (balance, loans, fraud)

## 🐛 Troubleshooting

### Common Issues

**"WebSocket connection failed"**
- Ensure ngrok is running and URL is updated in `.env`
- Check that both servers are running (`npm run dev:all`)

**"User not found" during voice call**
- Make sure you registered via the web form first
- Check that phone numbers match exactly

**"ElevenLabs API error"**
- Verify your API key has sufficient credits
- Check that your agent ID is correct

**"No audio during call"**
- Verify Media Streaming configuration in Infobip
- Check WebSocket proxy logs for connection issues

### Debug Commands
```bash
# Check configuration
npm run validate-config

# View server logs
npm run dev:all

# Test phone number parsing
npm run test-phones
```

## 📊 Monitoring

During your demo, monitor:
- Server logs for webhook events
- WebSocket proxy connections
- ElevenLabs usage/credits
- Infobip call logs in the portal

---

## 🎉 You're Ready!

Once all steps are complete, your Dynamic Fintech Demo will provide:
- ✅ Web registration with SMS confirmations
- ✅ Voice calls with AI-powered banking assistance
- ✅ Personalized customer data lookup
- ✅ Fraud detection with live agent transfer
- ✅ Real-time audio streaming and conversation

Perfect for showcasing Infobip's voice capabilities at Dev Days NYC! 🎤✨