# Architecture Deep Dive

Complete technical walkthrough of the Infobip Capital voice banking application.

---

## High-Level Flow

```
1. User Registers (Web Form)
   └─> Stores user data in PostgreSQL

2. User Calls Infobip Number
   └─> Infobip sends webhook to our server

3. Server Identifies Caller
   └─> Looks up user in database by phone number

4. Server Creates Dialog
   └─> Infobip establishes WebSocket connection to our proxy

5. WebSocket Proxy Bridges Audio
   ├─> Retrieves user context
   ├─> Connects to ElevenLabs AI
   ├─> Sends dynamic variables (name, balance, etc.)
   └─> Streams audio bidirectionally

6. Conversation Happens
   ├─> User speaks → Infobip → Our Proxy → ElevenLabs
   └─> AI responds → ElevenLabs → Our Proxy → Infobip → User

7. Call Ends
   └─> Stats logged to database
```

---

## Phase 1: User Registration

### High-Level Components
- **Web Form** (public/index.html)
- **Registration Endpoint** (src/web/routes.js)
- **Database Manager** (src/database/)

### Detailed Flow

#### 1.1 User Submits Form
**File**: `public/index.html`
- User fills out: name, phone, company, demo scenario
- JavaScript validates and submits to `/api/register`

#### 1.2 Server Receives Registration
**File**: `src/web/routes.js`
**Function**: `POST /api/register`

```javascript
Line 44-122: router.post('/api/register', async (req, res) => {
  // Validates input
  // Generates fake account data
  // Creates user in database
})
```

**What happens:**
1. Validates required fields (name, phone, company)
2. Standardizes phone number format using `PhoneNumberUtils`
3. Generates realistic banking data:
   - Fake account number (ACC + 12 digits)
   - Random balance ($500 - $50,000)
   - Loan application status (if applicable)
4. Calls `databaseManager.createUser(userData)`
5. Returns success response with demo call number

#### 1.3 Database Storage
**File**: `src/database/PostgresManager.js` (or `databaseManager.js` for SQLite)
**Function**: `createUser(userData)`

```javascript
Line 54-86: async createUser(userData) {
  // Inserts user into 'users' table
  // Creates associated loan applications
  // Creates sample transactions
  // Returns user object with ID
}
```

**Database Schema:**
```sql
users {
  id: INTEGER PRIMARY KEY
  name: TEXT
  phone_number: TEXT UNIQUE
  company_name: TEXT
  fake_account_number: TEXT
  fake_account_balance: TEXT
  loan_application_status: TEXT
  fraud_scenario: INTEGER (0 or 1)
  created_at: DATETIME
}
```

---

## Phase 2: Incoming Call

### High-Level Components
- **Infobip Calls API** (external)
- **Calls Handler** (src/voice/callsHandler.js)
- **Database Lookup** (src/database/)

### Detailed Flow

#### 2.1 Infobip Receives Call
When user dials +1 650 718 5356, Infobip:
1. Receives the call on their infrastructure
2. Looks up the associated Voice Application
3. Sends webhook to configured URL: `https://your-app/api/webhooks/calls/received`

#### 2.2 Webhook Handler
**File**: `src/web/routes.js`
**Function**: `POST /api/webhooks/calls/received`

```javascript
Line 228-244: router.post('/api/webhooks/calls/received', async (req, res) => {
  const event = req.body;

  // Pass to CallsHandler for processing
  await callsHandler.handleCallReceived(event);

  res.status(200).json({ status: 'received' });
});
```

**Webhook payload from Infobip:**
```json
{
  "callId": "abc123-def456",
  "properties": {
    "call": {
      "from": "+16505551234",
      "to": "+16507185356"
    }
  }
}
```

#### 2.3 Call Received Handler
**File**: `src/voice/callsHandler.js`
**Function**: `handleCallReceived(event)`

