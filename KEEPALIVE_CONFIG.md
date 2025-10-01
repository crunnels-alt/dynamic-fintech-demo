# Audio Keepalive Configuration Guide

## Overview

The WebSocket proxy now includes comprehensive audio keepalive and diagnostic features to prevent premature call hangups on the Infobip media stream.

## New Features Implemented

### 1. **Continuous Background Keepalive** 🔄
Sends silence frames continuously whenever the AI agent is not speaking, ensuring Infobip always receives audio data.

### 2. **Aggressive Keepalive Settings** ⚡
- Default interval: **20ms** (from 200ms)
- Default duration: **30 seconds** (from 2 seconds)
- Starts immediately after TTS ends (no delay)

### 3. **WebSocket Health Monitoring** 💓
- Ping/pong every 5 seconds
- Automatic connection health checks

### 4. **Enhanced Diagnostics** 📊
- Detailed timing logs for audio flow
- Tracks gaps between TTS and user audio
- Counts frames sent (both TTS and silence)
- Detects premature closures with full context

## Environment Variables

All features are configurable via environment variables:

### Keepalive Settings

```bash
# Enable/disable continuous background keepalive (default: true)
ELEVENLABS_CONTINUOUS_KEEPALIVE=true

# Enable/disable TTS-triggered keepalive (default: true)
ELEVENLABS_TTS_KEEPALIVE=true

# Keepalive interval in milliseconds (default: 20ms)
ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20

# How long to send keepalive after TTS stops (default: 30000ms = 30 seconds)
ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000

# Size of each silence frame in milliseconds (default: 20ms)
ELEVENLABS_TTS_KEEPALIVE_FRAME_MS=20
```

### Diagnostic Settings

```bash
# Enable detailed timing logs (default: true)
ELEVENLABS_DETAILED_TIMING=true

# Enable audio flow logging (default: true)
ELEVENLABS_AUDIO_LOGGING=true

# How often to log audio stats in milliseconds (default: 1000ms)
ELEVENLABS_AUDIO_LOG_INTERVAL_MS=1000
```

### Existing Settings (Still Available)

```bash
# Idle commit timeout for user audio (default: 500ms)
ELEVENLABS_IDLE_COMMIT_MS=500

# Auto-create response after commit (default: true)
ELEVENLABS_AUTO_RESPONSE_CREATE=true

# Commit audio on silence detection (default: true)
ELEVENLABS_COMMIT_ON_SILENCE=true

# Resample TTS to 16kHz if needed (default: true)
ELEVENLABS_TTS_RESAMPLE_TO_16K=true
```

## How It Works

### Flow Diagram

```
Infobip Call Starts
    ↓
WebSocket Connection Established
    ↓
[CONTINUOUS BACKGROUND KEEPALIVE STARTS]
    ↓ (every 20ms)
Sending silence frames to Infobip
    ↓
AI Agent Speaks (TTS)
    ↓ (TTS audio forwarded)
User hears greeting
    ↓
[TTS KEEPALIVE TAKES OVER]
    ↓ (every 20ms for 30 seconds)
Sending silence frames
    ↓
User Responds (speaks)
    ↓ (user audio forwarded to ElevenLabs)
AI responds again
    ↓
[CYCLE CONTINUES]
    ↓
Call continues indefinitely
```

### Technical Details

1. **Continuous Keepalive:**
   - Runs every 20ms from connection start
   - Only sends silence if >100ms since last TTS
   - Ensures Infobip always receives audio stream
   - Prevents "media stream inactive" timeout

2. **TTS Keepalive:**
   - Triggered whenever AI sends audio
   - Sends silence frames every 20ms
   - Continues for 30 seconds after TTS stops
   - Gives user time to think and respond

3. **Audio Frame Format:**
   - 16 kHz PCM, mono, 16-bit
   - 20ms frames = 640 bytes each
   - Little-endian byte order
   - Zero-filled silence (no noise)

## Log Output Examples

### Normal Operation
```
🔄 [conn_123] Starting continuous background keepalive (20ms interval)
🎵 [conn_123] TTS audio received at 1704123456789
📤 [conn_123] Sent 3200 bytes of TTS audio to Infobip (count: 1)
⏱️  [conn_123] TTS received, last TTS timestamp updated to 1704123456789
🔄 [conn_123] Background keepalive: sent 50 silence frames (1000ms since last TTS)
🎤 [conn_123] User audio received (640 bytes)
```

