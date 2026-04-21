/**
 * Security Headers Middleware
 * CSP nonce generation, HSTS headers, etc.
 */

const { generateNonce } = require('../lib/security');
const { IS_PROD } = require('../config/env');

/**
 * Add security headers and CSP nonce to each request
 */
async function securityHeadersHook(fastify) {
    // Generate nonce and patch CSP header on every request
    fastify.addHook('onRequest', async (req, reply) => {
        const nonce = generateNonce();
        req.nonce = nonce;
        
        // Set CSP with nonce-based script loading
        reply.header(
            'Content-Security-Policy',
            `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'`
        );
        
        // HSTS header (only in production with HTTPS)
        if (IS_PROD) {
            reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }
        
        // Additional security headers
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('X-XSS-Protection', '1; mode=block');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    });
}

module.exports = {
    securityHeadersHook
};
