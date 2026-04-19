const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const MASTER_KEY = process.env.DEV_KEY; 
const DURACAO_KEY = 12 * 60 * 60 * 1000; 

// Helper para o Node.js renderizar o tempo inicial no servidor
function formatTimeServer(ms) {
    if (ms < 0) return "INFINITY";
    let s = Math.floor(ms / 1000);
    let h = Math.floor(s / 3600);
    let m = Math.floor((s % 3600) / 60);
    let sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

mongoose.connect(MONGO_URI).then(() => console.log("💉 Abyss Connection Active"));

// --- SCHEMAS ---
const KeySchema = new mongoose.Schema({
    ip: { type: String, default: "MANUAL" }, 
    key: { type: String, required: true, unique: true },
    isPermanent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
KeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 43200, partialFilterExpression: { isPermanent: false } });
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

fastify.register(require('@fastify/cors'), { origin: true });

// --- IP LOCK RIGOROSO (Middleware) ---
fastify.addHook('preHandler', async (request, reply) => {
    const path = request.routerPath || request.url.toLowerCase();
    const publicPaths = ['/get-key', '/redeem-key', '/admin', '/download', '/script/'];
    if (publicPaths.some(p => path.includes(p))) return;

    const userKey = request.query.key || request.headers['x-asfixy-key'];
    if (userKey === MASTER_KEY) return;

    const keyDoc = await KeyModel.findOne({ key: userKey });
    if (!keyDoc) return reply.code(401).send({ error: "Invalid Key" });

    // Se o IP for MANUAL, a key ainda não foi ativada pelo /redeem-key
    if (keyDoc.ip === "MANUAL") return reply.code(403).send({ error: "Redeem key first" });
    
    // Trava de IP: O IP atual deve ser o mesmo que resgatou a key
    if (keyDoc.ip !== request.ip) return reply.code(401).send({ error: "IP Hardware Lock mismatch" });
});

// --- ADMIN PANEL (PAGINATION & UI) ---
fastify.get('/admin', async (request, reply) => {
    if (request.query.key !== MASTER_KEY) return reply.code(403).send("DENIED");

    const page = parseInt(request.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalKeys = await KeyModel.countDocuments();
    const allKeys = await KeyModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalPages = Math.ceil(totalKeys / limit) || 1;

    const keysData = allKeys.map(k => {
        const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
        return { key: k.key, ip: k.ip, isPermanent: k.isPermanent, timeLeft: k.isPermanent ? -1 : Math.max(0, ms) };
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><title>Asfixy Master Panel</title>
        <style>
            :root { --bg: #0a0a0a; --card: #141414; --accent: #ff3333; --text: #e0e0e0; --success: #33ff77; }
            body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { width: 90%; max-width: 900px; background: var(--card); border: 1px solid rgba(255,51,51,0.1); border-radius: 24px; padding: 40px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 20px; }
            h1 { font-size: 1.2rem; letter-spacing: 3px; color: var(--accent); text-transform: uppercase; margin: 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { text-align: left; opacity: 0.4; font-size: 0.7rem; text-transform: uppercase; padding: 15px; }
            td { padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.02); }
            .key-name { font-weight: bold; color: #fff; }
            .actions { display: flex; gap: 8px; }
            .btn-opt { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text); padding: 6px 12px; border-radius: 8px; font-size: 0.7rem; cursor: pointer; transition: 0.2s; font-weight: 600; }
            .btn-opt:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
            .btn-main { background: var(--success); color: #000; border: none; padding: 10px 20px; border-radius: 12px; font-weight: bold; cursor: pointer; }
            .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
            .page-info { font-size: 0.8rem; opacity: 0.6; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Asfixy Master</h1>
                <button class="btn-main" onclick="criarNovaKey()">+ NEW KEY</button>
            </div>
            <table>
                <thead><tr><th>Key / IP</th><th>Status / Expiry</th><th>Actions</th></tr></thead>
                <tbody>
                    ${keysData.map(item => `
                    <tr>
                        <td><span class="key-name">${item.key}</span><br><small style="opacity:0.4;font-family:monospace;">${item.ip}</small></td>
                        <td class="timer" data-ms="${item.timeLeft}">${item.isPermanent ? '<span style="color:var(--success)">PERMANENT</span>' : formatTimeServer(item.timeLeft)}</td>
                        <td class="actions">
                            <button class="btn-opt" style="color:var(--success)" onclick="resetIP('${item.key}')">RESET IP</button>
                            <button class="btn-opt" onclick="updateKey('${item.key}')">EDIT</button>
                            <button class="btn-opt" onclick="revogarKey('${item.key}')" style="color:var(--accent)">REVOKE</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="footer">
                <div>
                    <button class="btn-opt" onclick="changePage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>PREV</button>
                    <span class="page-info">Page ${page} of ${totalPages}</span>
                    <button class="btn-opt" onclick="changePage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>NEXT</button>
                </div>
                <button class="btn-opt" style="background:var(--accent); color:white; border:none;" onclick="bulkCreate()">BULK GENERATE</button>
            </div>
        </div>
        <script>
            const MASTER_KEY = "${request.query.key}";
            function formatTime(ms) {
                if (ms < 0) return "PERMANENT";
                let s = Math.floor(ms / 1000);
                return Math.floor(s/3600).toString().padStart(2,'0') + ":" + Math.floor((s%3600)/60).toString().padStart(2,'0') + ":" + (s%60).toString().padStart(2,'0');
            }
            async function criarNovaKey() {
                const name = prompt("Key Name:"); if(!name) return;
                const perm = confirm("Permanent?");
                await fetch('/admin/create-key?key='+MASTER_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({customName:name, permanent:perm})});
                location.reload();
            }
            async function bulkCreate() {
                const amount = prompt("How many keys?"); if(!amount) return;
                const perm = confirm("Permanent?");
                await fetch('/admin/bulk-create?key='+MASTER_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({amount:parseInt(amount), permanent:perm})});
                location.reload();
            }
            async function updateKey(oldKey) {
                const nName = prompt("New Name:", oldKey); const nHrs = prompt("Reset to hours (0 = keep):", "0");
                if(nName === null) return;
                await fetch('/admin/edit-full?key='+MASTER_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({targetKey:oldKey, newName:nName, hours:nHrs})});
                location.reload();
            }
            async function resetIP(k) {
                if(confirm("Reset IP Lock for "+k+"?")) {
                    await fetch('/admin/reset-ip?key='+MASTER_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({targetKey:k})});
                    location.reload();
                }
            }
            async function revogarKey(k) {
                if(confirm("Delete key "+k+"?")) {
                    await fetch('/admin/revoke-key?key='+MASTER_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({targetKey:k})});
                    location.reload();
                }
            }
            function changePage(p) { window.location.href = '/admin?key='+MASTER_KEY+'&page='+p; }
            setInterval(() => {
                document.querySelectorAll('.timer').forEach(td => {
                    let ms = parseInt(td.getAttribute('data-ms'));
                    if (ms > 0) { ms -= 1000; td.setAttribute('data-ms', ms); td.innerText = formatTime(ms); }
                });
            }, 1000);
        </script>
    </body>
    </html>`;
    reply.type('text/html').send(html);
});

// --- ADMIN ACTIONS ---
fastify.post('/admin/bulk-create', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const keys = [];
    for (let i = 0; i < r.body.amount; i++) {
        let rand = ""; for (let j = 0; j < 23; j++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
        keys.push({ key: `Asfixy-${rand}`, isPermanent: r.body.permanent, ip: "MANUAL" });
    }
    await KeyModel.insertMany(keys);
    return { success: true };
});

fastify.post('/admin/reset-ip', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    await KeyModel.updateOne({ key: r.body.targetKey }, { ip: "MANUAL" });
    return { success: true };
});

fastify.post('/admin/edit-full', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    const update = { key: r.body.newName };
    if (r.body.hours > 0) update.createdAt = new Date(Date.now() - (DURACAO_KEY - (r.body.hours * 3600000)));
    await KeyModel.updateOne({ key: r.body.targetKey }, update);
    return { success: true };
});

fastify.post('/admin/revoke-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    await KeyModel.deleteOne({ key: r.body.targetKey });
    return { success: true };
});

fastify.post('/admin/create-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    await KeyModel.create({ ip: "MANUAL", key: r.body.customName, isPermanent: r.body.permanent });
    return { success: true };
});

// --- PUBLIC ROUTES (NO KEY REQUIRED FOR REDEEM) ---
fastify.post('/redeem-key', async (request) => {
    const { key } = request.body;
    const keyDoc = await KeyModel.findOne({ key });
    if (!keyDoc) return { valid: false, reason: "Invalid" };
    if (keyDoc.ip === "MANUAL") {
        await KeyModel.updateOne({ key }, { ip: request.ip });
        return { valid: true, msg: "Linked to device" };
    }
    return { valid: keyDoc.ip === request.ip, reason: keyDoc.ip === request.ip ? "OK" : "Device mismatch" };
});

fastify.get('/get-key', async (request) => {
    const userIp = request.ip;
    let keyDoc = await KeyModel.findOne({ ip: userIp });
    if (keyDoc) {
        const restanteMs = DURACAO_KEY - (Date.now() - keyDoc.createdAt.getTime());
        return { key: keyDoc.key, expires_in_min: Math.round(restanteMs / 60000) };
    }
    const chars = "123579";
    let rand = ""; for(let i=0; i<6; i++) rand += chars[Math.floor(Math.random()*chars.length)];
    const newKey = `Asfixy-${rand}`;
    await KeyModel.create({ ip: userIp, key: newKey });
    return { key: newKey, status: "created" };
});

// --- DATA ROUTES ---
fastify.get('/status', async (r) => {
    const userKey = r.query.key || r.headers['x-asfixy-key'];
    const query = userKey === MASTER_KEY ? {} : { ownerKey: userKey };
    return await FarmModel.find(query).select('-_id -__v');
});

fastify.post('/update-farm', async (request, reply) => {
    const sentKey = request.headers['x-asfixy-key'];
    const { bakeryName, cookies, prestige, cookiesPs, version, gameVersion, saveKey, webhookUsed } = request.body;
    await FarmModel.findOneAndUpdate(
        { ownerKey: sentKey, bakeryName: bakeryName || 'Unknown' },
        { cookies, prestige, cookiesPs, version, gameVersion, saveKey, webhookUsed, lastUpdate: Date.now() },
        { upsert: true }
    );
    return { status: 'success' };
});

fastify.get('/download', async (r, rp) => rp.redirect('https://gofile.io/d/9c8Wlb'));
fastify.get('/', async () => ({ status: "Online", engine: "Asfixy Master" }));

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });