const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Import uuid using crypto.randomUUID (built-in Node.js)
const { randomUUID } = require('crypto');

// Fallback function for uuid generation
function generateUUID() {
    return randomUUID();
}

class FinTechDatabaseManager {
    constructor(dbPath = './data/fintech_demo.db') {
        this.dbPath = path.resolve(dbPath);
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            // Ensure the data directory exists
            const fs = require('fs');
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log(`Connected to SQLite database: ${this.dbPath}`);
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            // Main users table with registration data
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phoneNumber TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                companyName TEXT NOT NULL,
                fakeAccountBalance REAL NOT NULL,
                fakeAccountNumber TEXT UNIQUE NOT NULL,
                loanApplicationStatus TEXT NOT NULL,
                fraudScenario BOOLEAN NOT NULL DEFAULT 0,
                registeredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                lastCallAt DATETIME,
                callCount INTEGER DEFAULT 0
            )`,

            // Fake loan applications table
            `CREATE TABLE IF NOT EXISTS loan_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                loanType TEXT NOT NULL,
                loanAmount REAL NOT NULL,
                status TEXT NOT NULL,
                nextStep TEXT NOT NULL,
                assignedOfficer TEXT NOT NULL,
                appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users (id)
            )`,

            // Fake transactions table
            `CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                transactionId TEXT UNIQUE NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                transactionType TEXT NOT NULL, -- 'debit' or 'credit'
                merchant TEXT,
                category TEXT,
                transactionDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users (id)
            )`,

            // Fake officers/agents table
            `CREATE TABLE IF NOT EXISTS officers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                department TEXT NOT NULL,
                phoneNumber TEXT,
                email TEXT,
                specialization TEXT
            )`,

            // Call logs for analytics
            `CREATE TABLE IF NOT EXISTS call_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phoneNumber TEXT NOT NULL,
                callDuration INTEGER,
                scenario TEXT,
                successful BOOLEAN DEFAULT 1,
                transcript TEXT,
                calledAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const tableSQL of tables) {
            await new Promise((resolve, reject) => {
                this.db.run(tableSQL, (err) => {
                    if (err) {
                        console.error('Error creating table:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        }

        // Insert some default officers
        await this.insertDefaultOfficers();
        console.log('Database tables created successfully');
    }

    async insertDefaultOfficers() {
        const officers = [
            {
                name: 'Sarah Johnson',
                department: 'Fraud Prevention',
                phoneNumber: '+1-555-FRAUD',
                email: 'sarah.johnson@securebank.demo',
                specialization: 'fraud_investigation'
            },
            {
                name: 'Michael Chen',
                department: 'Loan Services',
                phoneNumber: '+1-555-LOANS',
                email: 'michael.chen@securebank.demo',
                specialization: 'personal_loans'
            },
            {
                name: 'Emily Rodriguez',
                department: 'Customer Service',
                phoneNumber: '+1-555-HELP',
                email: 'emily.rodriguez@securebank.demo',
                specialization: 'general_support'
            }
        ];

        for (const officer of officers) {
            await new Promise((resolve) => {
                this.db.run(
                    `INSERT OR IGNORE INTO officers (name, department, phoneNumber, email, specialization) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [officer.name, officer.department, officer.phoneNumber, officer.email, officer.specialization],
                    resolve
                );
            });
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

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO users (phoneNumber, name, companyName, fakeAccountBalance, fakeAccountNumber, 
                                  loanApplicationStatus, fraudScenario) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [phoneNumber, name, companyName, fakeAccountBalance, fakeAccountNumber, loanApplicationStatus, fraudScenario],
                async function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            reject(new Error('Phone number already registered'));
                        } else {
                            reject(err);
                        }
                    } else {
                        const userId = this.lastID;
                        
                        try {
                            // Generate fake loan application if needed
                            if (loanApplicationStatus !== 'None') {
                                await databaseManager.createFakeLoanApplication(userId, loanApplicationStatus);
                            }

                            // Generate some fake transactions
                            await databaseManager.generateFakeTransactions(userId);

                            const user = await databaseManager.getUserByPhone(phoneNumber);
                            resolve(user);
                        } catch (error) {
                            reject(error);
                        }
                    }
                }
            );
        });
    }

    // Get user by phone number (for caller identification)
    async getUserByPhone(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE phoneNumber = ?`,
                [phoneNumber],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || null);
                    }
                }
            );
        });
    }

    // Get user's loan applications
    async getUserLoanApplications(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM loan_applications WHERE userId = ?`,
                [userId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    // Get user's transactions
    async getUserTransactions(userId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM transactions WHERE userId = ? ORDER BY transactionDate DESC LIMIT ?`,
                [userId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    // Create a fake loan application
    async createFakeLoanApplication(userId, status) {
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

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO loan_applications (userId, loanType, loanAmount, status, nextStep, assignedOfficer)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, loanType, loanAmount, status, nextStep, assignedOfficer],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // Generate fake transactions for a user
    async generateFakeTransactions(userId, count = 5) {
        const merchants = [
            'Starbucks Coffee', 'Amazon.com', 'Shell Gas Station', 'Target Store',
            'McDonald\'s', 'Uber Ride', 'Netflix', 'Spotify', 'Whole Foods',
            'CVS Pharmacy', 'Home Depot', 'Best Buy', 'Costco Wholesale'
        ];
        
        const categories = [
            'Food & Dining', 'Shopping', 'Gas & Fuel', 'Entertainment',
            'Transportation', 'Groceries', 'Health & Fitness', 'Bills & Utilities'
        ];

        const transactions = [];
        for (let i = 0; i < count; i++) {
            const merchant = merchants[Math.floor(Math.random() * merchants.length)];
            const category = categories[Math.floor(Math.random() * categories.length)];
            const amount = (Math.random() * 200 + 5).toFixed(2); // $5 to $205
            const transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            
            // Most transactions are debits, some are credits (refunds/deposits)
            const transactionType = Math.random() > 0.15 ? 'debit' : 'credit';
            const finalAmount = transactionType === 'debit' ? -Math.abs(amount) : Math.abs(amount);

            const transaction = {
                userId,
                transactionId,
                description: merchant,
                amount: finalAmount,
                transactionType,
                merchant,
                category,
                transactionDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
            };

            transactions.push(transaction);
        }

        for (const transaction of transactions) {
            await new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT INTO transactions (userId, transactionId, description, amount, transactionType, 
                                             merchant, category, transactionDate)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [transaction.userId, transaction.transactionId, transaction.description,
                     transaction.amount, transaction.transactionType, transaction.merchant,
                     transaction.category, transaction.transactionDate],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        return transactions;
    }

    // Update user's call statistics
    async updateUserCallStats(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE users SET lastCallAt = CURRENT_TIMESTAMP, callCount = callCount + 1 
                 WHERE phoneNumber = ?`,
                [phoneNumber],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.changes);
                    }
                }
            );
        });
    }

    // Log a call for analytics
    async logCall(phoneNumber, scenario, duration = null, successful = true, transcript = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO call_logs (phoneNumber, scenario, callDuration, successful, transcript)
                 VALUES (?, ?, ?, ?, ?)`,
                [phoneNumber, scenario, duration, successful, transcript],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    // Generate a fake account number
    generateAccountNumber() {
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.random().toString().slice(2, 6);
        return `ACC${timestamp}${random}`;
    }

    // Get a random officer by specialization
    async getOfficerBySpecialization(specialization) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM officers WHERE specialization = ? ORDER BY RANDOM() LIMIT 1`,
                [specialization],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }

    // Close database connection
    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// Create a singleton instance
const databaseManager = new FinTechDatabaseManager(process.env.DATABASE_PATH);

module.exports = databaseManager;