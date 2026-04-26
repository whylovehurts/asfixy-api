/**
 * Constants and Magic Numbers
 */

module.exports = {
    // Key expiration duration (12 hours)
    DURACAO_KEY: 12 * 60 * 60 * 1000,

    // Rate limiting configurations
    RATE_LIMITS: {
        GLOBAL: { max: 100, timeWindow: '1 minute' },
        REDEEM_KEY: { max: 5, timeWindow: '1 minute' },
        UPDATE_FARM: { max: 10, timeWindow: '10 seconds' },
        ENGINE_EXECUTE: { max: 20, timeWindow: '1 minute' },
        GET_KEY: { max: 10, timeWindow: '1 minute' }
    },

    // Engine cooldown in milliseconds
    ENGINE_COOLDOWN_MS: 3000,
    FARM_UPDATE_COOLDOWN_MS: 3000,

    // Extension connection timeout
    ENGINE_PING_TIMEOUT_MS: 5000,

    // Public paths that don't require authentication
    PUBLIC_PATHS: [
        '/get-key',
        '/redeem',
        '/redeem-key',
        '/admin',
        '/download',
        '/key-info',
        '/engine/status',
        '/engine/pull',
        '/engine/execute',
        '/script',
        '/log'
    ],

    // Allowed CORS origins
    ALLOWED_ORIGINS: [
        'http://127.0.0.1:3000',
        'http://localhost:3000',
        'https://asfixy.up.railway.app/',
        'https://orteil.dashnet.org'
    ]
};
