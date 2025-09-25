const SQLiteManager = require('./databaseManager');
const PostgreSQLManager = require('./PostgresManager');

// Singleton instance
let sharedInstance = null;

class DatabaseFactory {
    static create() {
        // Return the shared instance if it already exists
        if (sharedInstance) {
            return sharedInstance;
        }
        
        const databaseUrl = process.env.DATABASE_URL;
        const environment = process.env.NODE_ENV || 'development';
        
        console.log('🔍 DatabaseFactory Debug:');
        console.log('   DATABASE_URL exists:', !!databaseUrl);
        console.log('   DATABASE_URL value:', databaseUrl ? databaseUrl.substring(0, 20) + '...' : 'undefined');
        console.log('   DATABASE_URL contains postgres:', databaseUrl ? databaseUrl.includes('postgres') : 'N/A');
        console.log('   NODE_ENV:', environment);
        console.log('   Production check:', environment === 'production');
        console.log('   All env vars count:', Object.keys(process.env).length);
        
        if (databaseUrl && databaseUrl.includes('postgres')) {
            console.log('🐘 Using PostgreSQL database');
            sharedInstance = new PostgreSQLManager(databaseUrl);
        } else {
            console.log('🗂️  Using SQLite for development environment');
            sharedInstance = SQLiteManager;
        }
        
        return sharedInstance;
    }
}

module.exports = DatabaseFactory;
