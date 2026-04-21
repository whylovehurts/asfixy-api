/**
 * Structured Logger
 * Provides colored console output and log formatting
 */

/**
 * Log levels with ANSI colors
 */
const LEVELS = {
    error: '\x1b[31m',    // Red
    warn: '\x1b[33m',     // Yellow
    success: '\x1b[32m',  // Green
    info: '\x1b[36m',     // Cyan
    reset: '\x1b[0m'      // Reset
};

/**
 * Format and log a message
 * @param {string} type - Log level (error, warn, success, info)
 * @param {string} message - Message to log
 * @param {any} context - Additional context (key, IP, etc.)
 */
function log(type, message, context = '') {
    const color = LEVELS[type] || LEVELS.info;
    const tag = `[${type.toUpperCase()}]`;
    const contextStr = context ? ` [${context}]` : '';
    console.log(`${color}${tag}${LEVELS.reset}${contextStr} ${message}`);
}

/**
 * Log an error
 */
function error(message, context) {
    log('error', message, context);
}

/**
 * Log a warning
 */
function warn(message, context) {
    log('warn', message, context);
}

/**
 * Log success
 */
function success(message, context) {
    log('success', message, context);
}

/**
 * Log info
 */
function info(message, context) {
    log('info', message, context);
}

module.exports = {
    log,
    error,
    warn,
    success,
    info
};
