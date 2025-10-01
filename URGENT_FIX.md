# 🚨 URGENT FIX: Infobip WebSocket Configuration Issue

## The Problem

Your calls are hanging up after **0.8 seconds** with WebSocket close code **1006** (Abnormal Closure).

**This is NOT an audio keepalive problem.** The keepalive is working perfectly (50 silence frames sent).

**This IS an Infobip configuration problem.** Infobip is forcibly closing the WebSocket connection because it can't properly connect or maintain the connection to your Railway server.

## Evidence from Logs

```
📞 [conn_xxx] Infobip WebSocket closed after 0.8s
📞 [conn_xxx] Close code: 1006, reason: 
🚨 PREMATURE CLOSURE after only 0.8s!
🚨 Total TTS sent: 3
🚨 Total silence frames sent: 51    ← KEEPALIVE IS WORKING!
```

The fact that 51 silence frames were sent means audio is flowing correctly. Infobip is closing for a different reason.

## Root Cause

**Infobip Media Stream Configuration has the wrong WebSocket URL.**

Close code 1006 typically means:
1. WebSocket endpoint URL is incorrect
2. TLS/SSL certificate problem  
3. Network/routing issue
4. Infobip can't reach your server
5. WebSocket handshake is failing

## The Fix

You need to **verify and update** your Infobip Media Stream Configuration.

### Step 1: Log into Infobip Portal

Go to: **Voice & Video → Media Stream Configurations**

Find your config: `68d559f2b1e1103933e2536b`

### Step 2: Verify WebSocket URL

**Current Railway URL:** `https://victorious-friendship-production-39d6.up.railway.app`

**Your WebSocket URL in Infobip MUST be:**
```
wss://victorious-friendship-production-39d6.up.railway.app/websocket-voice
```

**Common mistakes:**
- ❌ `ws://` instead of `wss://` (must be secure)
- ❌ `/ws-proxy` instead of `/websocket-voice`
- ❌ Missing the path entirely
- ❌ Old/wrong Railway domain

### Step 3: Verify Other Settings

While you're in the Media Stream Configuration, verify:

| Setting | Required Value |
|---------|---------------|
| **Audio Format** | `LINEAR16` or `PCM` |
| **Sample Rate** | `16000` Hz |
| **Bit Depth** | `16-bit` |
| **Channels** | `1` (mono) |
| **Bidirectional** | `Yes` (enabled) |
| **WebSocket URL** | `wss://victorious-friendship-production-39d6.up.railway.app/websocket-voice` |

### Step 4: Test WebSocket Connectivity

After updating, test that your WebSocket endpoint is reachable:

```bash
# Test WebSocket handshake
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://victorious-friendship-production-39d6.up.railway.app/websocket-voice
```

**Expected response:**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

If you get anything else (404, 502, etc.), your server isn't accepting WebSocket connections properly.

## Alternative Possibilities

If the WebSocket URL is correct, the problem might be:

### Possibility 1: Railway WebSocket Timeout

Railway might have a very short WebSocket timeout. Try adding these to your Railway environment:

```bash
railway variables set RAILWAY_WEBSOCKET_TIMEOUT=3600
```

### Possibility 2: Infobip Can't Reach Railway

Test if Infobip can actually connect:

1. Go to https://www.websocket.org/echo.html
2. Try to connect to: `wss://victorious-friendship-production-39d6.up.railway.app/websocket-voice`
3. See if connection succeeds

### Possibility 3: TLS Certificate Issue

Railway's auto-generated SSL might not be trusted by Infobip. Check:

```bash
# Test SSL certificate
openssl s_client -connect victorious-friendship-production-39d6.up.railway.app:443 -showcerts
```

Look for certificate errors.

### Possibility 4: Wrong Media Stream Config ID

Double-check that your dialog is using the correct config ID:

In `callsHandler.js` line 198:
```javascript
websocketEndpointConfigId: this.mediaStreamConfigId
```

Verify `MEDIA_STREAM_CONFIG_ID` environment variable in Railway matches: `68d559f2b1e1103933e2536b`

## What to Check in Infobip Portal

### Voice Application Settings

Go to: **Voice & Video → Applications**

Find your application and verify:
- ✅ Media Stream Config ID = `68d559f2b1e1103933e2536b`
- ✅ Application is **Active**
- ✅ Webhook URL points to Railway

### Call Logs

Go to: **Voice & Video → Call Logs**

Find one of your recent calls and check:
- Dialog status
- WebSocket connection attempts
- Any error messages from Infobip side

Look for clues like "WebSocket connection failed" or "TLS handshake failed"

## Debug Steps

### 1. Check Railway Logs During Connection

Watch logs while making a call:

```bash
railway logs --follow | grep -i "websocket"
```

Look for:
- WebSocket connection attempts
- Any errors before close code 1006
- TLS/handshake errors

### 2. Enable Detailed WebSocket Logging

The server already has detailed logging. Check if you see:
```
🔌 New WebSocket connection conn_xxx from Infobip
```

If you DON'T see this, Infobip never successfully connected.

### 3. Test with wscat

Install wscat and test manually:

```bash
npm install -g wscat
wscat -c "wss://victorious-friendship-production-39d6.up.railway.app/websocket-voice"
```

If this fails, your WebSocket endpoint isn't working.

## Most Likely Solution

**99% chance the problem is:**

Your Infobip Media Stream Configuration has the wrong WebSocket URL. It's probably:
- Using an old Railway domain
- Missing the `/websocket-voice` path
- Using `ws://` instead of `wss://`

**Fix this in Infobip Portal and your calls will work immediately.**

## After Fixing

Once you update the WebSocket URL in Infobip:

1. Save the configuration
2. Wait 1-2 minutes for propagation
3. Make a new test call
4. It should work!

You'll know it's fixed when:
- ✅ Call lasts longer than 0.8 seconds
- ✅ No 1006 close code
- ✅ User can respond to AI
- ✅ Call ends normally (code 1000) when user hangs up

## Summary

**Stop worrying about keepalive - it's working fine.**

**Fix your Infobip Media Stream Configuration WebSocket URL.**

That's the only problem.
