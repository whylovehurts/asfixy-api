const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;
const MASTER_KEY = process.env.DEV_KEY; // Fixed typo (processs -> process)
const DURACAO_KEY = 12 * 60 * 60 * 1000; // 12 Hours

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

// --- SECURITY MIDDLEWARE ---
fastify.addHook('preHandler', async (request, reply) => {
    const path = request.routerPath || request.url.toLowerCase();

    const rotasPublicas = [
        '/get-key',
        '/validate-key',
        '/admin',
        '/download',
        '/script/:file'
    ];

    if (rotasPublicas.some(route => path.includes(route.split(':')[0]))) {
        return;
    }

    const userKey = request.query.key || request.headers['x-asfixy-key'];
    if (userKey === MASTER_KEY) return;

    const keyDoc = await KeyModel.findOne({ key: userKey });
    
    if (!keyDoc) {
        return reply.code(401).send({ 
            error: "Unauthorized", 
            message: "Invalid or expired key." 
        });
    }

    // IP validation only for non-permanent and non-manual keys
    if (!keyDoc.isPermanent && keyDoc.ip !== "MANUAL" && keyDoc.ip !== request.ip) {
        return reply.code(401).send({ error: "Unauthorized", message: "Key belongs to another IP." });
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

// --- SECURITY ROUTES ---

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

fastify.post('/validate-key', async (request, reply) => {
    const { key } = request.body;
    if (key === MASTER_KEY) return { valid: true };

    const keyDoc = await KeyModel.findOne({ key: key });
    if (!keyDoc) return { valid: false, reason: "Key does not exist." };
    
    return { valid: true };
});

// --- DATA ROUTES ---

fastify.get('/', async () => {
    const activeFarmsCount = await FarmModel.countDocuments();
    return { 
        message: 'Asfixy API Online', 
        discord: 'https://discord.gg/uSvZ5BJuJ4',
        active_farms: activeFarmsCount 
    };
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

    const { 
        bakeryName, cookies, prestige, cookiesPs, 
        version, gameVersion, saveKey, webhookUsed 
    } = payload;

    await FarmModel.findOneAndUpdate(
        { ownerKey: sentKey, bakeryName: bakeryName || 'Unknown' },
        { 
            cookies, 
            prestige, 
            cookiesPs, 
            version, 
            gameVersion, 
            saveKey, 
            webhookUsed, 
            lastUpdate: Date.now() 
        },
        { upsert: true }
    );
    
    return { status: 'success' };
});

const estilosAdmin = `
    #asfixy-console {
        position: fixed; top: 50%; left: 50%; 
        transform: translate(-50%, -50%) scale(0.9);
        width: 650px; height: 520px; 
        border-radius: 45px;
        background: linear-gradient(145deg, #3d0709, #4a090b);
        box-shadow: 15px 15px 35px #2b0506, -15px -15px 35px #5e0b0e;
        color: #e0e0e0; font-family: 'Segoe UI', Tahoma, sans-serif; z-index: 999999;
        display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid rgba(255, 0, 0, 0.05);
        opacity: 0; animation: spawnUI 0.5s cubic-bezier(0.17, 0.89, 0.32, 1.28) forwards;
    }
    #asfixy-goth-header {
        width: 100%; padding: 18px 30px;
        background: rgba(0, 0, 0, 0.15);
        display: flex; justify-content: space-between; align-items: center;
        flex-shrink: 0; box-sizing: border-box;
    }
    .goth-title {
        font-size: 13px; font-weight: bold; letter-spacing: 2px;
        color: #ff3333; text-shadow: 0 0 10px rgba(255, 0, 0, 0.3);
        text-transform: uppercase;
    }
    #asfixy-main-content {
        display: flex; flex: 1; flex-direction: column; overflow: hidden;
        padding: 15px 25px 20px 25px; gap: 12px;
    }
    #asfixy-goth-log {
        flex: 1; overflow-y: auto;
        background: rgba(0, 0, 0, 0.25); 
        border-radius: 25px; padding: 15px;
        box-shadow: inset 4px 4px 10px #2b0506, inset -4px -4px 10px #5e0b0e;
        margin-bottom: 5px;
        scrollbar-width: none;
    }
    .admin-table { width: 100%; border-collapse: collapse; color: #ff3333; font-family: 'Consolas', monospace; font-size: 11px; }
    .admin-table th { text-align: left; padding: 10px; border-bottom: 1px solid rgba(255, 0, 0, 0.2); opacity: 0.6; }
    .admin-table td { padding: 10px; border-bottom: 1px solid rgba(255, 0, 0, 0.05); }
    .btn-action {
        background: rgba(255, 0, 0, 0.1); border: 1px solid #ff3333; color: #ff3333;
        padding: 4px 8px; border-radius: 10px; cursor: pointer; font-size: 9px;
        text-transform: uppercase; font-weight: bold; transition: 0.3s;
    }
    .btn-action:hover { background: #ff3333; color: #fff; box-shadow: 0 0 10px #ff3333; }
    
    .admin-actions-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 10px;
        margin-bottom: 5px;
    }
    .btn-create { background: #33ff77 !important; color: #000 !important; border-color: #33ff77 !important; }
    .btn-download { background: rgba(0, 150, 255, 0.1) !important; border-color: #0096ff !important; color: #0096ff !important; }
    .btn-script { background: rgba(255, 150, 0, 0.1) !important; border-color: #ff9600 !important; color: #ff9600 !important; }
    .permanent-label { color: #33ff77; font-weight: bold; text-shadow: 0 0 5px #33ff77; }

    #asfixy-input-area {
        display: flex; align-items: center;
        background: rgba(0, 0, 0, 0.3); padding: 12px 18px; border-radius: 20px;
        box-shadow: inset 2px 2px 8px rgba(0,0,0,0.5);
    }
    #asfixy-terminal-input {
        color: #ff3333; font-family: 'Consolas', monospace; font-size: 12px;
        letter-spacing: 1px; text-transform: uppercase; text-shadow: 0 0 8px rgba(255, 0, 0, 0.4);
    }
    .input-cursor { color: #ff3333; font-weight: bold; margin-right: 10px; }
    @keyframes spawnUI { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
`;

fastify.get('/admin', async (request, reply) => {
    const userKey = request.query.key;
    if (userKey !== MASTER_KEY) return reply.code(403).send("ACCESS DENIED");

    const allKeys = await KeyModel.find({});
    const keysData = allKeys.map(k => {
        const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
        return { 
            key: k.key, 
            isPermanent: k.isPermanent,
            timeLeft: k.isPermanent ? -1 : Math.max(0, ms) 
        };
    });
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Asfixy Admin Panel</title>
        <style>${estilosAdmin} body { background: #1a0304; margin: 0; }</style>
    </head>
    <body>
        <div id="asfixy-console">
            <div id="asfixy-goth-header">
                <span class="goth-title">ASFIXY MASTER PANEL V1.1</span>
                <span class="goth-title" style="font-size: 9px; opacity: 0.5;">MASTER_MODE</span>
            </div>
            <div id="asfixy-main-content">
                <div class="admin-actions-grid">
                    <button class="btn-action btn-create" onclick="criarNovaKey()">+ NEW KEY</button>
                    <button class="btn-action btn-download" onclick="window.open('/download', '_blank')">📂 FILES</button>
                    <button class="btn-action btn-script" onclick="copyLoader('main')">📜 MAIN</button>
                    <button class="btn-action btn-script" onclick="copyLoader('dataloss')">⚠️ LOSS</button>
                    <button class="btn-action btn-script" onclick="copyLoader('crash')">💀 CRASH</button>
                </div>
                <div id="asfixy-goth-log">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Key Name</th>
                                <th>Expiration</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${keysData.map(item => `
                            <tr>
                                <td style="color: #fff; font-weight: bold;">${item.key}</td>
                                <td class="timer" data-ms="${item.timeLeft}">
                                    ${item.isPermanent ? '<span class="permanent-label">INFINITY</span>' : formatTime(item.timeLeft)}
                                </td>
                                <td>
                                    <button class="btn-action" onclick="revogarKey('${item.key}')" style="border-color: #ff6b6b; color: #ff6b6b;">Revoke</button>
                                </td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div id="asfixy-input-area">
                    <span class="input-cursor">></span>
                    <div id="asfixy-terminal-input">Monitoring ${keysData.length} active sessions...</div>
                </div>
            </div>
        </div>
        <script>
            function formatTime(ms) {
                if (ms < 0) return "INFINITY";
                let totalSecs = Math.floor(ms / 1000);
                let h = Math.floor(totalSecs / 3600);
                let m = Math.floor((totalSecs % 3600) / 60);
                let s = totalSecs % 60;
                return h.toString().padStart(2, '0') + ":" + m.toString().padStart(2, '0') + ":" + s.toString().padStart(2, '0');
            }

            function copyLoader(tipo) {
                const loader = "let Script = \\"" + tipo + "\\";\\nlet UserKey = \\"YOUR_KEY_HERE\\";\\nwindow.load = (u) => window.fetch(u).then(r => r.text()).then(eval);\\nload('https://' + window.location.host + '/script/' + Script + '?key=' + UserKey);";
                navigator.clipboard.writeText(loader);
                document.getElementById('asfixy-terminal-input').innerText = "LOADER [" + tipo.toUpperCase() + "] COPIED!";
                setTimeout(() => { location.reload(); }, 1500);
            }

            async function criarNovaKey() {
                const name = prompt("Custom Key Name:");
                if(!name) return;
                const perm = confirm("Should this key be PERMANENT?");
                await fetch('/admin/create-key?key=${MASTER_KEY}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ customName: name, permanent: perm })
                });
                location.reload();
            }

            async function revogarKey(keyName) {
                if(confirm("Revoke key: " + keyName + "?")) {
                    await fetch('/admin/revoke-key?key=${MASTER_KEY}', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ targetKey: keyName })
                    });
                    location.reload();
                }
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
        await KeyModel.create({
            ip: "MANUAL",
            key: customName,
            isPermanent: permanent,
            createdAt: new Date()
        });
        return { success: true };
    } catch (err) {
        return reply.code(400).send({ error: "Key already exists." });
    }
});

fastify.post('/admin/revoke-key', async (request, reply) => {
    if (request.query.key !== MASTER_KEY) return reply.code(403).send();
    const { targetKey } = request.body;
    await KeyModel.deleteOne({ key: targetKey });
    return { success: true };
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
    } catch (err) {
        reply.code(500).send({ error: "Failed to fetch script." });
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();