const KeyModel = require('../models/Key');

module.exports = async (request, reply) => {
    const path = request.routerPath || request.url.toLowerCase();
    const rotasPublicas = ['/get-key', '/redeem-key', '/admin', '/download', '/script/'];
    
    // Libera rotas públicas
    if (rotasPublicas.some(route => path.includes(route))) return;

    const MASTER_KEY = process.env.DEV_KEY;
    const userKey = request.query.key || request.headers['x-asfixy-key'];
    
    if (userKey === MASTER_KEY) return;

    const keyDoc = await KeyModel.findOne({ key: userKey });
    
    if (!keyDoc) {
        return reply.code(401).send({ error: "Unauthorized", message: "Invalid or expired key." });
    }

    if (keyDoc.ip === "MANUAL") {
        return reply.code(403).send({ error: "Forbidden", message: "Key not redeemed. Lock your IP via /redeem-key first." });
    }

    if (keyDoc.ip !== request.ip) {
        return reply.code(401).send({ error: "Unauthorized", message: "Hardware ID/IP mismatch. Key is locked to another device." });
    }
};