```javascript
Line 30-86: async handleCallReceived(event) {
  // Extract call ID and caller's phone number
  const callId = event.callId;
  const callerId = event.properties?.call?.from;

  // Look up caller in database
  const userContext = await this.identifyCallerAndGetContext(callerId);

  // Store in activeCalls Map
  this.activeCalls.set(callId, {
    callerId,
    userContext,
    startTime: Date.now(),
    status: 'connected'
  });

  // Create dialog with WebSocket endpoint
  await this.createDialogWithAI(callId, userContext);
}
```

**Key Data Structure: activeCalls Map**
```javascript
Map {
  "callId-abc123" => {
    callerId: "+16505551234",
    userContext: {
      id: 5,
      name: "Connor Runnels",
      phoneNumber: "+16505551234",
      companyName: "Acme Corp",
      fakeAccountBalance: "2500.00",
      fakeAccountNumber: "ACC123456789012",
      loanApplicationStatus: "Under Review",
      fraudScenario: false,
      loanApplications: [...],
      recentTransactions: [...]
    },
    startTime: 1704835200000,
    status: 'connected'
  }
}
```

#### 2.4 Caller Identification
**File**: `src/voice/callsHandler.js`
**Function**: `identifyCallerAndGetContext(callerId)`

```javascript
Line 93-184: async identifyCallerAndGetContext(callerId) {
  // Standardize phone number (handles different formats)
  const standardizedPhone = PhoneNumberUtils.standardizeNorthAmerican(callerId);

  // Query database
  const user = await databaseManager.getUserByPhone(standardizedPhone);

  if (!user) return null;

  // Fetch additional context
  const loanApplications = await databaseManager.getUserLoanApplications(user.id);
  const recentTransactions = await databaseManager.getUserTransactions(user.id, 3);

  // Build complete context object
  return {
    ...user,
    loanApplications,
    recentTransactions,
    phoneNumber: standardizedPhone,
    callCount: user.callCount + 1
  };
}
```

**Phone Number Standardization:**
**File**: `src/utils/phoneUtils.js`

Input formats handled:
- `+16505551234` → `+16505551234`
- `16505551234` → `+16505551234`
- `6505551234` → `+16505551234`
- `(650) 555-1234` → `+16505551234`

---

## Phase 3: Dialog Creation

### High-Level Components
- **Infobip Dialogs API** (external)
- **Calls Handler** (src/voice/callsHandler.js)

### Detailed Flow

#### 3.1 Create Dialog Request
**File**: `src/voice/callsHandler.js`
**Function**: `createDialogWithAI(callId, userContext)`

```javascript
Line 191-242: async createDialogWithAI(callId, userContext) {
  // API call to Infobip to create dialog
  const response = await this.ibClient.post(
    `${this.infobipBaseUrl}/calls/1/dialogs`,
    {
      parentCallId: callId,
      maxDuration: 3600, // 1 hour max
      childCallRequest: {
        endpoint: {
          type: 'WEBSOCKET',
          websocketEndpointConfigId: this.mediaStreamConfigId,
          customData: {
            parentCallId: callId
          }
        }
      }
    }
  );

  // Store dialog ID in active calls
  const callSession = this.activeCalls.get(callId);
  callSession.dialogId = response.data.id;
}
```

**What this does:**
1. Tells Infobip to create a "child" call/dialog
2. Child call connects to WebSocket endpoint (your server)
3. Audio from phone call streams to your WebSocket
4. Infobip handles codec conversion (phone codecs → PCM 16kHz)

**Environment variable required:**
- `MEDIA_STREAM_CONFIG_ID` - Points to Infobip Media Stream Config
  - Configured in Infobip Portal
  - Specifies: audio format (PCM), sample rate (16kHz), WebSocket URL

---

## Phase 4: WebSocket Connection

### High-Level Components
- **WebSocket Proxy** (src/voice/websocketProxy.js)
- **Signed URL Pool** (src/voice/SignedUrlPool.js)
- **ElevenLabs Service** (external)

### Detailed Flow

#### 4.1 Infobip Connects to WebSocket
**File**: `src/voice/websocketProxy.js`
**Event**: `wss.on('connection')`

