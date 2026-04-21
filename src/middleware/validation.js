/**
 * Input Validation Middleware
 * Zod schemas and NoSQL sanitization
 */

const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');

/**
 * Strip ALL HTML tags - returns plain text only
 */
function stripHtml(value) {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

/**
 * NoSQL Sanitizer: strips MongoDB operators from all user input
 */
function sanitizeInput(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) {
            delete obj[key];
        } else {
            sanitizeInput(obj[key]);
        }
    }
}

// --- ZOD VALIDATION SCHEMAS ---

const keyHeaderSchema = z.object({
    'x-asfixy-key': z.string().min(1).max(100).regex(/^[\w\-\.]+$/, 'Invalid key format')
}).passthrough();

const redeemBodySchema = z.object({
    key: z.string().min(1).max(100).regex(/^[\w\-\.]+$/, 'Invalid key format')
});

const updateFarmBodySchema = z.object({
    bakeryName: z.string().min(1).max(50).transform(stripHtml),
    cookies: z.number().finite().optional(),
    prestige: z.number().finite().optional(),
    cookiesPs: z.number().optional(),
    version: z.string().max(20).transform(stripHtml).optional(),
    gameVersion: z.string().max(20).transform(stripHtml).optional(),
    saveKey: z.string().max(100000).optional()
});

const engineExecuteSchema = z.object({
    code: z.string().min(1).max(5000)
});

module.exports = {
    stripHtml,
    sanitizeInput,
    keyHeaderSchema,
    redeemBodySchema,
    updateFarmBodySchema,
    engineExecuteSchema
};
