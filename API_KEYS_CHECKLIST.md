# API Keys Collection Checklist 🔑

Complete this checklist to gather all required API keys for your Dynamic Fintech Demo.

## 📋 Infobip Setup

### 1. Infobip Portal Access
- [ ] Log into [Infobip Portal](https://portal.infobip.com)
- [ ] Verify you have access to Voice & SMS services

### 2. Get Infobip API Key
- [ ] Navigate to **Developers** → **API Keys**
- [ ] Copy your existing API key OR create a new one
- [ ] Permissions needed: Voice API, SMS API
- [ ] **API Key**: `_________________________`

### 3. Get Infobip Phone Number
- [ ] Go to **Numbers** → **My Numbers**
- [ ] Note an available US number OR purchase one
- [ ] **Demo Number**: `+1___________________`

---

## 🤖 ElevenLabs Setup

### 1. ElevenLabs Account
- [ ] Sign up/login at [ElevenLabs](https://elevenlabs.io)
- [ ] Verify you have available credits for API usage

### 2. Get ElevenLabs API Key
- [ ] Go to your profile (top right) → **Profile & API Key**
- [ ] Copy your API key
- [ ] **API Key**: `_________________________`

### 3. Choose a Voice (Optional)
Popular professional voices for banking:
- [ ] **Rachel** (clear, professional female voice)
- [ ] **Adam** (clear, professional male voice) 
- [ ] **Bella** (friendly, approachable female voice)
- [ ] **Josh** (calm, trustworthy male voice)

**Selected Voice ID**: `_________________________`

---

## ⚡ Quick Setup Commands

Once you have your API keys, update your `.env` file:

```bash
# Edit your environment file
nano .env

# Or use VS Code
code .env
```

Update these lines with your actual values:
```env
INFOBIP_API_KEY=your_actual_infobip_api_key_here
INFOBIP_SMS_API_KEY=your_actual_infobip_api_key_here  # Usually same as above
ELEVENLABS_API_KEY=your_actual_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_chosen_voice_id_here         # Optional
DEMO_CALL_NUMBER=+1XXXXXXXXXX                        # Your Infobip number
```

Then validate your setup:
```bash
npm run validate-config
```

---

## 🎯 Priority Order

If you want to test components incrementally:

1. **First Priority**: Get Infobip SMS API key
   - Enables web registration with SMS confirmations
   - Test command: `npm run dev` → test registration form

2. **Second Priority**: Get ElevenLabs API key
   - Enables AI voice responses (without phone calls)
   - Test WebSocket proxy connectivity

3. **Final Step**: Complete Infobip Voice setup
   - Enables full voice calling experience
   - Requires webhook configuration

---

## 📞 Account Requirements

### Infobip Account Needs:
- SMS API access (for registration confirmations)
- Voice API access (for inbound calls)
- US phone number (for demo calls)
- Webhook endpoint capability

### ElevenLabs Account Needs:
- API access with available credits
- Conversational AI feature access
- Real-time audio streaming capability

---

## 🆘 Getting Help

**Infobip Support**:
- Documentation: https://www.infobip.com/docs
- Support portal within your Infobip account
- Community: https://community.infobip.com

**ElevenLabs Support**:
- Documentation: https://docs.elevenlabs.io
- Discord community
- Support email through their platform

---

## ✅ Ready to Proceed?

Once you've collected your API keys:

1. Update your `.env` file with the actual values
2. Run `npm run validate-config` to verify setup
3. Follow the `VOICE_SETUP_GUIDE.md` for advanced configuration
4. Test with `npm run dev:all`

**Next Steps After API Keys**: Configure Infobip Voice Application and ElevenLabs Conversational Agent using the detailed guide.