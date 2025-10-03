# Working Voice Integration Configuration

**Last Verified:** October 3, 2025
**Git Tag:** `v1.0.0-working`
**Commit:** `c42f0d5`

## ✅ Confirmed Working

This configuration successfully enables voice calls where:
- The bot answers immediately
- Audio is transmitted bidirectionally
- Voice Activity Detection works properly
- Conversations can continue normally

## Required Configuration

### ElevenLabs Agent Settings (Dashboard)

**CRITICAL:** The following override permissions must be enabled in your ElevenLabs agent settings:

1. ✅ **Prompt Override** - Must be enabled
2. ✅ **First Message Override** - Must be enabled
3. ✅ **Language Override** - Must be enabled (optional but recommended)

### Code Configuration

The working `conversation_initiation_client_data` message sent to ElevenLabs:

```javascript
{
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
        agent: {
            prompt: {
                prompt: "You are a helpful AI assistant for Infobip Capital, a modern fintech platform. Greet the caller warmly and ask how you can help them today."
            },
            first_message: "Hello! Welcome to Infobip Capital. How can I assist you today?",
            language: "en"
        },
        tts: {
            model_id: "eleven_turbo_v2_5"
        },
        asr: {
            quality: "high",
            keywords: []
        },
        vad: {
            enabled: true,
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
        }
    }
}
```

### Audio Processing

- **Idle Commit:** 500ms (commits audio buffer after 500ms of silence)
- **Auto Response Create:** Enabled (triggers response.create after commit)
- **Audio Format:** PCM, base64-encoded chunks from Infobip

## Environment Variables

```bash
ELEVENLABS_AGENT_ID=<your_agent_id>
ELEVENLABS_API_KEY=<your_api_key>
ELEVENLABS_IDLE_COMMIT_MS=500  # optional, defaults to 500
ELEVENLABS_AUTO_RESPONSE_CREATE=true  # optional, defaults to true
```

## Infobip Configuration

**Media Stream Config:**
- **Type:** WEBSOCKET_ENDPOINT
- **URL:** `wss://your-domain.up.railway.app/websocket-voice`
- **Sample Rate:** 16000 Hz

## Troubleshooting

If calls connect but stay silent:

1. **Check ElevenLabs Agent Settings:**
   - Verify prompt override is enabled
   - Verify first_message override is enabled

2. **Check Console Logs:**
   - Look for `[ElevenLabs] ✅ Conversation initialized`
   - Look for audio chunks being sent: `[ElevenLabs] 🤖 Agent: "..."`

3. **Verify Configuration:**
   - Ensure `first_message` is in the override (triggers immediate response)
   - Ensure VAD is enabled (detects when user stops speaking)

## Restoring This Configuration

If you need to restore this working version:

```bash
git checkout v1.0.0-working
# Or restore just the websocketProxy.js file:
git checkout v1.0.0-working -- src/voice/websocketProxy.js
```

## Key Learnings

1. **first_message is critical** - Without it, the agent won't speak first
2. **Override permissions matter** - Agent settings in ElevenLabs dashboard must allow overrides
3. **VAD configuration is important** - Helps detect end of user speech
4. **Simple config doesn't work** - Just `{type: 'conversation_initiation_client_data'}` results in silent calls
