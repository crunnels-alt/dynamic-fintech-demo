/**
 * North American Phone Number Standardization Utility
 * Handles various input formats and converts them to E.164 format for Infobip APIs
 */

class PhoneNumberUtils {
    
    /**
     * Standardize North American phone numbers to E.164 format (+1XXXXXXXXXX)
     * Handles various input formats:
     * - (555) 123-4567
     * - 555-123-4567
     * - 555.123.4567
     * - 555 123 4567
     * - 5551234567
     * - 1-555-123-4567
     * - +1-555-123-4567
     * - +1 (555) 123-4567
     * @param {string} phoneNumber - Raw phone number input
     * @returns {string|null} - Standardized E.164 format or null if invalid
     */
    static standardizeNorthAmerican(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return null;
        }

        // Remove all non-digit characters except +
        let cleaned = phoneNumber.replace(/[^\d+]/g, '');
        
        // Remove leading + if present
        if (cleaned.startsWith('+')) {
            cleaned = cleaned.substring(1);
        }

        // Handle different scenarios
        if (cleaned.length === 10) {
            // 10 digits: assume US/Canada number without country code
            // Example: 5551234567 -> +15551234567
            return `+1${cleaned}`;
            
        } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
            // 11 digits starting with 1: US/Canada with country code
            // Example: 15551234567 -> +15551234567
            return `+${cleaned}`;
            
        } else if (cleaned.length === 7) {
            // 7 digits: local number, invalid for our purposes
            console.warn(`Phone number too short (7 digits): ${phoneNumber}`);
            return null;
            
        } else {
            // Invalid length
            console.warn(`Invalid phone number length: ${phoneNumber} (${cleaned.length} digits)`);
            return null;
        }
    }

    /**
     * Validate that a phone number is a valid North American number
     * @param {string} phoneNumber - E.164 formatted phone number
     * @returns {boolean} - True if valid North American number
     */
    static isValidNorthAmerican(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return false;
        }

        // Must be E.164 format: +1 followed by 10 digits
        const e164Regex = /^\+1[2-9]\d{2}[2-9]\d{2}\d{4}$/;
        
        if (!e164Regex.test(phoneNumber)) {
            return false;
        }

        // Extract area code and exchange code for additional validation
        const areaCode = phoneNumber.substring(2, 5);
        const exchangeCode = phoneNumber.substring(5, 8);

        // Area code cannot start with 0 or 1
        if (areaCode.startsWith('0') || areaCode.startsWith('1')) {
            return false;
        }

        // Exchange code cannot start with 0 or 1
        if (exchangeCode.startsWith('0') || exchangeCode.startsWith('1')) {
            return false;
        }

        // Additional validation for known invalid ranges
        const invalidAreaCodes = ['800', '888', '877', '866', '855', '844', '833', '822'];
        if (invalidAreaCodes.includes(areaCode)) {
            // These are toll-free numbers, might be valid but flagged for attention
            console.info(`Toll-free number detected: ${phoneNumber}`);
        }

        return true;
    }

    /**
     * Format phone number for display purposes
     * @param {string} phoneNumber - E.164 formatted phone number
     * @returns {string} - Human readable format: +1 (555) 123-4567
     */
    static formatForDisplay(phoneNumber) {
        if (!phoneNumber || !this.isValidNorthAmerican(phoneNumber)) {
            return phoneNumber || '';
        }

        // Extract parts: +1AAABBBCCCC -> +1 (AAA) BBB-CCCC
        const countryCode = phoneNumber.substring(0, 2);  // +1
        const areaCode = phoneNumber.substring(2, 5);     // AAA
        const exchange = phoneNumber.substring(5, 8);     // BBB
        const number = phoneNumber.substring(8, 12);      // CCCC

        return `${countryCode} (${areaCode}) ${exchange}-${number}`;
    }

    /**
     * Get phone number metadata
     * @param {string} phoneNumber - E.164 formatted phone number
     * @returns {object} - Metadata about the phone number
     */
    static getMetadata(phoneNumber) {
        if (!this.isValidNorthAmerican(phoneNumber)) {
            return {
                valid: false,
                country: null,
                region: null,
                type: null
            };
        }

        const areaCode = phoneNumber.substring(2, 5);
        
        // Simplified region mapping (you could expand this with a comprehensive database)
        const regionMapping = {
            '212': 'New York, NY',
            '213': 'Los Angeles, CA',
            '312': 'Chicago, IL',
            '415': 'San Francisco, CA',
            '617': 'Boston, MA',
            '202': 'Washington, DC',
            '404': 'Atlanta, GA',
            '305': 'Miami, FL',
            '713': 'Houston, TX',
            '206': 'Seattle, WA',
            '416': 'Toronto, ON',
            '514': 'Montreal, QC',
            '604': 'Vancouver, BC'
        };

        return {
            valid: true,
            country: 'US/Canada',
            countryCode: '+1',
            areaCode: areaCode,
            region: regionMapping[areaCode] || 'North America',
            formatted: this.formatForDisplay(phoneNumber),
            type: this.getNumberType(areaCode)
        };
    }

    /**
     * Determine number type based on area code
     * @param {string} areaCode - 3-digit area code
     * @returns {string} - Number type
     */
    static getNumberType(areaCode) {
        const tollFree = ['800', '888', '877', '866', '855', '844', '833', '822'];
        const canadian = ['403', '587', '780', '825', '236', '250', '604', '778', '204', '431', '506', '709', '902', '782', '226', '249', '289', '343', '365', '416', '437', '647', '705', '807', '905', '613', '819', '873', '418', '438', '450', '514', '579', '581', '367', '306', '639', '867'];
        
        if (tollFree.includes(areaCode)) {
            return 'toll-free';
        } else if (canadian.includes(areaCode)) {
            return 'canadian';
        } else {
            return 'us-mobile-or-landline';
        }
    }

    /**
     * Batch standardize multiple phone numbers
     * @param {string[]} phoneNumbers - Array of phone numbers to standardize
     * @returns {object[]} - Array of results with original and standardized numbers
     */
    static batchStandardize(phoneNumbers) {
        if (!Array.isArray(phoneNumbers)) {
            return [];
        }

        return phoneNumbers.map(phone => {
            const standardized = this.standardizeNorthAmerican(phone);
            return {
                original: phone,
                standardized: standardized,
                valid: this.isValidNorthAmerican(standardized),
                metadata: standardized ? this.getMetadata(standardized) : null
            };
        });
    }

    /**
     * Generate example phone numbers for testing
     * @returns {object} - Examples in various formats
     */
    static getExamples() {
        return {
            validFormats: [
                '(555) 123-4567',
                '555-123-4567',
                '555.123.4567',
                '555 123 4567',
                '5551234567',
                '1-555-123-4567',
                '+1-555-123-4567',
                '+1 (555) 123-4567',
                '+15551234567'
            ],
            expectedOutput: '+15551234567',
            displayFormat: '+1 (555) 123-4567'
        };
    }
}

module.exports = PhoneNumberUtils;