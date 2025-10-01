# Deployment Steps - Audio Keepalive Fix

## Overview

This deployment implements comprehensive audio keepalive to prevent premature call hangups. Follow these steps to deploy and test.

---

## Step 1: Push Changes to Railway

```bash
# Push to origin (Railway will auto-deploy)
git push origin main
```

**Expected:** Railway automatically detects the push and starts building.

---

## Step 2: Set Environment Variables in Railway

While Railway is building, add the new environment variables:

### Option A: Using Railway CLI

```bash
railway variables set ELEVENLABS_CONTINUOUS_KEEPALIVE=true
railway variables set ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
railway variables set ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
railway variables set ELEVENLABS_DETAILED_TIMING=true
```

### Option B: Using Railway Dashboard

1. Go to https://railway.app
2. Select your project
3. Click **Variables** tab
4. Add these variables:

| Variable | Value |
|----------|-------|
| `ELEVENLABS_CONTINUOUS_KEEPALIVE` | `true` |
| `ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS` | `20` |
| `ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS` | `30000` |
| `ELEVENLABS_DETAILED_TIMING` | `true` |

5. Click **Deploy** (if not auto-deploying)

---

## Step 3: Monitor Deployment

```bash
# Watch deployment logs
railway logs --follow
```

**Look for these success messages:**
```
✅ Database initialized successfully
🔌 WebSocket Proxy attached to main server at /websocket-voice
📡 Ready to bridge Infobip ↔ ElevenLabs audio streams
🎯 Ready for Dev Days NYC demo!
```

---

## Step 4: Verify Infobip Configuration

**CRITICAL:** Before testing, verify your Infobip media stream configuration.

See **INFOBIP_CONFIG_CHECKLIST.md** for detailed steps.

### Quick Check:

1. Log into Infobip Portal
2. Go to **Voice & Video → Media Stream Configurations**
3. Find config: `68d559f2b1e1103933e2536b`
4. Verify:
   - ✅ Audio Format: `LINEAR16` or `PCM`
   - ✅ Sample Rate: `16000` Hz
   - ✅ Bidirectional: Enabled
   - ✅ WebSocket URL: `wss://your-railway-url/websocket-voice`

---

## Step 5: Test with a Call

### Register a Test User

```bash
# Get your Railway URL
railway domain

# Visit in browser
open https://your-railway-url
```

Fill out the registration form with your phone number.

### Make Test Call

1. Call the Infobip number: **+1 650 718 5356**
2. Wait for AI greeting
3. **WAIT 5-10 seconds** after greeting ends
4. Try to respond to the AI
5. Have a conversation

### Watch Logs During Call

```bash
railway logs --follow | grep -E "(keepalive|TTS|PREMATURE|audio|close)"
```

**Look for:**
- ✅ `🔄 Starting continuous background keepalive`
- ✅ `🎵 TTS audio received`
- ✅ `📤 Sent XXX bytes of TTS audio to Infobip`
- ✅ `🔄 Background keepalive: sent X silence frames`
- ✅ `🎤 User audio received`

**Avoid seeing:**
- ❌ `🚨 PREMATURE CLOSURE`
- ❌ Close codes other than 1000

---

## Step 6: Evaluate Results

### Success Indicators ✅

- **Call duration > 30 seconds**
- You can respond to AI multiple times
- AI responds to your questions
- Logs show continuous keepalive activity
- No premature closure errors
- Normal close code (1000) when you hang up

### If Still Failing ❌

**Capture this information:**

1. **Call duration** (from logs)
2. **Close code and reason** (from logs)
3. **Time since last TTS** (from premature closure diagnostic)
4. **Silence frames sent** (from diagnostic)
5. **Full Railway log output** (from call start to end)

**Then check:**

```bash
# Get full diagnostic info from logs
railway logs | grep -A 5 "PREMATURE CLOSURE"
```

---

## Step 7: Fine-Tune If Needed

### If Calls Last Longer But Still Drop Early:

Increase keepalive duration:

```bash
railway variables set ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=60000  # 60 seconds
```

### If Too Many Logs:

Reduce logging verbosity:

```bash
railway variables set ELEVENLABS_DETAILED_TIMING=false
railway variables set ELEVENLABS_AUDIO_LOG_INTERVAL_MS=5000
```

### If High CPU Usage:

Reduce keepalive frequency:

```bash
railway variables set ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=50  # 50ms instead of 20ms
```

---

## Step 8: Verify Other Configuration (If Still Failing)

If calls still hang up after these changes, the problem may be with external configuration:

### Check ElevenLabs Agent Settings

1. Go to ElevenLabs Dashboard
2. Find your agent
3. Verify:
   - Input audio format: PCM 16000 Hz
   - Output audio format: PCM 16000 Hz
   - Conversation timeout: At least 60 seconds
   - Security settings: Dynamic variables enabled

### Check Infobip Voice Application

1. Go to Infobip Portal → Voice & Video → Applications
2. Find your application
3. Verify:
   - Media Stream Config ID: `68d559f2b1e1103933e2536b`
   - Webhook URL: `https://your-railway-url/api/voice/webhook`
   - Application is active

### Test WebSocket Connectivity

```bash
# Test WebSocket endpoint is reachable
wscat -c "wss://your-railway-url/websocket-voice"

# Or use curl
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  https://your-railway-url/websocket-voice
```

**Expected:** `101 Switching Protocols`

---

## Summary of Changes

### What Was Changed:

1. **Continuous background keepalive** - Sends silence every 20ms when AI not speaking
2. **Aggressive post-TTS keepalive** - 20ms intervals for 30 seconds after TTS
3. **WebSocket ping/pong** - Keeps connection alive every 5 seconds
4. **Enhanced diagnostics** - Tracks all audio flow with detailed timing
5. **Premature closure detection** - Logs full context when call drops early

### Why This Should Work:

Infobip's media stream expects **continuous audio flow**. Without it, Infobip assumes the stream is broken and terminates the call. The new keepalive logic ensures:

- Audio is sent every 20ms (standard for 16 kHz PCM)
- No gaps longer than 100ms
- Stream continues even when AI isn't speaking
- WebSocket stays healthy with ping/pong

---

## Rollback Plan (If Needed)

If the new changes cause issues:

```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Railway will auto-deploy the previous version
```

---

## Support Documentation

- **PROBLEM_ANALYSIS.md** - Comprehensive root cause analysis
- **KEEPALIVE_CONFIG.md** - Detailed configuration guide
- **INFOBIP_CONFIG_CHECKLIST.md** - Settings verification checklist

---

## Expected Timeline

1. **Push changes:** 1 minute
2. **Railway build:** 2-3 minutes
3. **Set environment variables:** 1 minute
4. **Test call:** 2 minutes
5. **Total:** ~10 minutes

---

**Next Action:** Push to Railway and follow steps above! 🚀

```bash
git push origin main
```
