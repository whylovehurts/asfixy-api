const fs = require('fs/promises');
const path = require('path');
const KeyModel = require('../models/Key');
const { formatTime, DURACAO_KEY } = require('../utils/helpers');

module.exports = async function (fastify, opts) {
    const MASTER_KEY = process.env.DEV_KEY;

    fastify.get('/admin', async (request, reply) => {
        const userKey = request.query.key;
        if (userKey !== MASTER_KEY) return reply.code(403).send("ACCESS DENIED");

        const page = parseInt(request.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const totalKeys = await KeyModel.countDocuments();
        const allKeys = await KeyModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const totalPages = Math.ceil(totalKeys / limit);

        // Gera a tabela de usuários
        const tableRows = allKeys.map(k => {
            const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
            const timeLeft = k.isPermanent ? -1 : Math.max(0, ms);
            const timeDisplay = k.isPermanent ? '<span class="permanent-badge">PERMANENT</span>' : formatTime(timeLeft);
            
            return `
                <tr>
                    <td>
                        <span class="key-name">${k.key}</span><br>
                        <small style="opacity: 0.5; font-family: monospace;">${k.ip}</small>
                    </td>
                    <td class="timer" data-ms="${timeLeft}">${timeDisplay}</td>
                    <td class="actions">
                        <button class="btn-opt" style="color: var(--success)" onclick="resetIP('${k.key}')">RESET IP</button>
                        <button class="btn-opt" onclick="updateKey('${k.key}')">EDIT</button>
                        <button class="btn-opt btn-revoke" onclick="revogarKey('${k.key}')">REVOKE</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Lê o arquivo HTML isolado e injeta os dados dinamicamente usando .replace()
        const viewPath = path.join(__dirname, '../../public/views/admin.html');
        let htmlTemplate = await fs.readFile(viewPath, 'utf8');
        
        htmlTemplate = htmlTemplate
            .replace('{{TABLE_ROWS}}', tableRows)
            .replace('{{PAGE}}', page)
            .replace('{{TOTAL_PAGES}}', totalPages)
            .replace('{{MASTER_KEY}}', MASTER_KEY)
            .replace('{{PREV_DISABLED}}', page <= 1 ? 'disabled' : '')
            .replace('{{NEXT_DISABLED}}', page >= totalPages ? 'disabled' : '')
            .replace('{{ACTIVE_CONNS}}', allKeys.length)
            .replace(/{{MASTER_KEY}}/g, MASTER_KEY); // Substitui todas as ocorrências

        return reply.type('text/html').send(htmlTemplate);
    });

    // --- Rotas de Ação do Admin ---
    fastify.post('/admin/create-key', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { customName, permanent } = request.body;
        try {
            await KeyModel.create({ ip: "MANUAL", key: customName, isPermanent: permanent, createdAt: new Date() });
            return { success: true };
        } catch (err) { return reply.code(400).send({ error: "Key already exists." }); }
    });

// --- Rotas de Ação do Admin ---
    fastify.post('/admin/create-key', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { customName, permanent } = request.body;
        try {
            await KeyModel.create({ ip: "MANUAL", key: customName, isPermanent: permanent, createdAt: new Date() });
            return { success: true };
        } catch (err) { return reply.code(400).send({ error: "Key already exists." }); }
    });

    fastify.post('/admin/edit-full', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { targetKey, newName, hours } = request.body;
        
        const updateData = { key: newName };
        
        if (hours && parseFloat(hours) > 0) {
            // Define a nova data de expiração baseada no tempo atual + horas pedidas
            updateData.createdAt = new Date(Date.now() - (DURACAO_KEY - (parseFloat(hours) * 60 * 60 * 1000)));
        }

        await KeyModel.updateOne({ key: targetKey }, updateData);
        return { success: true };
    });

    fastify.post('/admin/revoke-key', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { targetKey } = request.body;
        await KeyModel.deleteOne({ key: targetKey });
        return { success: true };
    });

    fastify.post('/admin/reset-ip', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { targetKey } = request.body;
        
        // Volta o IP para "MANUAL", permitindo que o próximo que usar a key a vincule
        await KeyModel.updateOne({ key: targetKey }, { ip: "MANUAL" });
        return { success: true };
    });

    fastify.post('/admin/bulk-create', async (request, reply) => {
        if (request.query.key !== MASTER_KEY) return reply.code(403).send();
        const { amount, permanent } = request.body;
        
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const generated = [];

        for (let i = 0; i < amount; i++) {
            let randomKey = "Asfixy-";
            for (let j = 0; j < 23; j++) { // 7 (prefixo) + 23 = 30 caracteres
                randomKey += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            generated.push({
                ip: "MANUAL",
                key: randomKey,
                isPermanent: permanent,
                createdAt: new Date()
            });
        }

        try {
            await KeyModel.insertMany(generated);
            return { success: true, count: amount };
        } catch (err) {
            return reply.code(500).send({ error: "Bulk generation failed." });
        }
    });
};