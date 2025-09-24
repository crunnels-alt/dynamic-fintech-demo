#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function migrateDatabase() {
  log('🚂 Railway Database Migration Started', colors.cyan);
  
  try {
    const DatabaseFactory = require('../src/database/DatabaseFactory');
    const databaseManager = DatabaseFactory.create();
    
    await databaseManager.initialize();
    log('✅ Database migration completed successfully!', colors.green);
    
  } catch (error) {
    log(`❌ Database migration failed: ${error.message}`, colors.red);
    throw error;
  }
}

async function migrateToPostgreSQL(dbUrl) {
  try {
    log('🔄 Setting up PostgreSQL schema...', colors.blue);
    
    // For now, we'll check if pg is available, if not, provide instructions
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: dbUrl });
      
      await client.connect();
      log('✅ Connected to PostgreSQL', colors.green);
      
      // Create tables with PostgreSQL syntax
      const tables = [
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
        
        `CREATE TABLE IF NOT EXISTS loan_applications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          loan_type VARCHAR(50) NOT NULL,
          loan_amount DECIMAL(12,2) NOT NULL,
          status VARCHAR(50) NOT NULL,
          next_step VARCHAR(200) NOT NULL,
          assigned_officer VARCHAR(100) NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS transactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          transaction_id VARCHAR(50) UNIQUE NOT NULL,
          description VARCHAR(200) NOT NULL,
          amount DECIMAL(12,2) NOT NULL,
          transaction_type VARCHAR(10) NOT NULL,
          merchant VARCHAR(100),
          category VARCHAR(50),
          transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS officers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          department VARCHAR(50) NOT NULL,
          phone_number VARCHAR(20),
          email VARCHAR(100),
          specialization VARCHAR(50)
        )`,
        
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
      
      for (const table of tables) {
        await client.query(table);
        log(`✅ Table created/verified`, colors.green);
      }
      
      // Insert default officers
      await insertDefaultOfficersPostgreSQL(client);
      
      await client.end();
      log('🎉 PostgreSQL migration completed successfully!', colors.green);
      
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        log('⚠️  PostgreSQL adapter not installed', colors.yellow);
        log('📦 Installing pg dependency...', colors.blue);
        
        const { execSync } = require('child_process');
        execSync('npm install pg', { stdio: 'inherit' });
        
        log('✅ PostgreSQL adapter installed, please restart', colors.green);
        process.exit(1);
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    log(`❌ PostgreSQL migration failed: ${error.message}`, colors.red);
    log('🔄 Falling back to SQLite...', colors.yellow);
    await initializeSQLite();
  }
}

async function insertDefaultOfficersPostgreSQL(client) {
  const officers = [
    {
      name: 'Sarah Johnson',
      department: 'Fraud Prevention',
      phone_number: '+1-555-FRAUD',
      email: 'sarah.johnson@securebank.demo',
      specialization: 'fraud_investigation'
    },
    {
      name: 'Michael Chen', 
      department: 'Loan Services',
      phone_number: '+1-555-LOANS',
      email: 'michael.chen@securebank.demo',
      specialization: 'personal_loans'
    },
    {
      name: 'Emily Rodriguez',
      department: 'Customer Service',
      phone_number: '+1-555-HELP', 
      email: 'emily.rodriguez@securebank.demo',
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
  
  log('✅ Default officers inserted', colors.green);
}

async function initializeSQLite() {
  try {
    log('📂 Initializing SQLite database...', colors.blue);
    
    const databaseManager = require('../src/database/databaseManager');
    await databaseManager.initialize();
    
    log('✅ SQLite database initialized successfully!', colors.green);
    
  } catch (error) {
    log(`❌ SQLite initialization failed: ${error.message}`, colors.red);
    throw error;
  }
}

async function main() {
  try {
    await migrateDatabase();
    log('🎯 Database migration completed successfully!', colors.green);
  } catch (error) {
    log(`💥 Migration failed: ${error.message}`, colors.red);
    process.exit(1);
  }
}

// Only run if called directly
if (require.main === module) {
  main();
}

module.exports = { migrateDatabase };