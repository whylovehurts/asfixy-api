/**
 * Engine State Management
 * Manages in-memory state for cookie clicker automation
 * CRITICAL SECURITY: Only whitelist safe game API calls
 */

const ENGINE_STATE = {};

/**
 * Safe Game API Commands (Whitelist)
 * Only these actions are allowed in code execution
 */
const SAFE_GAME_COMMANDS = {
    'click': { desc: 'Click grandma', args: [] },
    'buy_building': { desc: 'Buy building', args: ['building_id'] },
    'buy_upgrade': { desc: 'Buy upgrade', args: ['upgrade_id'] },
    'toggle_autoclick': { desc: 'Toggle autoclick', args: [] },
    'ascend': { desc: 'Ascend', args: [] }
};

/**
 * Parse and validate code as JSON command list
 * Rejects anything not in whitelist
 * @param {string} code - Code string (JSON array format)
 * @returns {array} Validated commands or throws error
 */
function parseGameCode(code) {
    try {
        const parsed = JSON.parse(code);
        if (!Array.isArray(parsed)) {
            throw new Error('Code must be JSON array of commands');
        }
        
        // Validate each command
        for (const cmd of parsed) {
            if (!cmd.action || typeof cmd.action !== 'string') {
                throw new Error('Each command must have an "action" field');
            }
            
            if (!SAFE_GAME_COMMANDS[cmd.action]) {
                throw new Error(`Command "${cmd.action}" is not allowed. Allowed: ${Object.keys(SAFE_GAME_COMMANDS).join(', ')}`);
            }
        }
        
        return parsed;
    } catch (e) {
        throw new Error(`Invalid code format: ${e.message}`);
    }
}

/**
 * Initialize engine state for a key
 */
function initializeEngine(key) {
    if (!ENGINE_STATE[key]) {
        ENGINE_STATE[key] = {
            code: null,
            lastPing: Date.now(),
            lastExecute: 0,
            updatedAt: 0,
            history: []
        };
    }
}

/**
 * Get engine state
 */
function getEngineState(key) {
    return ENGINE_STATE[key];
}

/**
 * Update engine state with new code
 */
function setEngineCode(key, code) {
    initializeEngine(key);
    ENGINE_STATE[key].code = code;
    ENGINE_STATE[key].updatedAt = Date.now();
    ENGINE_STATE[key].lastExecute = Date.now();
}

/**
 * Update engine ping (extension connection)
 */
function updateEnginePing(key) {
    initializeEngine(key);
    ENGINE_STATE[key].lastPing = Date.now();
}

/**
 * Check if engine is connected (extension has pinged recently)
 */
function isEngineConnected(key, timeoutMs) {
    const state = ENGINE_STATE[key];
    if (!state || !state.lastPing) return false;
    return Date.now() - state.lastPing < timeoutMs;
}

/**
 * Add execution to history for rate limiting
 */
function recordExecution(key) {
    initializeEngine(key);
    const now = Date.now();
    ENGINE_STATE[key].history = ENGINE_STATE[key].history.filter(t => now - t < 60000);
    ENGINE_STATE[key].history.push(now);
}

/**
 * Get execution count in last minute
 */
function getExecutionCount(key) {
    const state = ENGINE_STATE[key];
    if (!state || !state.history) return 0;
    const now = Date.now();
    return state.history.filter(t => now - t < 60000).length;
}

/**
 * Clear engine state for a key (on disconnect/logout)
 */
function clearEngineState(key) {
    delete ENGINE_STATE[key];
}

module.exports = {
    ENGINE_STATE,
    SAFE_GAME_COMMANDS,
    parseGameCode,
    initializeEngine,
    getEngineState,
    setEngineCode,
    updateEnginePing,
    isEngineConnected,
    recordExecution,
    getExecutionCount,
    clearEngineState
};