### Premature Closure Detection
```
🚨 [conn_123] PREMATURE CLOSURE after only 4.2s!
🚨 [conn_123] Time since last TTS: 3.8s
🚨 [conn_123] Time since last user audio: 4.1s
🚨 [conn_123] Total TTS sent: 12
🚨 [conn_123] Total silence frames sent: 187
```

## Testing Recommendations

### Test 1: Default Settings (Most Aggressive)
```bash
# Use all defaults - this should work for most cases
export ELEVENLABS_CONTINUOUS_KEEPALIVE=true
export ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
export ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
export ELEVENLABS_DETAILED_TIMING=true
```

### Test 2: Moderate Settings
```bash
# If default is too verbose or resource-intensive
export ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=50
export ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=20000
export ELEVENLABS_DETAILED_TIMING=false
```

### Test 3: Continuous Only
```bash
# Rely only on continuous background keepalive
export ELEVENLABS_CONTINUOUS_KEEPALIVE=true
export ELEVENLABS_TTS_KEEPALIVE=false
```

### Test 4: Minimal Logging
```bash
# Reduce log verbosity for production
export ELEVENLABS_DETAILED_TIMING=false
export ELEVENLABS_AUDIO_LOGGING=false
export ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
export ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
```

## Railway Deployment

### Set Variables in Railway

```bash
railway variables set ELEVENLABS_CONTINUOUS_KEEPALIVE=true
railway variables set ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
railway variables set ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
railway variables set ELEVENLABS_DETAILED_TIMING=true
```

### Or Use Railway Dashboard

1. Go to your project on Railway
2. Click on "Variables" tab
3. Add each variable with its value
4. Click "Deploy" to apply changes

## Monitoring During Calls

### What to Look For

✅ **Good Signs:**
- Background keepalive messages every ~1 second
- TTS audio forwarded successfully
- User audio received regularly
- Call duration > 10 seconds

⚠️ **Warning Signs:**
- "Premature closure" errors
- Large gaps (>5 seconds) since last TTS
- WebSocket close codes other than 1000
- No user audio received after TTS

### Railway Logs Command

```bash
railway logs --follow | grep -E "(keepalive|TTS|PREMATURE|audio|close)"
```

### Key Metrics to Track

1. **Call Duration:** Should be > 10 seconds minimum
2. **Silence Frame Count:** Should be continuously increasing
3. **TTS Count:** Should match number of AI responses
4. **Close Code:** Should be 1000 (normal closure)
5. **Time Since Last TTS:** Should never exceed ~30 seconds if user is active

## Troubleshooting

### Issue: Still Hanging Up Early

**Check:**
1. Infobip media stream config sample rate (must be 16000 Hz)
2. WebSocket URL in Infobip Portal (must match Railway URL)
3. Railway logs for actual close reason
4. Try increasing keepalive duration to 60000ms

### Issue: Too Many Logs

**Solution:**
```bash
export ELEVENLABS_DETAILED_TIMING=false
export ELEVENLABS_AUDIO_LOG_INTERVAL_MS=5000
```

### Issue: High CPU Usage

**Solution:**
```bash
# Reduce keepalive frequency
export ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=50
# Or disable continuous keepalive
export ELEVENLABS_CONTINUOUS_KEEPALIVE=false
```

### Issue: Audio Quality Issues

**Check:**
1. Resampling enabled: `ELEVENLABS_TTS_RESAMPLE_TO_16K=true`
2. ElevenLabs agent audio output format (should be PCM 16kHz)
3. Infobip media stream config audio format (LINEAR16)

## Best Practices

1. **Start with defaults** - Most aggressive, highest success rate
2. **Enable detailed timing** during testing - Disable in production
3. **Monitor first 10 calls closely** - Look for patterns
4. **Adjust based on logs** - If premature closure still occurs, increase duration
5. **Check Infobip Portal** - Verify media stream configuration matches expectations

## Expected Results

With these settings, you should see:

✅ Calls lasting > 30 seconds consistently  
✅ User able to respond to AI multiple times  
✅ No "media stream inactive" errors  
✅ Normal WebSocket close codes (1000)  
✅ Smooth conversation flow

## Next Steps After Deployment

1. **Make a test call**
2. **Watch Railway logs** in real-time
3. **Note the call duration** when it hangs up
4. **Check the premature closure diagnostics**
5. **Adjust settings** based on what you see

If calls still hang up early after these changes, capture the full log output and check:
- Exact close code and reason from Infobip
- Time since last TTS when call drops
- Whether any user audio was received
- Infobip Portal call logs for additional details
