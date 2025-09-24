# API Key Request - Dynamic Fintech Demo 🎯

**For**: Team member managing API keys  
**Project**: Dynamic Fintech Demo for Dev Days NYC  
**Developer**: Chris Runnels  
**Date**: 2025-09-23

---

## 🚨 **URGENT REQUEST**

I need the following API keys to complete the Dynamic Fintech Demo setup. The infrastructure is ready and waiting for these credentials.

## 📋 **Required API Keys & Information**

### 1. **Infobip API Keys** ⭐ **HIGH PRIORITY**
```env
# Main API key for Voice and SMS
INFOBIP_API_KEY=________________________________

# SMS API key (often same as above)
INFOBIP_SMS_API_KEY=____________________________

# Application ID (will be created during setup)
INFOBIP_APPLICATION_ID=_________________________

# Media streaming config ID (will be created during setup)
MEDIA_STREAM_CONFIG_ID=_________________________
```

**Where to find these**:
- Login to [Infobip Portal](https://portal.infobip.com)
- API Keys: **Developers** → **API Keys**
- Application ID: **Voice & Video** → **Applications** (create if needed)

### 2. **ElevenLabs API Keys** ⭐ **HIGH PRIORITY**
```env
# Main API key
ELEVENLABS_API_KEY=_____________________________

# Agent ID (will be created during setup)
ELEVENLABS_AGENT_ID=____________________________

# Preferred voice ID (optional)
ELEVENLABS_VOICE_ID=____________________________
```

**Where to find these**:
- Login to [ElevenLabs](https://elevenlabs.io)
- API Key: Profile → **Profile & API Key**
- Agent ID: Will be created in **Conversational AI** section

### 3. **Demo Phone Number** 📞
```env
# US phone number from Infobip for demo calls
DEMO_CALL_NUMBER=+1_____________________________
```

**Where to find this**:
- Infobip Portal → **Numbers** → **My Numbers**
- Need a US number for the demo

---

## 🛠️ **What I'll Do Once I Have These**

1. **Update Environment**: Add keys to `.env` file
2. **Configure Services**: Set up Voice Application and ElevenLabs Agent
3. **Test Integration**: Validate API connections
4. **Deploy Webhooks**: Configure ngrok for Infobip callbacks
5. **End-to-End Test**: Complete voice demo flow

---

## ⚡ **Quick Setup Instructions (For Key Manager)**

If you want to help with the initial configuration:

### Infobip Setup:
1. **Create Voice Application**:
   - Go to **Voice & Video** → **Applications**
   - Create new application named "Dynamic Fintech Demo"
   - Set webhook URL to: `https://[NGROK_URL]/api/voice/webhook`

2. **Configure Media Streaming**:
   - In the Voice Application, set up Media Streaming
   - WebSocket URL: `wss://[NGROK_URL]/ws-proxy`
   - Audio format: LINEAR16 (16kHz, mono)

### ElevenLabs Setup:
1. **Create Conversational Agent**:
   - Go to **Conversational AI**
   - Create agent: "Infobip Capital Banking Assistant"
   - Set prompt: "You are a helpful banking assistant for Infobip Capital..."

---

## 🔍 **Validation Commands**

Once you provide the keys, I can immediately test:

```bash
# Check configuration status
npm run validate-config

# Test API connections
npm run dev:all

# Validate phone number processing
npm run test-phones
```

---

## 📞 **Contact Info**

- **Developer**: Chris Runnels
- **Project Repo**: `/Users/crunnels/dynamic-fintech-demo`
- **Demo Date**: Dev Days NYC (upcoming)

---

## 🎯 **Priority Level**

**🔥 URGENT** - Need these keys to:
- Complete demo setup
- Test voice integration
- Prepare for Dev Days NYC presentation

**Minimum Viable**: Just the API keys (I can handle the application setup)  
**Ideal**: API keys + Application IDs if you can set those up

---

## 📋 **Checklist for Key Manager**

- [ ] Provide Infobip API key
- [ ] Provide Infobip SMS API key (if different)
- [ ] Provide ElevenLabs API key
- [ ] Provide or help obtain US demo phone number
- [ ] (Optional) Set up Infobip Voice Application
- [ ] (Optional) Set up ElevenLabs Conversational Agent

---

**Thank you!** Once I have these, the demo will be ready for testing within minutes. 🚀