# Infobip Capital - AI Voice Banking Demo

> **STATUS: FULLY OPERATIONAL** - Complete end-to-end voice banking with personalized greetings, real-time balance access, and dynamic database integration!

An interactive fintech demo showcasing Infobip's Voice API with ElevenLabs Conversational AI for Dev Days NYC 2025. Experience the future of banking with AI-powered voice assistance.

## Live Demo
- **Registration**: https://victorious-friendship-production-39d6.up.railway.app  
- **Call Number**: +1 650 718 5356
- **Experience**: "Hello [Your Name]! Thank you for calling Infobip Capital. Your current account balance is $X,XXX.XX. How can I help you today?"

## Overview

Infobip Capital demonstrates how modern financial institutions can leverage AI voice technology to provide:

- **Instant Account Information** - Balance inquiries via natural voice commands
- **Loan Application Management** - Real-time status updates and next steps
- **Fraud Detection & Response** - Automated alerts with live agent handoff
- **Account Services** - Voice-activated account management
- **Personalized Customer Experience** - Dynamic data generation for realistic demos

## Features

### Web Registration Portal
- **Mobile-Optimized Form** - Responsive design with Infobip Capital branding
- **Real-time Validation** - Client and server-side input validation
- **Demo Account Generation** - Automatic creation of fake banking data
- **SMS Confirmations** - Registration details sent via Infobip SMS API

### AI Voice Banking
- **Natural Language Processing** - Powered by ElevenLabs Conversational AI
- **Caller Identification** - Phone number-based user lookup
- **Dynamic Conversations** - Personalized responses based on user data
- **Continuous Audio Streaming** - Advanced keepalive for stable connections

### Demo Scenarios
1. **Balance Inquiry** - "What's my account balance?"
2. **Loan Status Check** - "Check my loan application status"
3. **Fraud Alert & Transfer** - "I need to report suspicious activity"
4. **Account Activation** - "Activate my new account"
5. **Voice Registration** - Sign up for demo over the phone

## Quick Start

### Prerequisites
- Node.js 18+
- Infobip account with Voice & SMS API access
- ElevenLabs API key with Conversational AI access

### Installation

```bash
# Clone the repository
git clone <repository>
cd dynamic-fintech-demo

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys

# Set up database
npm run setup-db

# Start the server
npm start
```

**For complete setup instructions, see [SETUP.md](./SETUP.md)**

### Configuration

Edit `.env` with your API credentials:

```bash
# Infobip Configuration
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_BASE_URL=https://api.infobip.com
MEDIA_STREAM_CONFIG_ID=your_config_id

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_agent_id

# Webhook Configuration
WEBHOOK_BASE_URL=your_deployment_url

# Demo Settings
DEMO_CALL_NUMBER=+1234567890
COMPANY_NAME=Infobip Capital
```

## Demo Access

1. **Web Form**: `http://localhost:3000`
2. **Health Check**: `http://localhost:3000/api/health`
3. **Demo Scenarios**: `http://localhost:3000/api/scenarios`
4. **Admin Panel**: `http://localhost:3000/api/admin/users` (requires token)

## Usage

### 1. Register for Demo
- Visit the web form at `http://localhost:3000`
- Fill out your information with demo preferences
- Receive SMS confirmation with account details
- Note the demo call number provided

### 2. Try Voice Banking
- Call the provided demo number
- Use natural language to interact with the AI
- Try different banking scenarios
- Experience live agent handoff for fraud reports

### 3. Sample Voice Commands
```
"What's my account balance?"
"Check my loan application status"
"Activate my account"
"I think someone used my card fraudulently"
"Transfer me to a loan officer"
```

## Architecture

```
Phone Call → Infobip Voice API → WebSocket Proxy → ElevenLabs AI
                                            ↓
               Database ← Dynamic Variables ← AI Assistant
                  ↓
              SMS Alerts → Infobip SMS API
```

### Components
- **Express.js Server** - RESTful API and web form hosting
- **PostgreSQL/SQLite Database** - User profiles and banking data
- **Infobip Voice API** - Phone call handling and media streaming
- **Infobip SMS API** - Registration confirmations and alerts
- **ElevenLabs Conversational AI** - Natural language understanding and responses
- **WebSocket Proxy** - Bidirectional audio streaming bridge
- **Vanilla JS Frontend** - Mobile-optimized registration form

## Database Schema

### Users Table
- User registration information
- Fake account numbers and balances
- Loan application scenarios
- Fraud detection preferences
- Call history and analytics

### Supporting Tables
- Loan applications with status tracking
- Transaction history generation
- Officer/agent information
- Call logs for analytics

## API Endpoints

### Public Endpoints
- `GET /` - Registration form
- `POST /api/register` - User registration
- `GET /api/health` - Service health check
- `GET /api/scenarios` - Demo scenarios info

### Voice API Webhooks
- `POST /api/webhooks/calls/received` - Incoming call handling
- `WS /websocket-voice` - Media streaming endpoint
- `GET /knowledge-base` - Dynamic knowledge base for AI agent

### Admin Endpoints
- `GET /api/admin/users` - User management
- `GET /api/user/:phoneNumber` - User lookup

## Security Features

- Input validation and sanitization
- Phone number verification
- Rate limiting on API endpoints
- Secure webhook signature validation
- Environment-based configuration

## Analytics & Monitoring

- Real-time health checks
- Call success/failure tracking
- User interaction analytics
- Service dependency monitoring
- Error logging and alerting

## Production Deployment

Deploy to Railway with one command:

```bash
railway up
```

**For complete deployment instructions, see [SETUP.md](./SETUP.md)**

### Key Features
- Auto-scaling with Railway
- PostgreSQL database support
- Continuous audio keepalive for stable calls
- Dynamic variable injection for personalization
- Real-time health monitoring

## Documentation

- **[SETUP.md](./SETUP.md)** - Complete setup and deployment guide
- **[CLAUDE.md](./CLAUDE.md)** - Technical implementation notes and troubleshooting

## About This Demo

This demo showcases the power of combining:
- **Infobip's Voice & SMS APIs** for robust telecommunications
- **ElevenLabs Conversational AI** for natural, human-like interactions
- **Modern web technologies** for scalable, responsive interfaces
- **Financial sector use cases** for practical business applications

Perfect for demonstrating AI-powered customer service, voice banking, and telecommunications integration at conferences and demos.

## Support

For questions about this demo or Infobip's APIs:
- Visit [Infobip Developer Hub](https://www.infobip.com/developers)
- Check out [Voice API Documentation](https://www.infobip.com/docs/voice)
- Explore [SMS API Documentation](https://www.infobip.com/docs/sms)

---

**Built for Dev Days NYC 2025** • Showcasing the future of AI-powered banking with Infobip's communication platform.
