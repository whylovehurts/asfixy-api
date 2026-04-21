/**
 * MongoDB Database Configuration
 * Handles connection setup and index management
 */

const mongoose = require('mongoose');
const env = require('./env');

async function connectDatabase() {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log("💉 Abyss Connection Active");

        // Remove old IP unique index (allows multiple keys with ip: "MANUAL")
        try {
            await mongoose.connection.db.collection('keys').dropIndex('ip_1');
            console.log("🗑️ Dropped old ip_1 unique index");
        } catch (e) {
            if (e.codeName !== 'IndexNotFound') {
                console.log("Index ip_1 not found or already dropped");
            }
        }

        return mongoose.connection;
    } catch (error) {
        console.error("[FATAL] Database connection failed:", error.message);
        process.exit(1);
    }
}

module.exports = {
    connectDatabase,
    mongoose
};
