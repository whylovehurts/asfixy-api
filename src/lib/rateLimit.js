/**
 * Rate Limiter
 * In-memory rate limiting with automatic cleanup
 */

const RL = new Map();
const CLEANUP_INTERVAL = 60000; // Clean up old entries every minute

// Periodic cleanup to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of RL.entries()) {
        // Remove entry if no recent activity (older than 2 minutes)
        if (timestamps.length === 0 || (now - timestamps[timestamps.length - 1] > 120000)) {
            RL.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

/**
 * Check if request should be rate limited
 * @param {string} identifier - Unique identifier (IP, key, etc.)
 * @param {number} limit - Max requests allowed
 * @param {number} ms - Time window in milliseconds
 * @returns {boolean} True if request is allowed, false if rate limited
 */
function rateLimit(identifier, limit, ms) {
    const now = Date.now();
    const data = RL.get(identifier) || [];

    // Filter out old timestamps (outside time window)
    const fresh = data.filter(t => now - t < ms);

    if (fresh.length >= limit) {
        return false;
    }

    fresh.push(now);
    RL.set(identifier, fresh);

    return true;
}

/**
 * Reset rate limit for an identifier
 * @param {string} identifier - Unique identifier
 */
function resetRateLimit(identifier) {
    RL.delete(identifier);
}

/**
 * Get rate limit stats for debugging
 * @param {string} identifier - Unique identifier
 * @returns {object} Rate limit info
 */
function getRateLimitStats(identifier) {
    const timestamps = RL.get(identifier) || [];
    return {
        identifier,
        count: timestamps.length,
        timestamps
    };
}

module.exports = {
    rateLimit,
    resetRateLimit,
    getRateLimitStats
};
