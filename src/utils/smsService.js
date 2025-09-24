const axios = require('axios');

class SMSService {
    constructor() {
        this.apiKey = process.env.INFOBIP_SMS_API_KEY || process.env.INFOBIP_API_KEY;
        this.baseUrl = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';
        this.fromNumber = process.env.SMS_FROM_NUMBER || 'InfobipCapital';
        this.demoNumber = process.env.DEMO_CALL_NUMBER || '+1-XXX-XXX-XXXX';
        this.companyName = 'Infobip Capital';
    }

    isConfigured() {
        return !!(this.apiKey && this.baseUrl);
    }

    async sendRegistrationConfirmation(user) {
        if (!this.isConfigured()) {
            console.log('SMS service not configured - would have sent:', this.generateConfirmationMessage(user));
            return { status: 'not_configured', message: 'SMS service not configured' };
        }

        try {
            const message = this.generateConfirmationMessage(user);

            const payload = {
                messages: [
                    {
                        from: this.fromNumber,
                        destinations: [
                            {
                                to: user.phoneNumber
                            }
                        ],
                        text: message
                    }
                ]
            };

            const response = await axios.post(
                `${this.baseUrl}/sms/2/text/advanced`,
                payload,
                {
                    headers: {
                        'Authorization': `App ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            console.log('SMS sent successfully:', response.data);
            
            return {
                status: 'sent',
                messageId: response.data.messages[0]?.messageId,
                response: response.data
            };

        } catch (error) {
            console.error('SMS sending failed:', error.response?.data || error.message);
            throw new Error(`SMS sending failed: ${error.response?.data?.requestError?.serviceException?.text || error.message}`);
        }
    }

    generateConfirmationMessage(user) {
        const balance = parseFloat(user.fakeAccountBalance).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD'
        });

        let message = `🏦 Welcome to ${this.companyName}, ${user.name}!\n\n`;
        message += `✅ Your AI Voice Banking demo is ready\n\n`;
        message += `📱 Your Demo Account:\n`;
        message += `• Account: ${user.fakeAccountNumber}\n`;
        message += `• Balance: ${balance}\n`;
        message += `• Company: ${user.companyName}\n`;
        
        if (user.loanApplicationStatus && user.loanApplicationStatus !== 'None') {
            message += `• Loan Status: ${user.loanApplicationStatus}\n`;
        }
        
        if (user.fraudScenario) {
            message += `• Fraud Demo: Enabled 🚨\n`;
        }

        message += `\n📞 Call ${this.demoNumber} to experience AI banking!\n\n`;
        message += `🎯 Try saying:\n`;
        message += `"What's my balance?"\n`;
        message += `"Check my loan status"\n`;
        message += `"Activate my account"\n`;
        
        if (user.fraudScenario) {
            message += `"Report suspicious activity"\n`;
        }

        message += `\n🤖 Powered by Infobip Voice API + OpenAI\n`;
        message += `Dev Days NYC 2025`;

        return message;
    }

    async sendFraudAlert(user, suspiciousActivity) {
        if (!this.isConfigured()) {
            console.log('SMS service not configured - would have sent fraud alert');
            return { status: 'not_configured' };
        }

        try {
            let message = `🚨 SECURITY ALERT - ${this.companyName}\n\n`;
            message += `${user.name}, we detected suspicious activity:\n\n`;
            message += `${suspiciousActivity}\n\n`;
            message += `If this wasn't you, call ${this.demoNumber} immediately and say "I need to report fraud"\n\n`;
            message += `Your account is temporarily secured.`;

            const payload = {
                messages: [
                    {
                        from: this.fromNumber,
                        destinations: [{ to: user.phoneNumber }],
                        text: message
                    }
                ]
            };

            const response = await axios.post(
                `${this.baseUrl}/sms/2/text/advanced`,
                payload,
                {
                    headers: {
                        'Authorization': `App ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            return {
                status: 'sent',
                messageId: response.data.messages[0]?.messageId
            };

        } catch (error) {
            console.error('Fraud alert SMS failed:', error.response?.data || error.message);
            throw error;
        }
    }

    async sendVoiceRegistrationConfirmation(user) {
        if (!this.isConfigured()) {
            console.log('SMS service not configured - would have sent voice registration confirmation');
            return { status: 'not_configured' };
        }

        try {
            const balance = parseFloat(user.fakeAccountBalance).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });

            let message = `🎙️ Voice Registration Complete - ${this.companyName}\n\n`;
            message += `Hi ${user.name}! Thanks for registering via voice.\n\n`;
            message += `📱 Your Demo Account:\n`;
            message += `• Account: ${user.fakeAccountNumber}\n`;
            message += `• Balance: ${balance}\n`;
            message += `• Company: ${user.companyName}\n\n`;
            message += `Call back anytime to try different banking scenarios!\n\n`;
            message += `🤖 Powered by Infobip Voice API + OpenAI`;

            const payload = {
                messages: [
                    {
                        from: this.fromNumber,
                        destinations: [{ to: user.phoneNumber }],
                        text: message
                    }
                ]
            };

            const response = await axios.post(
                `${this.baseUrl}/sms/2/text/advanced`,
                payload,
                {
                    headers: {
                        'Authorization': `App ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            return {
                status: 'sent',
                messageId: response.data.messages[0]?.messageId
            };

        } catch (error) {
            console.error('Voice registration SMS failed:', error.response?.data || error.message);
            throw error;
        }
    }
}

// Create singleton instance
const smsService = new SMSService();

module.exports = smsService;