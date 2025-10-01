# Infobip Media Stream Configuration Checklist

## Critical Settings to Verify

Before deploying, verify these settings in your Infobip Portal to ensure proper audio streaming.

---

## 1. Media Stream Configuration

**Location:** Infobip Portal → Voice & Video → Media Stream Configurations

**Your Config ID:** `68d559f2b1e1103933e2536b`

### Required Settings

| Setting | Required Value | Why |
|---------|---------------|-----|
| **Audio Format** | `LINEAR16` or `PCM` | Must match what WebSocket proxy expects |
| **Sample Rate** | `16000` Hz | Standard for voice, matches ElevenLabs |
| **Bit Depth** | `16-bit` | CD-quality audio |
| **Channels** | `1` (mono) | Voice calls are mono |
| **Byte Order** | Little Endian | Standard PCM format |
| **Enable Bidirectional** | `Yes` | Critical for two-way audio |

### WebSocket URL Settings

| Setting | Value | Notes |
|---------|-------|-------|
| **Protocol** | `wss://` (secure) | Required for production |
| **Domain** | Your Railway URL | e.g., `victorious-friendship-production-39d6.up.railway.app` |
| **Path** | `/websocket-voice` | Must match server configuration |
| **Full URL** | `wss://your-railway-url/websocket-voice` | Complete WebSocket endpoint |

**Example:**
```
wss://victorious-friendship-production-39d6.up.railway.app/websocket-voice
```

---

## 2. Voice Application Configuration

**Location:** Infobip Portal → Voice & Video → Applications

### Check These Settings

- [ ] Application ID matches `INFOBIP_APPLICATION_ID` in Railway
- [ ] Media Stream Config ID set to: `68d559f2b1e1103933e2536b`
- [ ] Webhook URL points to: `https://your-railway-url/api/voice/webhook`
- [ ] Application is active and enabled

---

## 3. ElevenLabs Agent Configuration

**Location:** ElevenLabs Dashboard → Conversational AI

### Audio Settings

| Setting | Required Value | Why |
|---------|---------------|-----|
| **Input Audio Format** | PCM 16000 Hz | Matches Infobip output |
| **Output Audio Format** | PCM 16000 Hz | Matches Infobip input |
| **Input Mode** | Streaming | For real-time conversation |

### Agent Settings

- [ ] Agent ID matches `ELEVENLABS_AGENT_ID` in Railway
- [ ] Knowledge base URL set (if using): `https://your-railway-url/knowledge-base`
- [ ] Dynamic variables enabled in Security settings
- [ ] First message override enabled in Security settings
- [ ] Conversation timeout set to at least 60 seconds

---

## 4. Railway Environment Variables

**Location:** Railway Dashboard → Your Project → Variables

### Required Variables

```bash
# Infobip Configuration
INFOBIP_API_KEY=your_api_key
INFOBIP_BASE_URL=https://api.infobip.com
MEDIA_STREAM_CONFIG_ID=68d559f2b1e1103933e2536b
WEBHOOK_BASE_URL=https://your-railway-url

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_AGENT_ID=your_agent_id

# Keepalive Settings (NEW)
ELEVENLABS_CONTINUOUS_KEEPALIVE=true
ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
ELEVENLABS_DETAILED_TIMING=true

# Other Settings
NODE_ENV=production
PORT=$PORT  # Railway auto-sets this
DATABASE_URL=$DATABASE_URL  # Railway auto-sets this
```

---

## 5. Quick Verification Steps

### Step 1: Check Media Stream Config in Infobip Portal

1. Log into Infobip Portal
2. Go to **Voice & Video → Media Stream Configurations**
3. Find config ID: `68d559f2b1e1103933e2536b`
4. Click to view details
5. Verify ALL settings match the table above

### Step 2: Test WebSocket Endpoint

```bash
# Test that your WebSocket endpoint is reachable
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  https://your-railway-url/websocket-voice
```

**Expected Response:**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

### Step 3: Verify Railway Deployment

```bash
# Check if server is running
curl https://your-railway-url/api/health

# Should return:
{
  "status": "ok",
  "timestamp": "2025-01-25T...",
  "services": {
    "database": "connected",
    "voice": "configured"
  }
}
```

