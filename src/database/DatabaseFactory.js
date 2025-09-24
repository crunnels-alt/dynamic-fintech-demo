const SQLiteManager = require('./databaseManager');
const PostgreSQLManager = require('./PostgresManager');

class DatabaseFactory {
    static create() {
        const databaseUrl = process.env.DATABASE_URL;
        const environment = process.env.NODE_ENV || 'development';
        
        if (environment === 'production' && databaseUrl && databaseUrl.includes('postgres')) {
            console.log('🐘 Using PostgreSQL for production environment');
            return new PostgreSQLManager(databaseUrl);
        } else {
            console.log('🗂️  Using SQLite for development environment');
            return SQLiteManager;
        }
    }
}

module.exports = DatabaseFactory;