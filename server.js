const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;
const MASTER_KEY = process.env.DEV_KEY; 
const DURACAO_KEY = 12 * 60 * 60 * 1000; 

function formatTime(ms) {
    if (ms < 0) return "INFINITY";
    let totalSecs = Math.floor(ms / 1000);
    let h = Math.floor(totalSecs / 3600);
    let m = Math.floor((totalSecs % 3600) / 60);
    let s = totalSecs % 60;
    return h.toString().padStart(2, '0') + ":" + m.toString().padStart(2, '0') + ":" + s.toString().padStart(2, '0');
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("💉 Connection with the Abyss established."))
  .catch(err => console.error("❌ MongoDB Error:", err));

const KeySchema = new mongoose.Schema({
    ip: { type: String, default: "MANUAL" }, 
    key: { type: String, required: true, unique: true },
    isPermanent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

KeySchema.index({ createdAt: 1 }, { 
    expireAfterSeconds: 43200, 
    partialFilterExpression: { isPermanent: false } 
});

const KeyModel = mongoose.model('Key', KeySchema);

const FarmSchema = new mongoose.Schema({
    ownerKey: { type: String, required: true },
    bakeryName: { type: String, required: true },
    cookies: Number,
    prestige: Number,
    cookiesPs: Number,
    version: String,
    gameVersion: String,
    saveKey: String,
    webhookUsed: String,
    lastUpdate: { type: Date, default: Date.now }
});

const FarmModel = mongoose.model('Farm', FarmSchema);

fastify.register(require('@fastify/cors'), { origin: true, methods: ["GET", "POST"] });
fastify.register(require('@fastify/cookie'), { secret: "asfixy-secret" });

fastify.addHook('preHandler', async (request, reply) => {
    const path = request.routerPath || request.url.toLowerCase();
    const rotasPublicas = ['/get-key', '/redeem-key', '/admin', '/download', '/script/:file'];
    
    if (rotasPublicas.some(route => path.includes(route.split(':')[0]))) return;

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
});

const numToChar = (n) => String.fromCharCode(65 + parseInt(n));

const gerarKeyAsfixy = () => {
    const possiveisNumeros = [1, 2, 3, 5, 7, 9]; 
    let numerosGerados = "";
    let letrasAssinatura = "";
    for (let i = 0; i < 6; i++) {
        const num = possiveisNumeros[Math.floor(Math.random() * possiveisNumeros.length)];
        numerosGerados += num;
        letrasAssinatura += numToChar(num);
    }
    return `Asfixy-${numerosGerados}${letrasAssinatura}`;
};

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

    // Lógica de Vínculo: Se a key for nova (MANUAL) ou resetada, fixa no IP de quem chamou
    if (keyDoc.ip === "MANUAL") {
        await KeyModel.updateOne({ key: key }, { ip: userIp });
        return { valid: true, message: "Key redeemed and locked to your IP." };
    }

    // Se já estiver vinculada, verifica se o IP bate
    if (keyDoc.ip !== userIp) {
        return { valid: false, reason: "Key already redeemed by another user." };
    }
    
    return { valid: true };
});

fastify.get('/', async () => {
    const activeFarmsCount = await FarmModel.countDocuments();
    return { message: 'Asfixy API Online', discord: 'https://discord.gg/uSvZ5BJuJ4', active_farms: activeFarmsCount };
});