```javascript
Line 23-48: this.wss.on('connection', (infobipWs, req) => {
  console.log('[Bridge] New Infobip WebSocket connection established');

  // Retrieve customer context from activeCalls Map
  const activeCalls = callsHandler.getActiveCalls();
  const recentCall = activeCalls[activeCalls.length - 1];
  const callSession = callsHandler.getCallSession(recentCall.callId);
  const customerContext = callSession.userContext;

  console.log('[Bridge] Retrieved context for:', customerContext.name);

  // Will establish ElevenLabs connection next...
});
```

**Why this works:**
- CallsHandler stored context in `activeCalls` Map (Phase 2)
- WebSocket connection happens milliseconds after dialog creation
- We grab the most recent active call's context

#### 4.2 Connect to ElevenLabs
**File**: `src/voice/websocketProxy.js`
**Lines**: 156-164

```javascript
Line 156-164: (async () => {
  // Get signed URL from pool (pre-fetched for speed)
  const signedUrl = await this.signedUrlPool.get();

  // Connect to ElevenLabs Conversational AI
  elevenLabsWs = new WebSocket(signedUrl);

  elevenLabsWs.on('open', () => {
    // Send configuration...
  });
})();
```

**Signed URL Pool Optimization:**
**File**: `src/voice/SignedUrlPool.js`

- Maintains pool of 3-10 pre-fetched signed URLs
- Each URL valid for 5 minutes
- Auto-refills when URLs are consumed
- Saves ~150ms per call setup

**Getting a signed URL:**
```javascript
POST https://api.elevenlabs.io/v1/convai/conversation/get_signed_url
Headers: xi-api-key: YOUR_KEY
Body: { agent_id: "YOUR_AGENT_ID" }

Response: {
  signed_url: "wss://api.elevenlabs.io/v1/convai?token=xyz123..."
}
```

#### 4.3 Initialize ElevenLabs Conversation
**File**: `src/voice/websocketProxy.js`
**Lines**: 166-215

```javascript
Line 166-215: elevenLabsWs.on('open', () => {
  // Build dynamic variables from customer context
  const dynamicVariables = {
    customer_name: customerContext.name,
    company_name: customerContext.companyName,
    current_balance: customerContext.fakeAccountBalance,
    account_number: customerContext.fakeAccountNumber,
    loan_status: customerContext.loanApplicationStatus,
    phone_number: customerContext.phoneNumber,
    is_fraud_flagged: customerContext.fraudScenario,
    verification_complete: true
  };

  // Send initialization message
  const initialConfig = {
    type: 'conversation_initiation_client_data',
    dynamic_variables: dynamicVariables
  };

  elevenLabsWs.send(JSON.stringify(initialConfig));

  // Mark as ready and flush buffered audio
  elevenLabsReady = true;
  if (audioBuffer.length > 0) {
    audioBuffer.forEach(chunk => {
      elevenLabsWs.send(chunk);
    });
    audioBuffer = [];
  }

  // Start continuous keepalive
  startAudioKeepalive();
});
```

**Dynamic Variables:**
These get injected into the ElevenLabs agent's prompt:
- Agent prompt configured in ElevenLabs dashboard
- Contains placeholders like `{{customer_name}}` and `{{current_balance}}`
- Variables sent here replace those placeholders
- Agent greets: "Hello Connor Runnels! Your current balance is $2,500.00..."

---

## Phase 5: Audio Streaming

### High-Level Components
- **WebSocket Proxy** (bidirectional audio bridge)
- **Audio Buffering** (prevents race conditions)
- **Continuous Keepalive** (prevents timeouts)

### Detailed Flow

#### 5.1 User Audio: Infobip → ElevenLabs

**Flow:**
```
User speaks into phone
  ↓
Phone carrier (codec: AMR, G.711, etc.)
  ↓
Infobip infrastructure (transcodes to PCM 16kHz)
  ↓
WebSocket binary message to your proxy
  ↓
Your proxy forwards to ElevenLabs
  ↓
ElevenLabs ASR (speech-to-text)
  ↓
ElevenLabs LLM (generates response)
```

