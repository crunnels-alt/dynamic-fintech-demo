const { Client, Pool } = require('pg');
const { randomUUID } = require('crypto');

// Fallback function for uuid generation
function generateUUID() {
    return randomUUID();
}

class PostgreSQLFinTechManager {
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.pool = null;
    }

    async initialize() {
        console.log('🐘 Initializing PostgreSQL connection...');

        this.pool = new Pool({
            connectionString: this.connectionString,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        // Test connection
        const client = await this.pool.connect();
        console.log('✅ Connected to PostgreSQL database');
        client.release();

        await this.createTables();
        console.log('✅ PostgreSQL database initialized successfully!');
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release();
            return true;
        } catch (error) {
            console.error('PostgreSQL connection test failed:', error);
            return false;
        }
    }

    async createTables() {
        const client = await this.pool.connect();
        
        try {
            const tables = [
                // Main users table with registration data
                `CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    phone_number VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    company_name VARCHAR(100) NOT NULL,
                    fake_account_balance DECIMAL(12,2) NOT NULL,
                    fake_account_number VARCHAR(50) UNIQUE NOT NULL,
                    loan_application_status VARCHAR(50) NOT NULL,
                    fraud_scenario BOOLEAN NOT NULL DEFAULT false,
                    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_call_at TIMESTAMP,
                    call_count INTEGER DEFAULT 0
                )`,

                // Fake loan applications table
                `CREATE TABLE IF NOT EXISTS loan_applications (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    loan_type VARCHAR(50) NOT NULL,
                    loan_amount DECIMAL(12,2) NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    next_step VARCHAR(200) NOT NULL,
                    assigned_officer VARCHAR(100) NOT NULL,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,

                // Fake transactions table
                `CREATE TABLE IF NOT EXISTS transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    transaction_id VARCHAR(50) UNIQUE NOT NULL,
                    description VARCHAR(200) NOT NULL,
                    amount DECIMAL(12,2) NOT NULL,
                    transaction_type VARCHAR(10) NOT NULL,
                    merchant VARCHAR(100),
                    category VARCHAR(50),
                    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,

                // Fake officers/agents table
                `CREATE TABLE IF NOT EXISTS officers (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    department VARCHAR(50) NOT NULL,
                    phone_number VARCHAR(20),
                    email VARCHAR(100),
                    specialization VARCHAR(50)
                )`,

                // Call logs for analytics
                `CREATE TABLE IF NOT EXISTS call_logs (
                    id SERIAL PRIMARY KEY,
                    phone_number VARCHAR(20) NOT NULL,
                    call_duration INTEGER,
                    scenario VARCHAR(100),
                    successful BOOLEAN DEFAULT true,
                    transcript TEXT,
                    called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`
            ];

            for (const tableSQL of tables) {
                await client.query(tableSQL);
            }

            // Insert default officers
            await this.insertDefaultOfficers(client);
            console.log('✅ PostgreSQL tables created successfully');
            
        } finally {
            client.release();
        }
    }

    async insertDefaultOfficers(client) {
        const officers = [
            {
                name: 'Sarah Johnson',
                department: 'Fraud Prevention',
                phone_number: '+15553728321',
                email: 'sarah.johnson@infobipCapital.demo',
                specialization: 'fraud_investigation'
            },
            {
                name: 'Michael Chen',
                department: 'Loan Services',
                phone_number: '+15555626767',
                email: 'michael.chen@infobipCapital.demo',
                specialization: 'personal_loans'
            },
            {
                name: 'Emily Rodriguez',
                department: 'Customer Service',
                phone_number: '+15554357000',
                email: 'emily.rodriguez@infobipCapital.demo',
                specialization: 'general_support'
            }
        ];

        for (const officer of officers) {
            await client.query(`
                INSERT INTO officers (name, department, phone_number, email, specialization) 
                VALUES ($1, $2, $3, $4, $5) 
                ON CONFLICT DO NOTHING`,
                [officer.name, officer.department, officer.phone_number, officer.email, officer.specialization]
            );
        }
    }

    // Register a new user from the web form
    async registerUser(userData) {
        const {
            phoneNumber,
            name,
            companyName,
            fakeAccountBalance,
            loanApplicationStatus,
            fraudScenario
        } = userData;

        // Generate unique account number
        const fakeAccountNumber = this.generateAccountNumber();

        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Insert user
            const userResult = await client.query(`
                INSERT INTO users (phone_number, name, company_name, fake_account_balance, 
                                 fake_account_number, loan_application_status, fraud_scenario) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) 
                RETURNING id`,
                [phoneNumber, name, companyName, fakeAccountBalance, fakeAccountNumber, 
                 loanApplicationStatus, fraudScenario]
            );
            
            const userId = userResult.rows[0].id;

            // Generate fake loan application if needed
            if (loanApplicationStatus !== 'None') {
                await this.createFakeLoanApplication(client, userId, loanApplicationStatus);
            }

            // Generate some fake transactions
            await this.generateFakeTransactions(client, userId);

            await client.query('COMMIT');

            // Return the complete user record
            const user = await this.getUserByPhone(phoneNumber);
            return user;
            
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') { // unique_violation
                throw new Error('Phone number already registered');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    // Get user by phone number (for caller identification)
    async getUserByPhone(phoneNumber) {
        const result = await this.pool.query(
            'SELECT * FROM users WHERE phone_number = $1',
            [phoneNumber]
        );

        const user = result.rows[0];
        if (!user) return null;

        // Map PostgreSQL field names to camelCase for compatibility
        return {
            id: user.id,
            phoneNumber: user.phone_number,
            name: user.name,
            companyName: user.company_name,
            fakeAccountBalance: user.fake_account_balance,
            fakeAccountNumber: user.fake_account_number,
            loanApplicationStatus: user.loan_application_status,
            fraudScenario: user.fraud_scenario,
            registeredAt: user.registered_at,
            lastCallAt: user.last_call_at,
            callCount: user.call_count || 0
        };
    }

    // Get user's loan applications
    async getUserLoanApplications(userId) {
        const result = await this.pool.query(
            'SELECT * FROM loan_applications WHERE user_id = $1',
            [userId]
        );

        // Map PostgreSQL snake_case fields to camelCase
        return result.rows.map(loan => ({
            id: loan.id,
            userId: loan.user_id,
            loanType: loan.loan_type,
            loanAmount: loan.loan_amount,
            status: loan.status,
            nextStep: loan.next_step,
            assignedOfficer: loan.assigned_officer,
            appliedAt: loan.applied_at
        }));
    }

    // Get user's transactions
    async getUserTransactions(userId, limit = 10) {
        const result = await this.pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_date DESC LIMIT $2',
            [userId, limit]
        );

        // Map PostgreSQL snake_case fields to camelCase
        return result.rows.map(transaction => ({
            id: transaction.id,
            userId: transaction.user_id,
            transactionId: transaction.transaction_id,
            description: transaction.description,
            amount: transaction.amount,
            transactionType: transaction.transaction_type,
            merchant: transaction.merchant,
            category: transaction.category,
            transactionDate: transaction.transaction_date
        }));
    }

    // Create a fake loan application
    async createFakeLoanApplication(client, userId, status) {
        const loanTypes = ['Personal Loan', 'Auto Loan', 'Home Mortgage', 'Business Loan'];
        const amounts = [5000, 15000, 25000, 50000, 100000, 250000];
        const nextSteps = {
            'Under Review': 'Document verification',
            'Approved': 'Fund disbursement',
            'Pending': 'Credit check completion',
            'Requires Documentation': 'Submit income verification'
        };

        const loanType = loanTypes[Math.floor(Math.random() * loanTypes.length)];
        const loanAmount = amounts[Math.floor(Math.random() * amounts.length)];
        const nextStep = nextSteps[status] || 'Contact loan officer';
        const assignedOfficer = 'Michael Chen';

        const result = await client.query(`
            INSERT INTO loan_applications (user_id, loan_type, loan_amount, status, next_step, assigned_officer)
            VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id`,
            [userId, loanType, loanAmount, status, nextStep, assignedOfficer]
        );
        
        return result.rows[0].id;
    }

    // Generate fake transactions for a user
    async generateFakeTransactions(client, userId, count = 5) {
        const merchants = [
            'Starbucks Coffee', 'Amazon.com', 'Shell Gas Station', 'Target Store',
            'McDonald\'s', 'Uber Ride', 'Netflix', 'Spotify', 'Whole Foods',
            'CVS Pharmacy', 'Home Depot', 'Best Buy', 'Costco Wholesale'
        ];
        
        const categories = [
            'Food & Dining', 'Shopping', 'Gas & Fuel', 'Entertainment',
            'Transportation', 'Groceries', 'Health & Fitness', 'Bills & Utilities'
        ];

        for (let i = 0; i < count; i++) {
            const merchant = merchants[Math.floor(Math.random() * merchants.length)];
            const category = categories[Math.floor(Math.random() * categories.length)];
            const amount = (Math.random() * 200 + 5).toFixed(2); // $5 to $205
            const transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            
            // Most transactions are debits, some are credits (refunds/deposits)
            const transactionType = Math.random() > 0.15 ? 'debit' : 'credit';
            const finalAmount = transactionType === 'debit' ? -Math.abs(amount) : Math.abs(amount);
            
            const transactionDate = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);

            await client.query(`
                INSERT INTO transactions (user_id, transaction_id, description, amount, 
                                        transaction_type, merchant, category, transaction_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [userId, transactionId, merchant, finalAmount, transactionType, 
                 merchant, category, transactionDate]
            );
        }
    }

    // Update user's call statistics
    async updateUserCallStats(phoneNumber) {
        const result = await this.pool.query(`
            UPDATE users 
            SET last_call_at = CURRENT_TIMESTAMP, call_count = call_count + 1 
            WHERE phone_number = $1`,
            [phoneNumber]
        );
        
        return result.rowCount;
    }

    // Log a call for analytics
    async logCall(phoneNumber, scenario, duration = null, successful = true, transcript = null) {
        const result = await this.pool.query(`
            INSERT INTO call_logs (phone_number, scenario, call_duration, successful, transcript)
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id`,
            [phoneNumber, scenario, duration, successful, transcript]
        );
        
        return result.rows[0].id;
    }

    // Generate a fake account number
    generateAccountNumber() {
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.random().toString().slice(2, 6);
        return `ACC${timestamp}${random}`;
    }

    // Get a random officer by specialization
    async getOfficerBySpecialization(specialization) {
        const result = await this.pool.query(
            'SELECT * FROM officers WHERE specialization = $1 ORDER BY RANDOM() LIMIT 1',
            [specialization]
        );

        const officer = result.rows[0];
        if (!officer) return null;

        // Map PostgreSQL snake_case fields to camelCase
        return {
            id: officer.id,
            name: officer.name,
            department: officer.department,
            phoneNumber: officer.phone_number,
            email: officer.email,
            specialization: officer.specialization
        };
    }

    // Close database connection
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('✅ PostgreSQL connection pool closed');
        }
    }
}

module.exports = PostgreSQLFinTechManager;