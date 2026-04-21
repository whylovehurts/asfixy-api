/**
 * Security Utilities
 * HTML escaping, JS escaping, crypto functions, and encryption
 */

const crypto = require('crypto');

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Escape JavaScript string literals to prevent injection
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeJs(str = "") {
    return str.replace(/[\\'"<>&]/g, c => ({
        '\\': '\\\\', "'": "\\'", '"': '\\"',
        '<': '\\x3c', '>': '\\x3e', '&': '\\x26'
    }[c]));
}

/**
 * Generate HMAC-SHA256 signature for request validation
 * @param {string} message - Message to sign
 * @param {string} secret - Secret key
 * @returns {string} Hex-encoded signature
 */
function generateSignature(message, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 * @param {string} message - Original message
 * @param {string} signature - Signature to verify
 * @param {string} secret - Secret key
 * @returns {boolean} True if signature is valid
 */
function verifySignature(message, signature, secret) {
    const expected = generateSignature(message, secret);
    return expected === signature;
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} data - Data to encrypt
 * @param {string} encryptionKey - Encryption key (should be 32 bytes)
 * @returns {string} Encrypted data in format: iv:authTag:encryptedData
 */
function encryptData(data, encryptionKey) {
    if (!encryptionKey || encryptionKey.length < 32) {
        throw new Error('Encryption key must be at least 32 bytes');
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey.slice(0, 32), 'utf-8'), iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedData - Data in format: iv:authTag:encryptedData
 * @param {string} encryptionKey - Encryption key (should be 32 bytes)
 * @returns {string} Decrypted data
 */
function decryptData(encryptedData, encryptionKey) {
    if (!encryptionKey || encryptionKey.length < 32) {
        throw new Error('Encryption key must be at least 32 bytes');
    }
    
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey.slice(0, 32), 'utf-8'), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

/**
 * Generate a random cryptographic token
 * @param {number} length - Length in bytes (default: 32)
 * @returns {string} Hex-encoded random token
 */
function generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a random nonce for Content Security Policy
 * @returns {string} Base64-encoded random nonce
 */
function generateNonce() {
    return crypto.randomBytes(16).toString('base64');
}

module.exports = {
    escapeHtml,
    escapeJs,
    generateSignature,
    verifySignature,
    encryptData,
    decryptData,
    generateToken,
    generateNonce
};