fastify.get('/download', async (request, reply) => {
    return reply.redirect('https://gofile.io/d/9c8Wlb');
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

const estilosAdmin = `
    #asfixy-console { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.9); width: 650px; height: 520px; border-radius: 45px; background: linear-gradient(145deg, #3d0709, #4a090b); box-shadow: 15px 15px 35px #2b0506, -15px -15px 35px #5e0b0e; color: #e0e0e0; font-family: 'Segoe UI', Tahoma, sans-serif; z-index: 999999; display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(255, 0, 0, 0.05); opacity: 0; animation: spawnUI 0.5s cubic-bezier(0.17, 0.89, 0.32, 1.28) forwards; }
    #asfixy-goth-header { width: 100%; padding: 18px 30px; background: rgba(0, 0, 0, 0.15); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; box-sizing: border-box; }
    .goth-title { font-size: 13px; font-weight: bold; letter-spacing: 2px; color: #ff3333; text-shadow: 0 0 10px rgba(255, 0, 0, 0.3); text-transform: uppercase; }
    #asfixy-main-content { display: flex; flex: 1; flex-direction: column; overflow: hidden; padding: 15px 25px 20px 25px; gap: 12px; }
    #asfixy-goth-log { flex: 1; overflow-y: auto; background: rgba(0, 0, 0, 0.25); border-radius: 25px; padding: 15px; box-shadow: inset 4px 4px 10px #2b0506, inset -4px -4px 10px #5e0b0e; margin-bottom: 5px; scrollbar-width: none; }
    .admin-table { width: 100%; border-collapse: collapse; color: #ff3333; font-family: 'Consolas', monospace; font-size: 11px; }
    .admin-table th { text-align: left; padding: 10px; border-bottom: 1px solid rgba(255, 0, 0, 0.2); opacity: 0.6; }
    .admin-table td { padding: 10px; border-bottom: 1px solid rgba(255, 0, 0, 0.05); }
    .btn-action { background: rgba(255, 0, 0, 0.1); border: 1px solid #ff3333; color: #ff3333; padding: 4px 8px; border-radius: 10px; cursor: pointer; font-size: 9px; text-transform: uppercase; font-weight: bold; transition: 0.3s; }
    .btn-action:hover { background: #ff3333; color: #fff; box-shadow: 0 0 10px #ff3333; }
    .btn-create { background: #33ff77 !important; color: #000 !important; border-color: #33ff77 !important; }
    .permanent-label { color: #33ff77; font-weight: bold; text-shadow: 0 0 5px #33ff77; }
    #asfixy-input-area { display: flex; align-items: center; background: rgba(0, 0, 0, 0.3); padding: 12px 18px; border-radius: 20px; box-shadow: inset 2px 2px 8px rgba(0,0,0,0.5); }
    #asfixy-terminal-input { color: #ff3333; font-family: 'Consolas', monospace; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; text-shadow: 0 0 8px rgba(255, 0, 0, 0.4); }
    .input-cursor { color: #ff3333; font-weight: bold; margin-right: 10px; }
    @keyframes spawnUI { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
`;

fastify.get('/admin', async (request, reply) => {
    const userKey = request.query.key;
    if (userKey !== MASTER_KEY) return reply.code(403).send("ACCESS DENIED");

    const page = parseInt(request.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalKeys = await KeyModel.countDocuments();
    const allKeys = await KeyModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);
    
    const totalPages = Math.ceil(totalKeys / limit);

    const keysData = allKeys.map(k => {
        const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
        return { 
            key: k.key, 
            ip: k.ip,
            isPermanent: k.isPermanent,
            timeLeft: k.isPermanent ? -1 : Math.max(0, ms) 
        };
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asfixy Master Panel</title>
        <style>
            :root {
                --bg: #0a0a0a;
                --card-bg: #141414;
                --accent: #ff3333;
                --text: #e0e0e0;
                --success: #33ff77;
            }
            body { 
                background: var(--bg); 
                color: var(--text); 
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
                margin: 0; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                min-height: 100vh;
            }
            .container {
                width: 90%;
                max-width: 800px;
                background: var(--card-bg);
                border: 1px solid rgba(255, 51, 51, 0.1);
                border-radius: 24px;
                padding: 40px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
                border-bottom: 1px solid rgba(255,255,255,0.05);
                padding-bottom: 20px;
            }
            .header h1 {
                font-size: 1.2rem;
                letter-spacing: 3px;
                color: var(--accent);
                margin: 0;
                text-transform: uppercase;
            }
            .btn-main {
                background: var(--success);
                color: #000;
                border: none;
                padding: 10px 20px;
                border-radius: 12px;
                font-weight: bold;
                cursor: pointer;
                transition: transform 0.2s;
            }
            .btn-main:hover { transform: scale(1.05); }
            
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { text-align: left; color: rgba(255,255,255,0.4); font-size: 0.8rem; text-transform: uppercase; padding: 15px; }
            td { padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.03); }
            
            .key-name { font-weight: 600; color: #fff; }
            .permanent-badge { color: var(--success); font-size: 0.8rem; font-weight: bold; }
            
            .actions { display: flex; gap: 10px; }
            .btn-opt {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: var(--text);
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 0.75rem;
                cursor: pointer;
                transition: 0.3s;
            }
            .btn-opt:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
            .btn-revoke:hover { background: #ff3366; }

            .footer-info {
                margin-top: 30px;
                font-size: 0.8rem;
                opacity: 0.5;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Asfixy Master</h1>
                <button class="btn-main" onclick="criarNovaKey()">+ NEW KEY</button>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Key / Linked IP</th>
                        <th>Status / Expiry</th>
                        <th>Management</th>
                    </tr>
                </thead>
                <tbody>
                    ${keysData.map(item => `
                    <tr>
                        <td>
                            <span class="key-name">${item.key}</span><br>
                            <small style="opacity: 0.5; font-family: monospace;">${item.ip}</small>
                        </td>
                        <td class="timer" data-ms="${item.timeLeft}">
                            ${item.isPermanent ? '<span class="permanent-badge">PERMANENT</span>' : formatTime(item.timeLeft)}
                        </td>
                        <td class="actions">
                            <button class="btn-opt" style="color: var(--success)" onclick="resetIP('${item.key}')">RESET IP</button>
                            <button class="btn-opt" onclick="updateKey('${item.key}')">EDIT</button>
                            <button class="btn-opt btn-revoke" onclick="revogarKey('${item.key}')">REVOKE</button>
                        </td>
                        <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                        <div>
                            <button class="btn-opt" onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>PREV</button>
                            <span>Page ${page} of ${totalPages}</span>
                            <button class="btn-opt" onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>NEXT</button>
                        </div>
                        <button class="btn-main" style="background: var(--accent); color: white;" onclick="bulkCreate()">BULK GENERATE</button>
                    </div>
                    </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="footer-info">
                Active Connections: ${keysData.length} | System Latency: Optimal
            </div>
        </div>

        <script>
            function formatTime(ms) {
                if (ms < 0) return "PERMANENT";
                let totalSecs = Math.floor(ms / 1000);
                let h = Math.floor(totalSecs / 3600);
                let m = Math.floor((totalSecs % 3600) / 60);
                let s = totalSecs % 60;
                return h.toString().padStart(2, '0') + ":" + m.toString().padStart(2, '0') + ":" + s.toString().padStart(2, '0');
            }

            async function criarNovaKey() {
                const name = prompt("Enter Custom Key Name:");
                if(!name) return;
                const perm = confirm("Make this key permanent?");
                await fetch('/admin/create-key?key=${MASTER_KEY}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ customName: name, permanent: perm })
                });
                location.reload();
            }

            async function updateKey(oldKey) {
                const newName = prompt("New name for this key (Leave blank to keep current):", oldKey);
                const newHours = prompt("Add/Set hours (e.g., 12 or 24). Enter 0 to keep current duration:");
                
                if (newName !== null) {
                    await fetch('/admin/edit-full?key=${MASTER_KEY}', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            targetKey: oldKey, 
                            newName: newName || oldKey, 
                            hours: newHours || 0 
                        })
                    });
                    location.reload();
                }
            }

            async function revogarKey(keyName) {
                if(confirm("Permanently revoke " + keyName + "?")) {
                    await fetch('/admin/revoke-key?key=${MASTER_KEY}', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ targetKey: keyName })
                    });
                    location.reload();
                }
            }

            async function resetIP(keyName) {
                if(confirm("Reset IP lock for " + keyName + "? This allows another user to redeem it.")) {
                    await fetch('/admin/reset-ip?key=${MASTER_KEY}', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ targetKey: keyName })
                    });
                    location.reload();
                }
            }

            function changePage(p) {
                window.location.href = '/admin?key=${MASTER_KEY}&page=' + p;
            }

            async function bulkCreate() {
                const amount = prompt("How many random keys to generate?");
                if(!amount || isNaN(amount)) return;
                const perm = confirm("Make these keys permanent?");
                
                await fetch('/admin/bulk-create?key=${MASTER_KEY}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ amount: parseInt(amount), permanent: perm })
                });
                location.reload();
            }

            setInterval(() => {
                document.querySelectorAll('.timer').forEach(td => {
                    let ms = parseInt(td.getAttribute('data-ms'));
                    if (ms > 0) {
                        ms -= 1000;
                        td.setAttribute('data-ms', ms);
                        td.innerText = formatTime(ms);
                    }
                });
            }, 1000);
        </script>
    </body>
    </html>`;
    reply.type('text/html').send(html);
});

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

fastify.get('/script/:file', async (request, reply) => {
    const { file } = request.params;
    const scripts = { 'main': 'main.js', 'dataloss': 'dataloss.js', 'crash': 'crash.js' };
    const fileName = scripts[file.toLowerCase()];
    if (!fileName) return reply.code(404).send({ error: "Script not found." });
    const GITHUB_BASE_URL = "https://raw.githubusercontent.com/whylovehurts/asfixy-exec/refs/heads/main/src/";
    try {
        const response = await fetch(GITHUB_BASE_URL + fileName);
        if (!response.ok) throw new Error("GitHub error");
        const code = await response.text();
        reply.type('application/javascript').send(code);
    } catch (err) { reply.code(500).send({ error: "Failed to fetch script." }); }
});

const start = async () => {
    try { await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }); }
    catch (err) { fastify.log.error(err); process.exit(1); }
};
start();