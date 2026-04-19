const FarmModel = require('../models/Farm');

module.exports = async function (fastify, opts) {
    const MASTER_KEY = process.env.DEV_KEY;

    fastify.get('/', async () => {
        const activeFarmsCount = await FarmModel.countDocuments();
        return { message: 'Asfixy API Online', discord: 'https://discord.gg/uSvZ5BJuJ4', active_farms: activeFarmsCount };
    });

    fastify.get('/status', async (request, reply) => {
        const userKey = request.query.key || request.headers['x-asfixy-key'];
        const query = userKey === MASTER_KEY ? {} : { ownerKey: userKey };
        return await FarmModel.find(query).select('-_id -__v');
    });

    fastify.post('/update-farm', async (request, reply) => {
        const payload = request.body;
        const sentKey = request.headers['x-asfixy-key'];
        if (!payload) return reply.code(400).send({ error: "No data" });
        
        const { bakeryName, cookies, prestige, cookiesPs, version, gameVersion, saveKey, webhookUsed } = payload;
        await FarmModel.findOneAndUpdate(
            { ownerKey: sentKey, bakeryName: bakeryName || 'Unknown' },
            { cookies, prestige, cookiesPs, version, gameVersion, saveKey, webhookUsed, lastUpdate: Date.now() },
            { upsert: true }
        );
        return { status: 'success' };
    });
};