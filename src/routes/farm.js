/**
 * Farm Routes
 * Farm status updates and retrieval
 */

const { FarmModel, KeyModel } = require('../models');
const { keyHeaderSchema, updateFarmBodySchema } = require('../middleware/validation');
const { IS_PROD } = require('../config/env');
const { FARM_UPDATE_COOLDOWN_MS } = require('../lib/constants');

// Cooldown tracker
const FARM_CD = {};

/**
 * POST /update-farm
 * Update farm data
 */
async function updateFarmRoute(request, reply) {
    try {
        // Validate key header
        const headerParsed = keyHeaderSchema.safeParse(request.headers);
        if (!headerParsed.success) {
            return reply.code(401).send({ error: "Invalid or missing key header" });
        }

        const key = headerParsed.data['x-asfixy-key'];

        // Validate key exists
        const keyDoc = await KeyModel.findOne({ key: key.toLowerCase() })
            .collation({ locale: 'en', strength: 2 });
        if (!keyDoc) {
            return reply.code(403).send({ error: "Invalid key" });
        }

        // Validate body
        const bodyParsed = updateFarmBodySchema.safeParse(request.body);
        if (!bodyParsed.success) {
            return reply.code(400).send({ error: bodyParsed.error.issues[0]?.message || "Invalid body" });
        }

        const { bakeryName, cookies, prestige, cookiesPs, version, gameVersion, saveKey } = bodyParsed.data;

        // Cooldown check
        const now = Date.now();
        if (FARM_CD[key] && now - FARM_CD[key] < FARM_UPDATE_COOLDOWN_MS) {
            return reply.code(429).send({ error: "Cooldown" });
        }

        FARM_CD[key] = now;

        // Update or create farm
        await FarmModel.findOneAndUpdate(
            { ownerKey: key, bakeryName },
            {
                cookies,
                prestige,
                cookiesPs,
                version,
                gameVersion,
                saveKey,
                lastUpdate: now
            },
            { upsert: true }
        );

        return { status: "ok" };
    } catch (e) {
        if (!IS_PROD) console.error("update-farm error:", e);
        return reply.code(500).send({ error: "Internal error" });
    }
}

module.exports = {
    updateFarmRoute
};