**File**: `src/voice/websocketProxy.js`
**Event**: `infobipWs.on('message')`

```javascript
Line ~250-280: infobipWs.on('message', (data) => {
  // Infobip sends raw PCM audio as binary
  if (Buffer.isBuffer(data)) {
    audioChunksReceived++;
    lastAudioTime = Date.now();

    // If ElevenLabs not ready yet, buffer the audio
    if (!elevenLabsReady) {
      audioBuffer.push(data);
      return;
    }

    // Forward to ElevenLabs
    if (elevenLabsWs.readyState === WebSocket.OPEN) {
      // Convert to base64 for ElevenLabs protocol
      const base64Audio = data.toString('base64');

      elevenLabsWs.send(JSON.stringify({
        type: 'user_audio_chunk',
        audio_chunk: base64Audio
      }));

      audioChunksSinceLastCommit++;

      // Schedule commit after idle period
      scheduleCommit();
    }
  }
});
```

**Audio Buffering (Critical):**
Problem: Infobip connects instantly, but ElevenLabs takes ~150ms to connect.
Solution: Buffer incoming audio until ElevenLabs is ready.

```javascript
// At connection start
let elevenLabsReady = false;
let audioBuffer = [];

// Infobip sends audio (ElevenLabs not ready yet)
if (!elevenLabsReady) {
  audioBuffer.push(data); // Save for later
  return;
}

// When ElevenLabs connects
elevenLabsWs.on('open', () => {
  elevenLabsReady = true;

  // Flush buffered audio
  audioBuffer.forEach(chunk => {
    elevenLabsWs.send(chunk);
  });
  audioBuffer = [];
});
```

**Commit & Response Logic:**

ElevenLabs uses a buffer-commit model:
1. Send audio chunks with `user_audio_chunk`
2. When user stops speaking, send `input_audio_buffer.commit`
3. Optionally send `response.create` to trigger AI response

```javascript
Line 125-153: const scheduleCommit = () => {
  // Cancel any existing commit timer
  clearTimeout(commitTimer);

  // Schedule commit after 500ms of silence
  commitTimer = setTimeout(() => {
    elevenLabsWs.send(JSON.stringify({
      type: 'input_audio_buffer.commit'
    }));

    // Auto-request response
    elevenLabsWs.send(JSON.stringify({
      type: 'response.create'
    }));
  }, 500); // ELEVENLABS_IDLE_COMMIT_MS
};
```

#### 5.2 AI Audio: ElevenLabs → Infobip

**Flow:**
```
ElevenLabs LLM generates text response
  ↓
ElevenLabs TTS converts to audio
  ↓
WebSocket message to your proxy (JSON with base64 audio)
  ↓
Your proxy decodes and forwards to Infobip
  ↓
Infobip sends to phone network
  ↓
User hears AI voice
```

**File**: `src/voice/websocketProxy.js`
**Event**: `elevenLabsWs.on('message')`

```javascript
Line ~400-500: elevenLabsWs.on('message', (data) => {
  const message = JSON.parse(data);

  switch (message.type) {
    case 'audio':
      // TTS audio from ElevenLabs
      const audioBase64 = message.audio_event.audio_base_64;
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      // Update last TTS time (for keepalive)
      lastTtsTime = Date.now();

      // Forward to Infobip
      if (infobipWs.readyState === WebSocket.OPEN) {
        infobipWs.send(audioBuffer);
      }
      break;

    case 'interruption':
      // User started speaking while AI was talking
      console.log('[ElevenLabs] User interrupted');
      break;

    case 'agent_response':
      // Full transcript of what AI said
      console.log('[ElevenLabs] Agent said:', message.agent_response.text);
      break;
  }
});
```

#### 5.3 Continuous Keepalive (Critical)

**Problem:** Infobip expects continuous audio stream. Silence = broken connection.

**Solution:** Send silence frames when AI isn't speaking.

**File**: `src/voice/websocketProxy.js`
**Lines**: 74-102

