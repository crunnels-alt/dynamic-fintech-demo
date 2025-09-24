#!/bin/bash

# Dynamic Fintech Demo - ngrok Setup Script
# This script helps you quickly set up ngrok for webhook testing

echo "🌐 Setting up ngrok for Dynamic Fintech Demo"
echo "============================================"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed"
    echo "📥 Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install ngrok
    else
        echo "❌ Homebrew not found. Please install ngrok manually:"
        echo "   Visit: https://ngrok.com/download"
        exit 1
    fi
fi

echo "✅ ngrok is available"

# Check if servers are running
echo "🔍 Checking if demo servers are running..."
if curl -s http://localhost:3002/api/health > /dev/null 2>&1; then
    echo "✅ Main server (port 3002) is running"
else
    echo "⚠️  Main server (port 3002) not detected"
    echo "💡 Please start with: npm run dev:all"
fi

if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo "✅ WebSocket proxy (port 3001) appears to be running"
else
    echo "⚠️  WebSocket proxy (port 3001) not detected"
    echo "💡 Please start with: npm run dev:all"
fi

echo ""
echo "🚀 Starting ngrok tunnel for port 3002..."
echo "📋 Instructions:"
echo "1. Copy the https URL from ngrok output below"
echo "2. Update WEBHOOK_BASE_URL in your .env file"
echo "3. Configure the webhook URL in Infobip Portal"
echo ""
echo "Press Ctrl+C to stop ngrok when done"
echo "============================================"

# Start ngrok
ngrok http 3002