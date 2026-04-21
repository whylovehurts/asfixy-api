/**
 * Environment Configuration
 * Validates and exports environment variables with proper defaults
 */

require('dotenv').config();

// --- REQUIRED ENV VALIDATION ---
const REQUIRED_ENV = ['SIGN_SECRET', 'MONGO_URI', 'DEV_KEY', 'ADMIN_SECRET'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`[FATAL] Missing required environment variable: ${key}. Halting.`);
        process.exit(1);
    }
}

module.exports = {
    SIGN_SECRET: process.env.SIGN_SECRET,
    MONGO_URI: process.env.MONGO_URI,
    MASTER_KEY: process.env.DEV_KEY,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_PROD: process.env.NODE_ENV === 'production',
    PORT: process.env.PORT || 3000,
    // Security encryption key for save keys
    SAVE_ENCRYPTION_KEY: process.env.SAVE_ENCRYPTION_KEY || null
};
