# Dynamic Variables Implementation - Handoff Notes for Infobip Team

## Overview
This project integrates Infobip Voice API with ElevenLabs Conversational AI to create personalized voice banking experiences. The dynamic variables feature has been successfully implemented, allowing the AI agent to address customers by name and reference their specific account details.

## Current Status

###  Working Features
- **Dynamic Variables**: Successfully passing 8 customer-specific variables to ElevenLabs agent
- **Customer Identification**: Phone number lookup from PostgreSQL database
- **Context Passing**: Server-side context storage using CallsHandler's `activeCalls` Map
- **Bidirectional Audio**: Audio flows correctly between Infobip and ElevenLabs
- **Personalized Greetings**: Agent successfully says customer name and account balance

###   Known Issue: 2-Second Call Disconnect
**Symptom**: Calls consistently disconnect after approximately 2 seconds
**Infobip Close Code**: 1006 (abnormal closure)
**Evidence**: Dynamic variables ARE working - agent says "Hello Connor Runnels! Your current account balance is 2500.00" before disconnect
**Next Steps**: Requires investigation by Infobip engineering team

## Architecture

### Data Flow
1. **Incoming Call** ’ Infobip receives call via webhook (`/api/webhooks/calls/received`)
2. **Caller Identification** ’ `CallsHandler.identifyCallerAndGetContext()` looks up phone number in PostgreSQL
3. **Context Storage** ’ User context stored in `CallsHandler.activeCalls` Map with callId as key
4. **Dialog Creation** ’ Infobip creates WebSocket dialog connecting to our proxy
5. **Context Retrieval** ’ WebSocket proxy retrieves context from most recent active call
6. **Variable Construction** ’ 8 dynamic variables built from customer context
7. **ElevenLabs Init** ’ Variables sent in `conversation_initiation_client_data` message
8. **Audio Bridge** ’ Bidirectional audio streaming between Infobip ” ElevenLabs

### Key Components

#### 1. `src/voice/callsHandler.js`
- Handles incoming call webhooks
- Identifies callers by phone number
- Retrieves customer context from PostgreSQL
- Stores context in `activeCalls` Map for WebSocket access

#### 2. `src/voice/websocketProxy.js`
- Bridges Infobip audio streams with ElevenLabs WebSocket
- Retrieves customer context from CallsHandler
- Constructs 8 dynamic variables
- Sends configuration to ElevenLabs
- Handles bidirectional audio streaming

#### 3. `src/database/PostgresManager.js`
- Database operations for user lookup
- Methods: `getUserByPhone()`, `getUserLoanApplications()`, `getUserTransactions()`

## Dynamic Variables Configuration

### The 8 Required Variables
These MUST match the variables defined in the ElevenLabs agent dashboard:

1. **customer_name** - Customer's full name
2. **company_name** - Customer's company name
3. **current_balance** - Account balance (as string, e.g., "2500.00")
4. **account_number** - Fake account number for demo
5. **loan_status** - Current loan application status
6. **phone_number** - Customer's phone number
7. **is_fraud_flagged** - Boolean indicating fraud scenario
8. **verification_complete** - Boolean (always true for registered users)

### Critical Implementation Details

**Location**: `src/voice/websocketProxy.js` lines 131-173

```javascript
// Build dynamic variables from customer context
const dynamicVariables = {};

if (customerContext) {
    dynamicVariables.customer_name = customerContext.name || 'Valued Customer';
    dynamicVariables.company_name = customerContext.companyName || 'Your Company';
    dynamicVariables.current_balance = customerContext.fakeAccountBalance || '0.00';
    dynamicVariables.account_number = customerContext.fakeAccountNumber || 'ACC000000000';
    dynamicVariables.loan_status = customerContext.loanApplicationStatus || 'No Active Applications';
    dynamicVariables.phone_number = customerContext.phoneNumber || '';
    dynamicVariables.is_fraud_flagged = customerContext.fraudScenario ? true : false;
    dynamicVariables.verification_complete = true;
}

// Send to ElevenLabs - NO PROMPT OVERRIDE
const initialConfig = {
    type: 'conversation_initiation_client_data',
    dynamic_variables: dynamicVariables
};

elevenLabsWs.send(JSON.stringify(initialConfig));
```

**Important Notes**:
- We send ONLY `dynamic_variables`, not `conversation_config_override`
- The agent uses its configured prompt from the ElevenLabs dashboard
- The dashboard prompt contains `{{variable}}` placeholders that get substituted
- Sending additional undefined variables will cause conversation failure

## Debugging the 2-Second Disconnect Issue

### What We've Confirmed
1.  Dynamic variables are correctly constructed and sent
2.  ElevenLabs receives and processes the variables (agent speaks personalized greeting)
3.  Audio flows from ElevenLabs ’ Infobip (we hear the agent speaking)
4.  Audio flows from Infobip ’ ElevenLabs (using `user_audio_chunk` format)
5.  WebSocket connections establish successfully on both sides
6. L Infobip disconnects with code 1006 after ~2 seconds consistently

### Possible Areas to Investigate
- Infobip dialog configuration (maxDuration: 3600 is set)
- WebSocket endpoint configuration on Infobip side
- Audio format compatibility (we're using PCM L16 16kHz as documented)
- Potential timeout or keepalive issues
- Network/proxy issues between Infobip and our Railway-hosted endpoint

### Relevant Log Output
```
[ElevenLabs] > Agent: "Hello Connor Runnels! Thank you for calling Infobip Capital..."
[ElevenLabs] > Agent: "...your current account balance is 2500.00. How may I assist you today?"
[Infobip] Client disconnected (code: 1006)
[ElevenLabs] Connection closed (code: 1005)
```

## Environment Variables

Required for dynamic variables feature:
```
# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_AGENT_ID=your_agent_id

# Infobip Configuration
INFOBIP_API_KEY=your_api_key
INFOBIP_BASE_URL=https://api.infobip.com
MEDIA_STREAM_CONFIG_ID=your_config_id

# Database (PostgreSQL on Railway)
DATABASE_URL=postgresql://...
```

## Git History

Key commits for this feature:
- `3c00056` - feat: add dynamic variables support
- `6fb255b` - fix: send only 8 dynamic variables matching agent config
- `f39a46e` - fix: remove prompt override - use agent's configured prompt
- `62f2af1` - fix: resolve customer context not being passed to WebSocket

## Testing

To test dynamic variables:
1. Register a user via web form at `/`
2. Call the demo number from the registered phone
3. Observe that agent greets you by name and references your account balance
4. Note the 2-second disconnect issue

## Contact

For questions about this implementation, contact the DevRel team.
