#!/usr/bin/env node

const PhoneNumberUtils = require('../src/utils/phoneUtils');

console.log('🔢 Testing North American Phone Number Standardization\n');

// Test cases with various input formats
const testCases = [
    // Valid 10-digit formats (using 212 - NYC area code)
    '2125551234',
    '212-555-1234',
    '212.555.1234',
    '212 555 1234',
    '(212) 555-1234',
    '(212)555-1234',
    
    // Valid 11-digit formats (with country code)
    '12125551234',
    '1-212-555-1234',
    '1.212.555.1234',
    '1 212 555 1234',
    '+1 212 555 1234',
    '+1-212-555-1234',
    '+1.212.555.1234',
    '+1(212)555-1234',
    '+1 (212) 555-1234',
    
    // Invalid formats (should fail)
    '212555123',      // Too short (9 digits)
    '212555123456',   // Too long (12 digits)
    '0125551234',     // Area code can't start with 0
    '1125551234',     // Area code can't start with 1  
    '2120551234',     // Exchange can't start with 0
    '2121551234',     // Exchange can't start with 1
    '4165551234',     // Valid Canadian (Toronto)
    '411',            // Directory assistance (too short)
    '911',            // Emergency (too short)
    '',               // Empty
    null,             // Null
    undefined,        // Undefined
];

console.log('📋 Testing individual phone numbers:\n');

testCases.forEach(phone => {
    const standardized = PhoneNumberUtils.standardizeNorthAmerican(phone);
    const isValid = PhoneNumberUtils.isValidNorthAmerican(standardized);
    const metadata = standardized ? PhoneNumberUtils.getMetadata(standardized) : null;
    
    console.log(`Input: ${phone || 'null/undefined'}`);
    console.log(`Standardized: ${standardized || 'null'}`);
    console.log(`Valid: ${isValid ? '✅' : '❌'}`);
    if (metadata) {
        console.log(`Display: ${metadata.formatted}`);
        console.log(`Region: ${metadata.region}`);
        console.log(`Type: ${metadata.type}`);
    }
    console.log('---');
});

console.log('\n🔄 Testing batch processing:\n');

const batchResults = PhoneNumberUtils.batchStandardize([
    '212-555-1234',
    '(416) 555-1234', // Toronto
    '1-312-555-1234', // Chicago
    'invalid-number',
    '555123'          // Too short
]);

batchResults.forEach(result => {
    console.log(`Original: ${result.original}`);
    console.log(`Standardized: ${result.standardized || 'FAILED'}`);
    console.log(`Valid: ${result.valid ? '✅' : '❌'}`);
    if (result.metadata) {
        console.log(`Region: ${result.metadata.region}`);
    }
    console.log('---');
});

console.log('\n📖 Example formats:\n');
const examples = PhoneNumberUtils.getExamples();
console.log('Valid input formats (all convert to E.164):');
const realExamples = [
    '(212) 555-1234',
    '212-555-1234',
    '212.555.1234',
    '212 555 1234',
    '2125551234',
    '1-212-555-1234',
    '+1-212-555-1234',
    '+1 (212) 555-1234'
];
realExamples.forEach(format => {
    const standardized = PhoneNumberUtils.standardizeNorthAmerican(format);
    console.log(`  ${format} → ${standardized}`);
});
console.log(`Display format: +1 (212) 555-1234\n`);

console.log('✅ Phone number standardization testing complete!');
console.log('\nThis utility will ensure all phone numbers are properly formatted');
console.log('for Infobip\'s APIs regardless of how users enter them.');