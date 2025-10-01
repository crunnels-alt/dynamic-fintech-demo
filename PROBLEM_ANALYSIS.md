# Problem Analysis: Premature Call Hangup After AI Response

**Date:** January 2025  
**System:** Infobip Voice API ↔ WebSocket Proxy ↔ ElevenLabs Conversational AI  
**Issue:** Calls hang up almost immediately after AI agent speaks (within ~3-5 seconds)

---

## 📊 Current Architecture

```
User Phone Call 
    ↓
Infobip Voice API (+1 650 718 5356)
    ↓ (webhook)
callsHandler.js → Creates dialog with media streaming
    ↓
Infobip Media Stream WebSocket (16 kHz PCM audio)
    ↓ (binary audio frames)
websocketProxy.js (port 3500, path: /websocket-voice)
    ↓ (ElevenLabs signed URL + WebSocket)
ElevenLabs Conversational AI Agent
    ↓ (TTS audio back)
websocketProxy.js → forwards to Infobip
    ↓
User hears AI response → CALL DROPS
```

---

## 🔍 The Problem

**Symptom:** Call disconnects 3-5 seconds after the AI agent finishes speaking

**Observable Behavior:**
1. ✅ User calls the number successfully
2. ✅ Infobip webhook triggers, user identified from database
3. ✅ Dialog created with media streaming config
4. ✅ WebSocket proxy establishes connection to Infobip
5. ✅ ElevenLabs WebSocket connection established
6. ✅ Conversation initiation data sent with dynamic variables
7. ✅ AI agent greets user with personalized message
8. ✅ User hears the greeting audio
9. ❌ **Call drops immediately after AI finishes speaking**
10. ❌ User cannot respond or continue conversation

---

## 🧩 Possible Root Causes

### 1. **Audio Streaming Continuity Issues** ⭐ MOST LIKELY

**Problem:** Infobip's media stream expects continuous audio flow on the WebSocket connection. When the AI stops speaking, if no audio is sent for a period, Infobip may interpret this as "call ended" or "media stream inactive" and terminate the dialog.

**Evidence:**
- Your keepalive implementation exists but may not be aggressive enough
- Current config: 200ms interval, 2s total duration
- Infobip may expect audio every 20ms (standard for 16 kHz PCM with 20ms frame size)

**Technical Details:**
- 16 kHz PCM audio = 16,000 samples/second
- Standard frame size = 20ms = 320 samples = 640 bytes (16-bit PCM)
- If Infobip doesn't receive audio for 50-100ms, it may consider stream broken

**Your Current Code (websocketProxy.js:396-423):**
```javascript
// Current keepalive settings
ttsKeepaliveTotalMs: 2000,          // Only 2 seconds
ttsKeepaliveIntervalMs: 200,        // Send every 200ms (too slow!)
ttsKeepaliveFrameMs: 20,            // 20ms frames (correct)
```

**Problem:** 
- 200ms gap between silence frames is too large
- 2 second total duration too short if user takes time to respond
- Keepalive only starts AFTER TTS, but gap between TTS ending and keepalive starting may be too large

---

### 2. **Dialog maxDuration vs Inactivity Timeout**

**Your Current Code (callsHandler.js:193):**
```javascript
maxDuration: 3600,  // 1 hour max
```

**Problem:** While you set maxDuration to 3600 seconds, Infobip may have separate inactivity timeouts:
- **Media stream inactivity:** If no audio for X seconds → hang up
- **Dialog inactivity:** If no bidirectional audio for Y seconds → hang up
- These may not be configurable via API

**Infobip likely has:**
- Media stream timeout: ~5 seconds of silence
- Dialog activity timeout: ~10 seconds without bidirectional audio

---

### 3. **Media Stream Configuration Issues**

**Your Config ID:** `68d559f2b1e1103933e2536b`

**Possible Issues:**
- Sample rate mismatch (should be 16000 Hz for both directions)
- Codec configuration incorrect
- WebSocket URL mismatch or TLS issues
- Bidirectional streaming not properly enabled

