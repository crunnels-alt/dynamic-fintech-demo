#!/usr/bin/env node

// Debug webhook handler to capture exact Infobip errors
require('dotenv').config();
const axios = require('axios');

// Infobip client setup
const infobipApiKey = process.env.INFOBIP_API_KEY;
const infobipBaseUrl = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';
const mediaStreamConfigId = process.env.MEDIA_STREAM_CONFIG_ID;

const ibClient = axios.create({
    headers: {
        'Authorization': `App ${infobipApiKey}`
    }
});

console.log('🔧 Debug Configuration:');
console.log('   INFOBIP_BASE_URL:', infobipBaseUrl);
console.log('   MEDIA_STREAM_CONFIG_ID:', mediaStreamConfigId);
console.log('   API Key present:', !!infobipApiKey);
console.log('');

// Function to capture detailed error information
async function debugDialogCreation(callId, fromNumber) {
    console.log('🔍 DEBUGGING DIALOG CREATION:');
    console.log('   Call ID:', callId);
    console.log('   From Number:', fromNumber);
    console.log('   Media Stream Config ID:', mediaStreamConfigId);
    console.log('');

    try {
        console.log('📡 Making request to:', `${infobipBaseUrl}/calls/1/dialogs`);
        
        const requestPayload = {
            parentCallId: callId,
            childCallRequest: {
                endpoint: {
                    type: 'WEBSOCKET',
                    websocketEndpointConfigId: mediaStreamConfigId
                }
            }
        };
        
        console.log('📤 Request payload:', JSON.stringify(requestPayload, null, 2));
        
        const response = await ibClient.post(`${infobipBaseUrl}/calls/1/dialogs`, requestPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        console.log('✅ SUCCESS! Dialog created:', response.data);
        return response.data;

    } catch (error) {
        console.log('❌ DIALOG CREATION FAILED:');
        console.log('   Status Code:', error.response?.status);
        console.log('   Status Text:', error.response?.statusText);
        
        if (error.response?.data) {
            console.log('   Full Error Response:');
            console.log(JSON.stringify(error.response.data, null, 4));
            
            if (error.response.data.requestError?.serviceException) {
                const exception = error.response.data.requestError.serviceException;
                console.log('');
                console.log('🎯 KEY ERROR DETAILS:');
                console.log('   Message ID:', exception.messageId);
                console.log('   Error Text:', exception.text);
            }
        }
        
        console.log('');
        console.log('📋 Request Headers sent:');
        console.log(JSON.stringify(error.config?.headers, null, 2));
        
        throw error;
    }
}

// Export for use in webhook
module.exports = { debugDialogCreation };

// If run directly, test with dummy data
if (require.main === module) {
    console.log('🧪 Testing with dummy call ID...');
    debugDialogCreation('test-call-123', '+15551234567')
        .catch(err => {
            console.log('Expected failure with dummy call ID');
            process.exit(0);
        });
}