```javascript
Line 74-102: const startAudioKeepalive = () => {
  keepaliveTimer = setInterval(() => {
    if (infobipWs.readyState !== WebSocket.OPEN) return;

    const timeSinceLastTts = Date.now() - lastTtsTime;

    // Send silence if >100ms since last TTS audio
    if (timeSinceLastTts > 100) {
      // 20ms of silence = 640 bytes PCM (320 samples * 2 bytes)
      const silenceFrame = Buffer.alloc(640, 0);
      infobipWs.send(silenceFrame);
      silenceFrameCount++;
    }
  }, 20); // Every 20ms = standard frame rate
};
```

**Why 20ms?**
- 16kHz sample rate = 16,000 samples/second
- Standard frame = 20ms
- 20ms of audio = 320 samples
- 16-bit PCM = 2 bytes per sample
- Frame size = 320 × 2 = 640 bytes

**Environment variables:**
- `ELEVENLABS_CONTINUOUS_KEEPALIVE=true` - Enable keepalive
- `ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20` - Send every 20ms
- `ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000` - Keep going for 30 seconds

---

## Phase 6: Conversation

### High-Level Flow

```
1. ElevenLabs agent greets user with personalized message
   "Hello Connor Runnels! Your current balance is $2,500.00..."

2. User asks question
   "What's the status of my loan application?"

3. Audio flows: User → Infobip → Proxy → ElevenLabs

4. ElevenLabs processes:
   - ASR: Speech to text
   - LLM: Generate response using agent's prompt + dynamic variables
   - TTS: Text to speech

5. Audio flows back: ElevenLabs → Proxy → Infobip → User

6. Repeat until user hangs up or conversation ends
```

### ElevenLabs Agent Configuration

**Configured in ElevenLabs Dashboard:**

**For the complete agent prompt with hangup instructions, see [ELEVENLABS_AGENT_PROMPT.md](./ELEVENLABS_AGENT_PROMPT.md)**

**Prompt Template (Summary):**
```
You are a professional banking assistant for Infobip Capital.

Customer Information:
- Name: {{customer_name}}
- Company: {{company_name}}
- Account Number: {{account_number}}
- Current Balance: ${{current_balance}}
- Loan Status: {{loan_status}}
- Verified: {{verification_complete}}

You can help with:
- Account balance inquiries
- Loan application status
- Transaction history
- Fraud alerts

Communication Guidelines:
- Be professional, friendly, and concise
- Never ask for SSN, PIN, or passwords
- When unsure how to help, politely explain and offer alternatives
- End calls gracefully when customer is satisfied
- Thank customers for calling Infobip Capital

Example hangup: "Thank you for calling Infobip Capital today, {{customer_name}}.
We appreciate your business! Have a wonderful day!"
```

**Agent Settings:**
- Model: GPT-4o-mini (or similar)
- Voice: Rachel or Adam (professional banking voice)
- Input: PCM 16kHz streaming
- Output: PCM 16kHz streaming
- VAD (Voice Activity Detection): Enabled
- First Message Override: Enabled (for personalized greeting)

### Knowledge Base (Optional)

**Endpoint**: `GET /knowledge-base`
**File**: `src/web/routes.js`
**Lines**: 282-441

Serves live database data to ElevenLabs:
- All customers and their balances
- Loan applications with status
- Recent transactions
- Officer contact information

**Why?** Allows AI to look up information beyond dynamic variables.

---

## Phase 7: Call Termination

### High-Level Components
- **CallsHandler** (cleanup)
- **Database** (logging)

### Detailed Flow

#### 7.1 User Hangs Up

**Infobip sends webhook:**
```json
POST /api/webhooks/calls/ended
{
  "callId": "abc123",
  "duration": 45,
  "reason": "NORMAL_CLEARING"
}
```

**File**: `src/voice/callsHandler.js`
**Function**: `handleCallHangup(event)`

