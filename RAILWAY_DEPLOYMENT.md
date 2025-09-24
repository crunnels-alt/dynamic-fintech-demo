# Railway Deployment Guide 🚂

Deploy your Dynamic Fintech Demo to Railway with persistent data storage.

## 🚀 Quick Deployment

### 1. **Choose Your Database Option**

#### Option A: SQLite (Simple, Demo-Safe) ⚡
- Data resets on each deployment (perfect for demos!)
- No additional services needed
- **Recommended for:** Dev Days NYC demo

#### Option B: PostgreSQL (Production-Grade) 🐘  
- Persistent data across deployments
- Railway PostgreSQL service required
- **Recommended for:** Long-term use

---

## 🎯 **Option A: SQLite Deployment (Recommended for Demo)**

### Deploy Steps:
```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Initialize project
railway init

# 4. Set environment variables (you'll get these from your team)
railway variables set INFOBIP_API_KEY=your_key_here
railway variables set ELEVENLABS_API_KEY=your_key_here
railway variables set NODE_ENV=production

# 5. Deploy
railway up
```

### Environment Variables for Railway:
```env
# Required API Keys
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_SMS_API_KEY=your_infobip_api_key  # Usually same as above
ELEVENLABS_API_KEY=your_elevenlabs_api_key

# Auto-configured by Railway
NODE_ENV=production
PORT=$PORT

# Set after deployment
WEBHOOK_BASE_URL=https://your-app.railway.app

# Optional (configure after deployment)
INFOBIP_APPLICATION_ID=your_app_id
ELEVENLABS_AGENT_ID=your_agent_id
MEDIA_STREAM_CONFIG_ID=your_media_config_id
DEMO_CALL_NUMBER=+1XXXXXXXXXX
```

---

## 🐘 **Option B: PostgreSQL Deployment (Recommended)**

✅ **PostgreSQL is now ready!** Your project automatically detects and uses PostgreSQL when deployed to Railway.

### Setup Steps:
```bash
# 1. Create Railway project with PostgreSQL
railway init
railway add postgresql

# 2. The DATABASE_URL will be auto-set by Railway
# 3. PostgreSQL adapter (pg) is already installed

# 4. Set environment variables
railway variables set NODE_ENV=production
railway variables set INFOBIP_API_KEY=your_key
railway variables set ELEVENLABS_API_KEY=your_key

# 5. Deploy (PostgreSQL migration runs automatically)
railway up
```

**What happens automatically:**
- ✅ DatabaseFactory detects PostgreSQL via `DATABASE_URL`
- ✅ Migration script creates all tables with proper PostgreSQL syntax
- ✅ Connection pooling optimized for Railway
- ✅ SSL enabled for secure connections
- ✅ All your existing code works without changes

---

## ⚙️ **Post-Deployment Configuration**

### 1. **Get Your Railway URL**
```bash
railway domain  # Shows your app URL
```

### 2. **Update Webhook URL**
```bash
# Update WEBHOOK_BASE_URL with your Railway URL
railway variables set WEBHOOK_BASE_URL=https://your-app.railway.app
```

### 3. **Configure Infobip Webhooks**
In Infobip Portal, set webhook URLs to:
- Voice webhooks: `https://your-app.railway.app/api/voice/webhook`
- Media streaming: `wss://your-app.railway.app/ws-proxy`

### 4. **Test Deployment**
```bash
# Check deployment status
railway status

# View logs
railway logs

# Test health endpoint
curl https://your-app.railway.app/api/health
```

---

## 🔧 **Railway Configuration Files**

Your project includes:

### `railway.json` - Deployment Settings
```json
{
  "deploy": {
    "startCommand": "npm run start:production",
    "healthcheckPath": "/api/health"
  }
}
```

### `package.json` - Production Scripts
```json
{
  "scripts": {
    "start:production": "npm run migrate:up && concurrently \"npm run start\" \"npm run start:proxy\"",
    "migrate:up": "node scripts/migrate-database.js"
  }
}
```

---

## 🛠️ **Development vs Production**

| Feature | Local Development | Railway Production |
|---------|-------------------|-------------------|
| **Database** | SQLite file | SQLite or PostgreSQL |
| **Webhooks** | ngrok tunnel | Railway domain |
| **Environment** | .env file | Railway variables |
| **Servers** | Manual start | Auto-scaling |

---

## 📊 **Monitoring Your Deployment**

### Railway Dashboard
- **Metrics**: CPU, Memory, Network usage
- **Logs**: Real-time application logs  
- **Environment**: Variable management
- **Deployments**: Version history

### Health Checks
```bash
# Test main server
curl https://your-app.railway.app/api/health

# Test registration endpoint
curl https://your-app.railway.app/api/register

# View webapp
open https://your-app.railway.app
```

---

## 🚨 **Troubleshooting**

### Common Issues:

**"Database connection failed"**
- Check DATABASE_URL is set correctly
- Verify PostgreSQL service is running
- Check migration logs: `railway logs --filter migrate`

**"API keys not working"**
- Verify variables are set: `railway variables`
- Check API key format and permissions
- Review validation: `railway run npm run validate-config`

**"WebSocket connection errors"**
- Ensure Railway allows WebSocket connections
- Check proxy server logs in Railway dashboard
- Verify WSS URL is correctly configured in Infobip

### Debug Commands:
```bash
# Check all environment variables
railway variables

# View real-time logs
railway logs --follow

# Run commands on Railway
railway run npm run validate-config

# Connect to Railway shell
railway shell
```

---

## 🎉 **Demo Day Checklist**

Before your presentation:

- [ ] **Deploy to Railway** and verify health endpoint
- [ ] **Update webhook URLs** in Infobip Portal
- [ ] **Test registration flow** (web form → SMS)
- [ ] **Test voice flow** (call demo number → AI assistant)
- [ ] **Verify environment variables** are all set
- [ ] **Check Railway logs** for any errors
- [ ] **Have backup plan** (local development with ngrok)

**Your Railway URL**: `https://your-app.railway.app` 🚂✨

Perfect for showcasing Infobip's voice capabilities with zero infrastructure management!