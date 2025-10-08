# Setup & Deployment Guide

Complete guide for setting up, configuring, and deploying the Dynamic Fintech Demo.

---

## 📋 Table of Contents

1. [API Keys & Credentials](#api-keys--credentials)
2. [Local Development Setup](#local-development-setup)
3. [Infobip Configuration](#infobip-configuration)
4. [ElevenLabs Configuration](#elevenlabs-configuration)
5. [Railway Deployment](#railway-deployment)
6. [Testing & Verification](#testing--verification)
7. [Troubleshooting](#troubleshooting)

---

## API Keys & Credentials

### Required Services

You'll need accounts and API keys from:
- **Infobip** - Voice API and SMS API
- **ElevenLabs** - Conversational AI
- **Railway** - Hosting platform (optional for deployment)

### Infobip Setup

1. **Portal Access**
   - Log into [Infobip Portal](https://portal.infobip.com)
   - Verify access to Voice & SMS services

2. **Get API Key**
   - Navigate to **Developers** → **API Keys**
   - Copy your existing API key OR create a new one
   - Required permissions: Voice API, SMS API

3. **Get Phone Number**
   - Go to **Numbers** → **My Numbers**
   - Note an available US number OR purchase one
   - This will be your demo call number

### ElevenLabs Setup

1. **Account Setup**
   - Sign up/login at [ElevenLabs](https://elevenlabs.io)
   - Verify you have available credits for API usage

2. **Get API Key**
   - Go to your profile (top right) → **Profile & API Key**
   - Copy your API key

3. **Create Conversational Agent**
   - Go to [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai)
   - Create a new agent: "Infobip Capital Banking Assistant"
   - Choose a professional voice (Rachel or Adam recommended)
   - Copy the Agent ID

### Environment Variables

Create a `.env` file in the project root:

```env
# Infobip Configuration
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_BASE_URL=https://api.infobip.com
INFOBIP_SMS_API_KEY=your_infobip_api_key  # Usually same as above
MEDIA_STREAM_CONFIG_ID=your_config_id      # Set after Infobip config

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_agent_id

# Webhook Configuration (set after deployment)
WEBHOOK_BASE_URL=your_deployment_url

# Demo Settings
DEMO_CALL_NUMBER=+1XXXXXXXXXX
COMPANY_NAME=Infobip Capital

# Database (auto-configured by Railway)
DATABASE_URL=postgresql://...  # Leave blank for local SQLite
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+ installed
- Git installed
- Railway CLI (optional, for deployment)

### Installation

```bash
# Clone the repository
git clone <repository>
cd dynamic-fintech-demo

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys

# Initialize database
npm run setup-db

# Start the development server
npm start
```

### Testing Locally with ngrok

Since Infobip needs to send webhooks to your server, use ngrok for local testing:

```bash
# Install ngrok
brew install ngrok  # macOS
# Or download from https://ngrok.com/download

# In one terminal - start the app
npm start

# In another terminal - expose to internet
ngrok http 3500

# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
# Update WEBHOOK_BASE_URL in .env with this URL
```

---

## Infobip Configuration

### Media Stream Configuration

**Critical settings for audio streaming:**

1. **Create Media Stream Config**
   - Log into Infobip Portal
   - Go to **Voice & Video → Media Stream Configurations**
   - Click **Create Configuration**

2. **Required Settings**

| Setting | Value | Notes |
|---------|-------|-------|
| **Name** | Fintech Demo Audio | |
| **Audio Format** | `LINEAR16` or `PCM` | Must match exactly |
| **Sample Rate** | `16000` Hz | Standard for voice |
| **Bit Depth** | `16-bit` | CD-quality |
| **Channels** | `1` (mono) | Voice calls are mono |
| **Byte Order** | Little Endian | Standard PCM |
| **Bidirectional** | Enabled | Critical for two-way audio |

3. **WebSocket URL Configuration**

For local development (with ngrok):
```
wss://your-ngrok-url.ngrok.io/websocket-voice
```

For Railway deployment:
```
wss://your-app.up.railway.app/websocket-voice
```

**Important:**
- Protocol MUST be `wss://` (secure WebSocket)
- Path MUST be `/websocket-voice`
- Domain must match your deployment

4. **Save and Copy Config ID**
   - Copy the Media Stream Config ID
   - Add to `.env` as `MEDIA_STREAM_CONFIG_ID`

### Voice Application Configuration

1. **Create Voice Application**
   - Go to **Voice & Video → Applications**
   - Click **Create Application**

2. **Configure Settings**
   - **Name**: `Dynamic Fintech Demo`
   - **Type**: `Voice`
   - **Media Stream Config**: Select the config you created above

3. **Configure Webhooks**

For local development:
```
https://your-ngrok-url.ngrok.io/api/webhooks/calls/received
```

For Railway:
```
https://your-app.up.railway.app/api/webhooks/calls/received
```

4. **Assign Phone Number**
   - Link your Infobip phone number to this application
   - Incoming calls will now trigger your webhook

---

## ElevenLabs Configuration

### Agent Dashboard Settings

1. **Navigate to Agent Settings**
   - Go to [ElevenLabs Dashboard](https://elevenlabs.io/conversational-ai)
   - Select your agent

2. **Audio Settings**

| Setting | Value |
|---------|-------|
| **Input Audio Format** | PCM 16000 Hz |
| **Output Audio Format** | PCM 16000 Hz |
| **Input Mode** | Streaming |

3. **Security Settings**

Enable the following overrides:
- ✅ **Prompt Override** - Must be enabled
- ✅ **First Message Override** - Must be enabled
- ✅ **Language Override** - Recommended
- ✅ **Dynamic Variables** - Required for personalization

4. **Conversation Settings**
   - **Conversation Timeout**: At least 60 seconds
   - **VAD (Voice Activity Detection)**: Enabled
   - **VAD Threshold**: 0.5
   - **Silence Duration**: 500ms

5. **Optional: Knowledge Base**

If using dynamic knowledge base:
```
https://your-app.up.railway.app/knowledge-base
```

---

## Railway Deployment

### Choose Database Option

#### Option A: SQLite (Recommended for Demo)
- Data resets on each deployment
- No additional services needed
- Perfect for demos

#### Option B: PostgreSQL (Production)
- Persistent data across deployments
- Requires Railway PostgreSQL service
- Better for long-term use

### Deployment Steps

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Initialize project
railway init

# 4. (Optional) Add PostgreSQL
railway add postgresql

# 5. Set environment variables
railway variables set INFOBIP_API_KEY=your_key
railway variables set ELEVENLABS_API_KEY=your_key
railway variables set ELEVENLABS_AGENT_ID=your_agent_id
railway variables set MEDIA_STREAM_CONFIG_ID=your_config_id
railway variables set NODE_ENV=production

# 6. Deploy
railway up
```

### Get Your Railway URL

```bash
# Show your app URL
railway domain

# Example output: your-app.up.railway.app
```

### Update Configuration After Deployment

1. **Update WEBHOOK_BASE_URL**
```bash
railway variables set WEBHOOK_BASE_URL=https://your-app.up.railway.app
```

2. **Update Infobip Configuration**
   - Go to Infobip Portal
   - Update Media Stream Config WebSocket URL:
     ```
     wss://your-app.up.railway.app/websocket-voice
     ```
   - Update Voice Application webhook:
     ```
     https://your-app.up.railway.app/api/webhooks/calls/received
     ```

3. **Update ElevenLabs Knowledge Base** (if used)
   ```
   https://your-app.up.railway.app/knowledge-base
   ```

### Railway Environment Variables

Complete list of variables to set in Railway:

```bash
# Required API Keys
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_BASE_URL=https://api.infobip.com
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_agent_id
MEDIA_STREAM_CONFIG_ID=your_media_config_id

# Webhook URL (your Railway URL)
WEBHOOK_BASE_URL=https://your-app.up.railway.app

# Audio Keepalive Settings (for stable calls)
ELEVENLABS_CONTINUOUS_KEEPALIVE=true
ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000

# Auto-configured by Railway
NODE_ENV=production
PORT=$PORT
DATABASE_URL=$DATABASE_URL  # If using PostgreSQL
```

### Monitor Deployment

```bash
# Watch deployment logs
railway logs --follow

# Check deployment status
railway status

# View all environment variables
railway variables
```

---

## Testing & Verification

### Verify Configuration

Run the validation script to check your setup:

```bash
# Local testing
npm run validate-config

# On Railway
railway run npm run validate-config
```

### Test Complete Flow

#### 1. Register a Test User

Visit your deployment URL (Railway or ngrok):
```
https://your-app.up.railway.app
```

Fill out the registration form with:
- Your name
- Your phone number
- Company name
- Demo scenario preference

You should receive an SMS confirmation.

#### 2. Make a Test Call

1. Call your Infobip demo number: `+1 650 718 5356`
2. Wait for AI greeting (should be personalized with your name)
3. **Wait 5-10 seconds** after greeting
4. Try responding to the AI
5. Have a conversation about your account

#### 3. Watch Logs

```bash
# Railway logs
railway logs --follow

# Filter for relevant events
railway logs --follow | grep -E "(keepalive|TTS|audio|WebSocket)"
```

### Success Indicators ✅

- **Call duration > 30 seconds**
- You can respond to AI multiple times
- AI responds to your questions
- Logs show continuous keepalive activity
- No premature closure errors
- Normal close code (1000) when you hang up

---

## Troubleshooting

### Common Issues

#### Issue: "WebSocket connection failed"

**Causes:**
- Infobip Media Stream Config has wrong URL
- Using `ws://` instead of `wss://`
- WebSocket endpoint not accessible

**Solutions:**
1. Verify WebSocket URL in Infobip Portal
2. Ensure URL is `wss://your-domain/websocket-voice`
3. Test endpoint:
   ```bash
   curl -i -N \
     -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" \
     -H "Sec-WebSocket-Key: dGVzdA==" \
     https://your-app.up.railway.app/websocket-voice
   ```
   Expected: `HTTP/1.1 101 Switching Protocols`

#### Issue: "Call disconnects after 2 seconds"

**Causes:**
- Audio keepalive not configured
- Infobip timeout due to silence
- Audio format mismatch

**Solutions:**
1. Verify keepalive environment variables are set:
   ```bash
   ELEVENLABS_CONTINUOUS_KEEPALIVE=true
   ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
   ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
   ```
2. Check Infobip Media Stream settings (sample rate, format)
3. Review logs for "PREMATURE CLOSURE" messages

#### Issue: "User not found during call"

**Causes:**
- Phone number not registered
- Phone number format mismatch
- Database connection issue

**Solutions:**
1. Register via web form first
2. Verify phone number format matches
3. Check database logs:
   ```bash
   railway logs | grep "getUserByPhone"
   ```

#### Issue: "No audio during call"

**Causes:**
- Bidirectional streaming not enabled
- ElevenLabs agent not configured correctly
- Audio format mismatch

**Solutions:**
1. Verify Infobip Media Stream has bidirectional enabled
2. Check ElevenLabs agent audio settings (PCM 16000 Hz)
3. Verify ElevenLabs security settings allow overrides

#### Issue: "ElevenLabs API error"

**Causes:**
- Invalid API key
- Insufficient credits
- Rate limiting

**Solutions:**
1. Verify API key in Railway variables
2. Check ElevenLabs account credits/quota
3. Review ElevenLabs dashboard for errors

### Debug Commands

```bash
# Check configuration
npm run validate-config

# View Railway environment variables
railway variables

# View real-time logs
railway logs --follow

# Test database connection
railway run node -e "require('./src/database/DatabaseFactory').createDatabase().then(db => console.log('DB OK'))"

# Test WebSocket endpoint
wscat -c "wss://your-app.up.railway.app/websocket-voice"

# Test health endpoint
curl https://your-app.up.railway.app/api/health
```

### Get Help

If issues persist, gather this information:

1. **Call timing:** How many seconds before disconnect?
2. **Railway logs:** Full output from a test call
3. **Infobip call ID:** From Infobip Portal call logs
4. **Close code:** From WebSocket closure logs
5. **Screenshots:**
   - Infobip Media Stream Config
   - ElevenLabs Agent Settings
   - Railway Environment Variables

---

## Quick Reference

### Important URLs

- **Infobip Portal:** https://portal.infobip.com
- **ElevenLabs Dashboard:** https://elevenlabs.io/conversational-ai
- **Railway Dashboard:** https://railway.app

### Key Endpoints

- **Web Registration:** `https://your-app/`
- **Health Check:** `https://your-app/api/health`
- **Knowledge Base:** `https://your-app/knowledge-base`
- **Webhook:** `https://your-app/api/webhooks/calls/received`
- **WebSocket:** `wss://your-app/websocket-voice`

### Essential Commands

```bash
# Deploy to Railway
git push origin main  # Auto-deploys
railway up            # Manual deploy

# View logs
railway logs --follow

# Update environment variable
railway variables set KEY=value

# Test locally with ngrok
ngrok http 3500

# Run database migration
npm run migrate:up
```

---

## Demo Day Checklist

Before your presentation:

- [ ] Deploy to Railway and verify health endpoint
- [ ] Update webhook URLs in Infobip Portal
- [ ] Update WebSocket URL in Media Stream Config
- [ ] Update knowledge base URL in ElevenLabs (if used)
- [ ] Test registration flow (web form → SMS)
- [ ] Test voice flow (call → AI conversation)
- [ ] Verify all Railway environment variables are set
- [ ] Check Railway logs for errors
- [ ] Register test users with various scenarios
- [ ] Have backup plan (local development with ngrok)

**Your app is ready! 🚀**