```javascript
Line 293-321: async handleCallHangup(event) {
  const callId = event.callId;
  const callSession = this.activeCalls.get(callId);

  if (callSession) {
    const duration = Date.now() - callSession.startTime;
    const durationSeconds = Math.floor(duration / 1000);

    console.log(`Call ${callId} ended. Duration: ${durationSeconds}s`);

    // Log to database
    await databaseManager.logCall(
      callSession.userContext.phoneNumber,
      'ai_conversation',
      durationSeconds,
      true
    );

    // Cleanup
    this.activeCalls.delete(callId);
  }
}
```

#### 7.2 WebSocket Cleanup

**File**: `src/voice/websocketProxy.js`

```javascript
infobipWs.on('close', (code, reason) => {
  console.log(`[Infobip] Connection closed (${code})`);

  // Close ElevenLabs connection
  if (elevenLabsWs) {
    elevenLabsWs.close();
  }

  // Stop keepalive
  stopAudioKeepalive();

  // Clear timers
  clearInterval(keepaliveInterval);
  clearTimeout(commitTimer);
});

elevenLabsWs.on('close', (code, reason) => {
  console.log(`[ElevenLabs] Connection closed (${code})`);

  // Close Infobip connection
  if (infobipWs) {
    infobipWs.close();
  }
});
```

---

## Complete File Reference

### Application Entry Point
**File**: `src/app.js`
- Initializes Express server
- Sets up database connection
- Attaches WebSocket proxy to same HTTP server
- Handles graceful shutdown

### Database Layer

#### `src/database/DatabaseFactory.js`
- Detects environment (SQLite vs PostgreSQL)
- Returns appropriate database manager instance

#### `src/database/PostgresManager.js`
- PostgreSQL implementation
- Methods:
  - `initialize()` - Creates tables
  - `createUser(userData)` - Inserts new user
  - `getUserByPhone(phone)` - Lookup by phone
  - `getUserLoanApplications(userId)` - Get loans
  - `getUserTransactions(userId, limit)` - Get transactions
  - `updateUserCallStats(phone)` - Increment call count
  - `logCall(phone, scenario, duration, success)` - Log call record

#### `src/database/databaseManager.js`
- SQLite implementation (same interface as PostgresManager)

### Voice Layer

#### `src/voice/callsHandler.js`
- Singleton class managing call lifecycle
- Methods:
  - `handleCallReceived(event)` - Entry point for incoming calls
  - `identifyCallerAndGetContext(callerId)` - Database lookup
  - `createDialogWithAI(callId, userContext)` - Creates Infobip dialog
  - `handleCallHangup(event)` - Cleanup and logging
  - `transferToLiveAgent(callId, reason)` - Transfer functionality
- Data: `activeCalls` Map - Stores call sessions

#### `src/voice/websocketProxy.js`
- WebSocket server bridging Infobip ↔ ElevenLabs
- Handles:
  - Connection establishment
  - Audio streaming (bidirectional)
  - Dynamic variable injection
  - Audio buffering
  - Continuous keepalive
  - Commit/response logic

#### `src/voice/SignedUrlPool.js`
- Maintains pool of pre-fetched ElevenLabs signed URLs
- Reduces latency by ~150ms per call
- Auto-refills and expires URLs

### Web Layer

#### `src/web/routes.js`
- Express routes:
  - `POST /api/register` - User registration
  - `POST /api/webhooks/calls/received` - Incoming call webhook
  - `POST /api/webhooks/calls/ended` - Call ended webhook
  - `GET /knowledge-base` - Dynamic data for AI
  - `GET /api/health` - Health check
  - `GET /api/user/:phoneNumber` - User lookup

### Utility Layer

#### `src/utils/phoneUtils.js`
- `standardizeNorthAmerican(phone)` - Normalizes phone format


#### `src/utils/jsonSanitizer.js`
- `safeStringify(obj)` - Safe JSON serialization

---

## Data Flow Summary

### Registration Flow
```
User (Browser)
  → POST /api/register
  → routes.js validates input
  → databaseManager.createUser()
  → PostgresManager inserts to DB
  → Response to user with demo call number
```

