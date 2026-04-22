/**
 * Routes Index
 * Registers all route modules with Fastify
 */
const adminRoutes = require('./admin');
const publicRoutes = require('./public');
const authRoutes = require('./auth');
const engineRoutes = require('./engine');
const farmRoutes = require('./farm');

function registerRoutes(fastify, opts, done) {
    // Admin routes
    fastify.get('/admin', adminRoutes.adminPageRoute);
    fastify.post('/admin/ban', adminRoutes.adminBanRoute);
    fastify.post('/admin/unban', adminRoutes.adminUnbanRoute);
    fastify.post('/admin/bulk-create', adminRoutes.adminBulkCreateRoute);
    fastify.post('/admin/bulk-delete', adminRoutes.adminBulkDeleteRoute);
    fastify.post('/admin/reset-ip', adminRoutes.adminResetIpRoute);
    fastify.post('/admin/edit-full', adminRoutes.adminEditFullRoute);
    fastify.post('/admin/revoke-key', adminRoutes.adminRevokeKeyRoute);
    fastify.post('/admin/create-key', adminRoutes.adminCreateKeyRoute);

    // Public routes
    fastify.get('/', publicRoutes.homeRoute);
    fastify.get('/download', publicRoutes.downloadRoute);
    fastify.get('/key-info/:key', publicRoutes.keyInfoRoute);
    fastify.get('/status', publicRoutes.statusRoute);
    fastify.get('/script.js', publicRoutes.scriptRoute);

    // Auth routes
    fastify.get('/get-key', authRoutes.getKeyRoute);
    fastify.get('/redeem', authRoutes.redeemPageRoute);
    fastify.post('/redeem-key', authRoutes.redeemKeyRoute);

    // Engine routes
    fastify.get('/engine', engineRoutes.enginePageRoute);
    fastify.get('/engine/pull', engineRoutes.enginePullRoute);
    fastify.get('/engine/status', engineRoutes.engineStatusRoute);
    fastify.get('/engine/logs', engineRoutes.engineLogsRoute);
    fastify.post('/engine/execute', engineRoutes.engineExecuteRoute);

    // Farm routes
    fastify.post('/update-farm', farmRoutes.updateFarmRoute);

    done();
}

module.exports = registerRoutes;