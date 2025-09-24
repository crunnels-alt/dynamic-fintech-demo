#!/usr/bin/env node

require('dotenv').config();
const databaseManager = require('../src/database/databaseManager');

async function setupDatabase() {
    try {
        console.log('Setting up fintech demo database...');
        
        await databaseManager.initialize();
        
        console.log('✅ Database setup complete!');
        console.log('📊 Database location:', databaseManager.dbPath);
        
        // Add some sample data for testing
        console.log('\n📝 Adding sample data...');
        
        const sampleUsers = [
            {
                phoneNumber: '+1234567890',
                name: 'John Demo',
                companyName: 'Tech Corp',
                fakeAccountBalance: 2500.75,
                loanApplicationStatus: 'Under Review',
                fraudScenario: false
            },
            {
                phoneNumber: '+1987654321',
                name: 'Jane Smith',
                companyName: 'Startup Inc',
                fakeAccountBalance: 15000.00,
                loanApplicationStatus: 'Approved',
                fraudScenario: true
            }
        ];

        for (const userData of sampleUsers) {
            try {
                await databaseManager.registerUser(userData);
                console.log(`✅ Added sample user: ${userData.name} (${userData.phoneNumber})`);
            } catch (error) {
                if (error.message.includes('already registered')) {
                    console.log(`ℹ️  User ${userData.name} already exists, skipping...`);
                } else {
                    console.error(`❌ Error adding ${userData.name}:`, error.message);
                }
            }
        }

        console.log('\n🎉 Database setup complete with sample data!');
        console.log('\nYou can now:');
        console.log('- Start the server with: npm start');
        console.log('- Test the demo scenarios with the sample phone numbers');
        console.log('- Register new users via the web form');
        
    } catch (error) {
        console.error('❌ Database setup failed:', error);
        process.exit(1);
    } finally {
        await databaseManager.close();
    }
}

// Run setup if called directly
if (require.main === module) {
    setupDatabase();
}

module.exports = setupDatabase;