### Step 4: Check Railway Logs

```bash
railway logs --follow
```

**Look for:**
```
🔌 WebSocket Proxy attached to main server at /websocket-voice
📡 Ready to bridge Infobip ↔ ElevenLabs audio streams
```

---

## 6. Common Configuration Mistakes

### ❌ Wrong Sample Rate
**Problem:** Media stream config set to 8000 Hz or 22050 Hz  
**Fix:** Must be exactly **16000 Hz**

### ❌ Wrong WebSocket URL
**Problem:** Using `ws://` instead of `wss://`  
**Fix:** Production must use **`wss://`** (secure)

### ❌ Wrong Path
**Problem:** WebSocket URL set to `/ws-proxy` or `/ws`  
**Fix:** Must be **`/websocket-voice`** to match server

### ❌ Bidirectional Not Enabled
**Problem:** Only receiving audio from user, not sending AI responses  
**Fix:** Enable **bidirectional streaming** in media stream config

### ❌ Wrong Audio Format
**Problem:** Using `OPUS`, `G711`, or other codec  
**Fix:** Must be **`LINEAR16`** or **`PCM`**

### ❌ Environment Variables Not Set
**Problem:** New keepalive variables not in Railway  
**Fix:** Add all variables from section 4 above

---

## 7. Testing Checklist

Before making a test call, verify:

- [ ] All Infobip settings match section 1
- [ ] WebSocket URL is correct and reachable
- [ ] ElevenLabs agent configured with correct audio format
- [ ] All Railway environment variables set
- [ ] Railway logs show WebSocket server started
- [ ] Health endpoint returns 200 OK

---

## 8. What to Check If Still Failing

### In Infobip Portal:

1. **Call Logs:**
   - Go to Voice & Video → Call Logs
   - Find your test call
   - Check status and error messages
   - Look for "media stream" related errors

2. **Dialog Logs:**
   - Check if dialog was created
   - Verify dialog connected to WebSocket
   - Look for early termination reasons

### In Railway Logs:

```bash
railway logs --follow | grep -E "(PREMATURE|close|WebSocket|keepalive)"
```

**Look for:**
- Premature closure messages
- Close codes (should be 1000)
- Keepalive activity
- WebSocket connection status

### In ElevenLabs Dashboard:

1. **Conversation History:**
   - Check if conversation was initiated
   - Verify audio was received
   - Look for any error messages

2. **Agent Logs:**
   - Check for configuration issues
   - Verify API key is valid
   - Look for timeout or rate limit errors

---

## 9. Contact Information

If you've verified everything and calls still hang up:

### Information to Gather:

1. **Exact timing:** How many seconds after TTS does call drop?
2. **Railway logs:** Full log output from a test call
3. **Infobip call ID:** From Infobip Portal call logs
4. **Close code and reason:** From WebSocket closure logs
5. **Premature closure diagnostics:** From Railway logs

### Screenshot Checklist:

- [ ] Infobip media stream configuration page
- [ ] Infobip voice application settings
- [ ] ElevenLabs agent audio settings
- [ ] Railway environment variables
- [ ] Railway logs showing premature closure

---

## 10. Quick Reference

### Railway Deploy Commands

```bash
# Commit changes
git add .
git commit -m "Add comprehensive keepalive and diagnostics"
git push origin main

# Railway will auto-deploy, or manually trigger:
railway up

# Watch logs during deployment
railway logs --follow
```

### Test Call Procedure

1. **Register a user** at your Railway URL
2. **Call the Infobip number** from registered phone
3. **Listen for AI greeting**
4. **Wait 5 seconds** after greeting ends
5. **Try to respond** to the AI
6. **Note when call drops**
7. **Check Railway logs immediately**

### Expected Success:

- ✅ Call lasts > 30 seconds
- ✅ You can respond multiple times
- ✅ AI responds to your questions
- ✅ Logs show continuous keepalive activity
- ✅ No premature closure errors

---

**Good luck!** 🚀 With these settings, your calls should stay connected for the full conversation.
