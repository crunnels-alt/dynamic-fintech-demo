const http = require('http');
const WebSocket = require('ws');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || ""; // required
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";  // required

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (infobipWs) => {
  let elevenLabsWs = null;
  let commitTimer = null;
  const idleCommitMs = Number(process.env.ELEVENLABS_IDLE_COMMIT_MS || 500);
  const autoResponseCreate = (process.env.ELEVENLABS_AUTO_RESPONSE_CREATE ?? 'true').toLowerCase() !== 'false';

  const clearCommit = () => { if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; } };
  const scheduleCommit = () => {
    clearCommit();
    commitTimer = setTimeout(() => {
      if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        try {
          elevenLabsWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          if (autoResponseCreate) {
            elevenLabsWs.send(JSON.stringify({ type: 'response.create' }));
          }
        } catch (e) {
          console.error('[Bridge] commit error:', e.message || e);
        }
      }
    }, idleCommitMs);
  };

  async function getSignedUrl() {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!response.ok) {
      throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText}`);
    }
    return (await response.json()).signed_url;
  }

  (async () => {
    try {
      const signedUrl = await getSignedUrl();
      elevenLabsWs = new WebSocket(signedUrl);

      elevenLabsWs.on('open', () => {
        console.log('[ElevenLabs] Connected to Conversational AI');
        const initialConfig = { type: 'conversation_initiation_client_data' };
        elevenLabsWs.send(JSON.stringify(initialConfig));
      });

      elevenLabsWs.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          switch (message.type) {
            case 'conversation_initiation_metadata':
              break;
            case 'audio': {
              const buff = Buffer.from(message.audio_event.audio_base_64, 'base64');
              if (infobipWs.readyState === WebSocket.OPEN) {
                infobipWs.send(buff);
              }
              break;
            }
            case 'agent_response_correction':
            case 'interruption':
              if (infobipWs.readyState === WebSocket.OPEN) {
                infobipWs.send(JSON.stringify({ action: 'clear' }));
              }
              break;
            case 'ping':
              if (message.ping_event?.event_id) {
                elevenLabsWs.send(JSON.stringify({ type: 'pong', event_id: message.ping_event.event_id }));
              }
              break;
            default:
              break;
          }
        } catch (error) {
          console.error('[ElevenLabs] Error processing message:', error);
        }
      });

      elevenLabsWs.on('error', (error) => console.error('[ElevenLabs] WebSocket error:', error));
      elevenLabsWs.on('close', () => { clearCommit(); console.log('[ElevenLabs] Disconnected'); });
    } catch (error) {
      console.error('[ElevenLabs] Setup error:', error);
    }
  })();

  // Handle messages from Infobip
  infobipWs.on('message', (message) => {
    try {
      if (typeof message === 'string') {
        return; // JSON control events ignored here
      }

      if (elevenLabsWs?.readyState === WebSocket.OPEN) {
        elevenLabsWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: Buffer.from(message).toString('base64')
        }));
        scheduleCommit();
      }
    } catch (error) {
      console.error('[Infobip] Error processing message:', error);
    }
  });

  // Handle WebSocket closure
  infobipWs.on('close', () => {
    clearCommit();
    console.log('[Infobip] Client disconnected');
    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
      elevenLabsWs.close();
    }
  });
});

const PORT = process.env.PORT || 3500;
server.listen(PORT, () => {
  console.log(`WS Server is running on port ${server.address().port}`);
});