**What's Not Visible:**
```bash
# We need to verify these settings in Infobip Portal:
Media Stream Config:
  - Audio Format: LINEAR16 (PCM) ✓
  - Sample Rate: 16000 Hz ✓
  - Channels: 1 (mono) ✓
  - Bidirectional: enabled ✓
  - WebSocket URL: wss://your-railway-url/websocket-voice ✓
```

---

### 4. **ElevenLabs Audio Format Issues**

**Problem:** ElevenLabs may be sending audio at a different sample rate than 16 kHz

**Your Code (websocketProxy.js:908-919):**
```javascript
case 'audio': {
    const sampleRate = message.audio_event?.sample_rate_hz || 
                       message.audio_event?.sample_rate || 16000;
    const raw = Buffer.from(message.audio_event.audio_base_64, 'base64');
    const audioBuffer = (sampleRate !== 16000) ? 
        this.resamplePcm16To16k(raw, sampleRate) : raw;
    if (infobipWs.readyState === WebSocket.OPEN) {
        infobipWs.send(audioBuffer);
    }
}
```

**Possible Issues:**
- ElevenLabs might be sending 24 kHz or 44.1 kHz audio
- Resampling may introduce artifacts or timing issues
- Audio chunks may not align to 20ms boundaries
- Base64 decoding may occasionally fail

---

### 5. **Infobip Dialog State Machine**

**Problem:** Infobip's dialog may be transitioning through states, and something triggers early termination

**Dialog States:**
1. `RINGING` → Call initiated
2. `ESTABLISHED` → Media stream connected
3. `ACTIVE` → Audio flowing bidirectionally
4. `TERMINATING` → Hangup sequence
5. `TERMINATED` → Call ended

**Hypothesis:** The dialog might be going from `ACTIVE` → `TERMINATING` when:
- No user audio received for X seconds after agent speaks
- Media stream quality degrades
- WebSocket connection shows instability

---

### 6. **WebSocket Connection Issues**

**Potential Problems:**
- Railway's WebSocket proxy timing out
- TCP keepalive not configured
- ElevenLabs WebSocket closing unexpectedly
- Infobip WebSocket detecting "unhealthy" connection

**Your Current Monitoring (websocketProxy.js:173-188):**
```javascript
elevenLabsWs.on('close', (code, reason) => {
    console.log(`🤖 ElevenLabs WebSocket closed - Code: ${code}`);
    // You log closure, but is it happening BEFORE or AFTER Infobip hangs up?
});
```

**Missing Data:**
- What closes first: Infobip WS or ElevenLabs WS?
- Are there any close codes on Infobip side?
- Is Railway terminating idle WebSockets?

---

### 7. **Commit/Response Timing Issues**

**Your Current Code (websocketProxy.js:336-353):**
```javascript
scheduleIdleCommit(connectionId, elevenLabsWs) {
    const idleMs = Number(this.config.idleCommitMs) || 500; // 500ms
    conn.commitTimer = setTimeout(() => {
        this.commitAndRequestResponse(connectionId, elevenLabsWs);
    }, idleMs);
}
```

**Problem:** 
- You commit user audio after 500ms silence
- But what if the user doesn't speak for 3+ seconds?
- ElevenLabs may close the conversation if no interaction
- Infobip may close dialog if no bidirectional audio

---

### 8. **User Audio Not Flowing Back**

**Critical Question:** Is user audio (from phone → Infobip → Your Proxy → ElevenLabs) actually flowing?

**Your Code (websocketProxy.js:276-320):**
```javascript
handleIncomingAudio(connectionId, message, elevenLabsWs) {
    // You're forwarding user audio to ElevenLabs
    // But are you RECEIVING any user audio after TTS?
}
```

**Hypothesis:** 
- If user audio isn't being captured properly after TTS
- ElevenLabs and/or Infobip think the call is one-way
- System hangs up assuming the call is over

**Debug Needed:**
- Log timestamp of LAST user audio received
- Log timestamp of LAST TTS audio sent
- Compare timing with call hangup

---

## 🎯 Most Likely Root Cause

**Primary Hypothesis: Insufficient Audio Keepalive**