### Call Flow
```
User (Phone)
  → Infobip infrastructure
  → POST /api/webhooks/calls/received
  → callsHandler.handleCallReceived()
  → callsHandler.identifyCallerAndGetContext()
  → databaseManager.getUserByPhone()
  → callsHandler.createDialogWithAI()
  → Infobip connects WebSocket to your server
  → websocketProxy receives connection
  → websocketProxy retrieves context from activeCalls
  → websocketProxy connects to ElevenLabs
  → websocketProxy sends dynamic variables
  → Bidirectional audio streaming begins
  → User hangs up
  → callsHandler.handleCallHangup()
  → databaseManager.logCall()
```

### Audio Flow (User Speaking)
```
Phone microphone
  → Phone carrier
  → Infobip infrastructure (transcoding)
  → WebSocket binary message
  → websocketProxy (base64 encode)
  → ElevenLabs (ASR + LLM)
```

### Audio Flow (AI Speaking)
```
ElevenLabs (LLM + TTS)
  → WebSocket JSON message (base64 audio)
  → websocketProxy (base64 decode)
  → Infobip infrastructure
  → Phone carrier
  → Phone speaker
```

---

## Key Optimizations

### 1. Signed URL Pool
**Problem**: Each call required API call to get ElevenLabs signed URL (~150ms)
**Solution**: Pre-fetch and pool URLs
**Impact**: Eliminates 150ms from call setup

### 2. Audio Buffering
**Problem**: Infobip sends audio before ElevenLabs connects (race condition)
**Solution**: Buffer incoming audio until ElevenLabs ready
**Impact**: Prevents dropped audio at call start

### 3. Continuous Keepalive
**Problem**: Infobip closes connection after 2-3 seconds of silence
**Solution**: Send silence frames every 20ms when AI not speaking
**Impact**: Calls can last indefinitely

### 4. Dynamic Variables
**Problem**: Agent couldn't personalize greetings
**Solution**: Send customer data in conversation_initiation_client_data
**Impact**: "Hello Connor! Your balance is $2,500" instead of generic greeting

### 5. Single Server Instance
**Problem**: Original design used separate WebSocket server
**Solution**: Attach WebSocket to same HTTP server
**Impact**: Simpler deployment, shared port, easier Railway hosting

---

## Environment Variables Reference

### Required
```bash
# Infobip
INFOBIP_API_KEY=your_key
INFOBIP_BASE_URL=https://api.infobip.com
MEDIA_STREAM_CONFIG_ID=your_config_id

# ElevenLabs
ELEVENLABS_API_KEY=your_key
ELEVENLABS_AGENT_ID=your_agent_id

# Deployment
WEBHOOK_BASE_URL=https://your-app.railway.app
```

### Optional (Performance)
```bash
# Keepalive
ELEVENLABS_CONTINUOUS_KEEPALIVE=true
ELEVENLABS_TTS_KEEPALIVE_INTERVAL_MS=20
ELEVENLABS_TTS_KEEPALIVE_TOTAL_MS=30000

# Audio Commit
ELEVENLABS_IDLE_COMMIT_MS=500
ELEVENLABS_MAX_COMMIT_INTERVAL_MS=2000
ELEVENLABS_AUTO_RESPONSE_CREATE=true
```

---

## Critical Configuration

### Infobip Media Stream Config
**Portal**: Voice & Video → Media Stream Configurations

Must match:
- Audio Format: `LINEAR16` (PCM)
- Sample Rate: `16000` Hz
- Channels: `1` (mono)
- WebSocket URL: `wss://your-app.railway.app/websocket-voice`
- Bidirectional: Enabled

### ElevenLabs Agent
**Dashboard**: Conversational AI → Agent Settings

Must have:
- Input: PCM 16kHz
- Output: PCM 16kHz
- Dynamic Variables: Defined (8 variables)
- Security: Overrides enabled
- VAD: Enabled

---

This architecture enables real-time, personalized voice banking conversations with sub-second latency and zero user friction.
