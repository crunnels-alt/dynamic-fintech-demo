# Infobip Capital - AI Voice Banking Demo

An interactive fintech demo showcasing Infobip's Voice API with OpenAI for Dev Days NYC 2025. Experience the future of banking with AI-powered voice assistance.

## 🏦 Overview

Infobip Capital demonstrates how modern financial institutions can leverage AI voice technology to provide:

- **Instant Account Information** - Balance inquiries via natural voice commands
- **Loan Application Management** - Real-time status updates and next steps
- **Fraud Detection & Response** - Automated alerts with live agent handoff
- **Account Services** - Voice-activated account management
- **Personalized Customer Experience** - Dynamic data generation for realistic demos

## 🚀 Features

### Web Registration Portal
- **Mobile-Optimized Form** - Responsive design with Infobip Capital branding
- **Real-time Validation** - Client and server-side input validation
- **Demo Account Generation** - Automatic creation of fake banking data
- **SMS Confirmations** - Registration details sent via Infobip SMS API

### AI Voice Banking (Coming Soon)
- **Natural Language Processing** - Powered by OpenAI's Realtime API
- **Caller Identification** - Phone number-based user lookup
- **Dynamic Conversations** - Personalized responses based on user data
- **Live Agent Handoff** - Seamless transfer for complex scenarios

### Demo Scenarios
1. **Balance Inquiry** - "What's my account balance?"
2. **Loan Status Check** - "Check my loan application status"
3. **Fraud Alert & Transfer** - "I need to report suspicious activity"
4. **Account Activation** - "Activate my new account"
5. **Voice Registration** - Sign up for demo over the phone

## 🛠️ Quick Start

### Prerequisites
- Node.js 16+
- Infobip account with Voice & SMS API access
- OpenAI API key with Realtime API access

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

### Configuration

Edit `.env` with your API credentials:

```bash
# Infobip Configuration
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_BASE_URL=your_infobip_base_url
INFOBIP_APPLICATION_ID=your_application_id

# SMS Configuration  
INFOBIP_SMS_API_KEY=your_sms_api_key
SMS_FROM_NUMBER=InfobipCapital

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Demo Settings
DEMO_CALL_NUMBER=+1234567890
LIVE_AGENT_NUMBER=+1234567890
COMPANY_NAME=Infobip Capital
```

## 📱 Demo Access

1. **Web Form**: `http://localhost:3000`
2. **Health Check**: `http://localhost:3000/api/health`
3. **Demo Scenarios**: `http://localhost:3000/api/scenarios`
4. **Admin Panel**: `http://localhost:3000/api/admin/users` (requires token)

## 🎯 Usage

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

## 🏗️ Architecture

```
📞 Phone Call → Infobip Voice API → OpenAI Realtime API
                                            ↓
               Database ← Function Calls ← AI Assistant
                  ↓
              SMS Alerts → Infobip SMS API
```

### Components
- **Express.js Server** - RESTful API and web form hosting
- **SQLite Database** - User profiles and fake banking data
- **Infobip Voice API** - Phone call handling and SIP routing
- **Infobip SMS API** - Registration confirmations and alerts
- **OpenAI Realtime API** - Natural language understanding and responses
- **React/Vanilla JS Frontend** - Mobile-optimized registration form

## 🗄️ Database Schema

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

## 📊 API Endpoints

### Public Endpoints
- `GET /` - Registration form
- `POST /api/register` - User registration
- `GET /api/health` - Service health check
- `GET /api/scenarios` - Demo scenarios info

### Voice API Webhooks (Coming Soon)
- `POST /webhook/voice/inbound` - Incoming call handling
- `POST /webhook/voice/connected` - Call connection events
- `POST /webhook/voice/hangup` - Call termination

### Admin Endpoints
- `GET /api/admin/users` - User management
- `GET /api/user/:phoneNumber` - User lookup

## 🔒 Security Features

- Input validation and sanitization
- Phone number verification
- Rate limiting on API endpoints
- Secure webhook signature validation
- Environment-based configuration

## 📈 Analytics & Monitoring

- Real-time health checks
- Call success/failure tracking
- User interaction analytics
- Service dependency monitoring
- Error logging and alerting

## 🚀 Production Deployment

### Environment Setup
- Set `NODE_ENV=production`
- Configure production database
- Set up SSL/TLS certificates
- Configure reverse proxy (nginx)

### Scaling Considerations
- Redis for session management
- Database connection pooling
- Load balancing for multiple instances
- CDN for static assets
- Monitoring and alerting setup

## 🤝 Contributing

This demo showcases the power of combining:
- **Infobip's Voice & SMS APIs** for robust telecommunications
- **OpenAI's Realtime API** for natural conversation capabilities
- **Modern web technologies** for scalable, responsive interfaces
- **Financial sector use cases** for practical business applications

Perfect for demonstrating AI-powered customer service, voice banking, and telecommunications integration at conferences and demos.

## 📞 Support

For questions about this demo or Infobip's APIs:
- Visit [Infobip Developer Hub](https://www.infobip.com/developers)
- Check out [Voice API Documentation](https://www.infobip.com/docs/voice)
- Explore [SMS API Documentation](https://www.infobip.com/docs/sms)

---

**Built for Dev Days NYC 2025** • Showcasing the future of AI-powered banking with Infobip's communication platform.