The Infobip media stream expects **continuous audio flow** on the WebSocket connection. After the AI agent stops speaking:

1. **Gap of 200ms** before first keepalive silence frame
2. **Only 200ms intervals** between frames (should be 20-50ms)
3. **Total duration of only 2 seconds** (user might not respond that fast)
4. **Result:** Infobip detects >100ms gap in audio stream → considers media inactive → terminates dialog

**Why This Matches Symptoms:**
- ✅ Explains why call drops shortly after AI speaks (2-5 seconds = your keepalive window)
- ✅ Explains why it's consistent (always happens after TTS)
- ✅ Explains why no error codes (Infobip thinks it's normal cleanup)

---

## 🔬 Diagnostic Steps Needed

### 1. **Add Detailed Timing Logs**

```javascript
// Add to websocketProxy.js handleElevenLabsMessage
case 'audio': {
    const now = Date.now();
    console.log(`🎵 [${connectionId}] TTS audio received at ${now}`);
    console.log(`🎵 [${connectionId}] Gap since last TTS: ${now - conn.lastTtsAt}ms`);
    // ... existing code
}
```

### 2. **Monitor Infobip WebSocket Close Events**

```javascript
// Add to websocketProxy.js setupInfobipMessageHandlers
infobipWs.on('close', (code, reason) => {
    const duration = Date.now() - conn.startTime;
    console.log(`📞 [${connectionId}] Infobip WS closed after ${duration}ms`);
    console.log(`📞 [${connectionId}] Close code: ${code}, reason: ${reason}`);
    console.log(`📞 [${connectionId}] Last TTS: ${Date.now() - conn.lastTtsAt}ms ago`);
});
```

### 3. **Track User Audio Flow**

```javascript
// Enhance handleIncomingAudio logging
handleIncomingAudio(connectionId, message, elevenLabsWs) {
    const conn = this.getOrInitConnState(connectionId);
    conn.lastUserAudioAt = Date.now();
    
    console.log(`🎤 [${connectionId}] User audio (${message.length} bytes)`);
    console.log(`🎤 [${connectionId}] Gap since last user audio: ${Date.now() - (conn.prevUserAudioAt || 0)}ms`);
    conn.prevUserAudioAt = Date.now();
    // ... existing code
}
```

### 4. **Test Different Keepalive Settings**

```bash
# Try these environment variables
ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20    # Send every 20ms (aggressive)
ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000    # Keep sending for 30 seconds
```

---

## 🛠️ Recommended Fixes (Priority Order)

### ⭐ Priority 1: Fix Audio Keepalive (Your Recent Change)

Your recent edit already improved this, but go even more aggressive:

```javascript
// Recommended settings:
ttsKeepaliveTotalMs: 30000,      // 30 seconds (give user time to think)
ttsKeepaliveIntervalMs: 20,      // 20ms (standard frame rate)
ttsKeepaliveFrameMs: 20,         // 20ms frames
```

### ⭐ Priority 2: Start Keepalive Immediately

```javascript
// Change >= to start immediately at 0ms
if (elapsed >= 0 && elapsed <= this.config.ttsKeepaliveTotalMs) {
    // Send silence frame
}
```

### ⭐ Priority 3: Continuous Background Keepalive

Instead of keepalive only after TTS, maintain a **continuous** silence stream when no TTS is playing:

```javascript
// Start keepalive immediately when Infobip connects
setupInfobipMessageHandlers(connectionId, infobipWs, elevenLabsWs) {
    const conn = this.getOrInitConnState(connectionId);
    
    // Continuous background silence unless TTS is playing
    conn.backgroundKeepalive = setInterval(() => {
        const timeSinceLastTts = Date.now() - (conn.lastTtsAt || 0);
        if (timeSinceLastTts > 100 && infobipWs.readyState === WebSocket.OPEN) {
            const silence = this.makeSilenceFrame16k(20);
            infobipWs.send(silence);
        }
    }, 20); // Every 20ms
    
    // ... existing handlers
}
```

### Priority 4: Add Infobip Ping/Pong

```javascript
// Add WebSocket ping/pong to keep connection alive
infobipWs.on('ping', () => {
    infobipWs.pong();
});

// Send periodic pings
conn.pingInterval = setInterval(() => {
    if (infobipWs.readyState === WebSocket.OPEN) {
        infobipWs.ping();
    }
}, 5000);
```

### Priority 5: Verify Media Stream Config

Check in Infobip Portal:
```
Media Stream Configuration (ID: 68d559f2b1e1103933e2536b)
├─ Audio Format: LINEAR16 (must be this exact format)
├─ Sample Rate: 16000 Hz (not 8000, not 22050)
├─ Bit Depth: 16-bit (standard PCM)
├─ Channels: 1 (mono)
├─ Byte Order: Little Endian
├─ WebSocket URL: wss://your-railway-app/websocket-voice
└─ Enable Bidirectional: YES (critical!)
```

### Priority 6: Add More Robust Error Handling

```javascript
// Detect premature Infobip closure
infobipWs.on('close', (code, reason) => {
    const duration = Date.now() - conn.startTime;
    if (duration < 10000) { // Less than 10 seconds
        console.error(`🚨 [${connectionId}] PREMATURE CLOSURE after ${duration}ms!`);
        console.error(`🚨 [${connectionId}] Code: ${code}, Reason: ${reason}`);
        console.error(`🚨 [${connectionId}] Last TTS: ${Date.now() - conn.lastTtsAt}ms ago`);
        console.error(`🚨 [${connectionId}] Last user audio: ${Date.now() - conn.lastUserAudioAt}ms ago`);
    }
});
```

---

## 🧪 Testing Strategy

### Test 1: Aggressive Keepalive
```bash
export ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
export ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000
# Redeploy and test call
```

### Test 2: Continuous Background Silence
Implement the continuous keepalive approach and test

### Test 3: Check Official Tutorial
Compare your implementation with the official Infobip-ElevenLabs tutorial:
```bash
cd projects/calls_backend
cd ../ws_backend
# Both use similar approach - any differences?
```

### Test 4: Monitor Full Call Lifecycle
```bash
# Watch logs in real-time during call
railway logs --follow | grep -E "(TTS|audio|Infobip|close|WebSocket)"
```

---

## 📋 Information Still Needed

1. **Exact timing:** How many seconds after TTS stops does the call drop?
2. **Infobip logs:** Does Infobip Portal show any error/reason for call termination?
3. **WebSocket close order:** Which WebSocket closes first (Infobip or ElevenLabs)?
4. **User audio flow:** Is any user audio captured AFTER the AI greeting?
5. **Media stream config:** Full details of the Infobip media stream configuration
6. **ElevenLabs agent config:** Is there a timeout setting on the ElevenLabs agent?
7. **Railway logs:** Full logs from a call showing the exact sequence of events

---

## 🎯 Next Steps

1. **Discard or commit** your current keepalive changes
2. **Implement continuous background keepalive** (Priority 3 above)
3. **Add detailed timing logs** (Diagnostic Steps above)
4. **Test with a call** and capture full logs
5. **Analyze logs** to confirm root cause
6. **Iterate on keepalive timing** based on results

---

## 💡 Alternative Hypothesis (If Keepalive Doesn't Fix It)

If aggressive keepalive still doesn't work, the problem might be:

- **Infobip Dialog Issue:** The dialog itself (not just media stream) has a separate timeout
- **ElevenLabs Agent Timeout:** ElevenLabs agent configured to end conversation after first response
- **Network Issue:** Railway or Infobip network path dropping WebSocket connections
- **Configuration Mismatch:** WebSocket URL, API keys, or agent ID incorrect

In that case, we'd need to:
1. Review Infobip dialog configuration settings
2. Check ElevenLabs agent conversation settings
3. Test with simpler "echo" WebSocket to isolate the issue

---

**Bottom Line:** The most likely cause is insufficient audio keepalive on the Infobip media stream WebSocket, causing Infobip to terminate the dialog due to perceived inactivity. Your recent changes improve this but may need to be even more aggressive (20ms intervals, 30+ seconds duration, or continuous background keepalive).
