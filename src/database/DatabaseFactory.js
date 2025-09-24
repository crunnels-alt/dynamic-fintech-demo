const SQLiteManager = require('./databaseManager');
const PostgreSQLManager = require('./PostgresManager');

class DatabaseFactory {
    static create() {
        const databaseUrl = process.env.DATABASE_URL;
        const environment = process.env.NODE_ENV || 'development';
        
        console.log('🔍 DatabaseFactory Debug:');
        console.log('   DATABASE_URL exists:', !!databaseUrl);
        console.log('   DATABASE_URL contains postgres:', databaseUrl ? databaseUrl.includes('postgres') : 'N/A');
        console.log('   NODE_ENV:', environment);
        console.log('   Production check:', environment === 'production');
        
        if (databaseUrl && databaseUrl.includes('postgres')) {
            console.log('🐘 Using PostgreSQL database');
            return new PostgreSQLManager(databaseUrl);
        } else {
            console.log('🗂️  Using SQLite for development environment');
            return SQLiteManager;
        }
    }
}

module.exports = DatabaseFactory;