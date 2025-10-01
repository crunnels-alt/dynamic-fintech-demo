const express = require('express');
const axios = require('axios');

const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY || ""; // required
const MEDIA_STREAM_CONFIG_ID = process.env.MEDIA_STREAM_CONFIG_ID || ""; // required
const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';

const app = express();

const ibClient = axios.create({
  baseURL: INFOBIP_BASE_URL,
  headers: { Authorization: `App ${INFOBIP_API_KEY}` }
});

async function handleCallReceived(event) {
  const callId = event.callId;
  console.log(`Received call ${callId}, creating a dialog...`);

  const response = await ibClient.post('/calls/1/dialogs', {
    parentCallId: callId,
    childCallRequest: {
      endpoint: {
        type: 'WEBSOCKET',
        websocketEndpointConfigId: MEDIA_STREAM_CONFIG_ID
      }
    }
  });

  console.log(`Created dialog with ID ${response.data.id}`);
}

app.use(express.json());

app.post('/webhook', async (req, res) => {
  const event = req.body;
  console.log('Received event from Infobip:', event?.type, event?.callId);

  try {
    if (event?.type === 'CALL_RECEIVED') {
      await handleCallReceived(event);
    }
  } catch (err) {
    console.error('Dialog creation error:', err.response?.data || err.message || err);
  }

  res.status(200).send();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
