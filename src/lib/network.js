/**
 * Network and IP Utilities
 */

/**
 * Get client IP from request, checking X-Forwarded-For header
 * Validates against trusted proxies in production
 * @param {object} request - Fastify request object
 * @returns {string} Client IP address
 */
function getClientIp(request) {
    // Check X-Forwarded-For header (from trusted proxies)
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (xForwardedFor) {
        // Take first IP in the chain
        const ips = xForwardedFor.split(',').map(ip => ip.trim());
        if (ips.length > 0 && ips[0]) {
            return ips[0];
        }
    }
    
    // Fall back to request.ip
    return request.ip;
}

/**
 * Validate IP address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid IP format
 */
function isValidIp(ip) {
    if (!ip || typeof ip !== 'string') return false;
    
    // Simple IPv4 validation
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Regex.test(ip)) return true;
    
    // Simple IPv6 validation (basic)
    if (ip.includes(':')) return true;
    
    return false;
}

module.exports = {
    getClientIp,
    isValidIp
};
