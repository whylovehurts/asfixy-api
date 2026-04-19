const KeyModel = require('../models/Key');
const { gerarKeyAsfixy, DURACAO_KEY } = require('../utils/helpers');

module.exports = async function (fastify, opts) {
    const MASTER_KEY = process.env.DEV_KEY;

    fastify.get('/get-key', async (request, reply) => {
        const userIp = request.ip;
        let keyDoc = await KeyModel.findOne({ ip: userIp });
        if (keyDoc) {
            const restanteMs = DURACAO_KEY - (Date.now() - keyDoc.createdAt.getTime());
            return { key: keyDoc.key, expires_in_min: Math.round(restanteMs / 60000) };
        }
        const newKey = gerarKeyAsfixy();
        keyDoc = await KeyModel.create({ ip: userIp, key: newKey });
        return { key: newKey, status: "created" };
    });

    fastify.post('/redeem-key', async (request, reply) => {
        const { key } = request.body;
        const userIp = request.ip;
        
        if (key === MASTER_KEY) return { valid: true };

        const keyDoc = await KeyModel.findOne({ key: key });
        if (!keyDoc) return { valid: false, reason: "Key does not exist." };

        if (keyDoc.ip === "MANUAL") {
            await KeyModel.updateOne({ key: key }, { ip: userIp });
            return { valid: true, message: "Key redeemed and locked to your IP." };
        }

        if (keyDoc.ip !== userIp) {
            return { valid: false, reason: "Key already redeemed by another user." };
        }
        
        return { valid: true };
    });
};