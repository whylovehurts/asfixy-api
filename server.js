const fastify = require('fastify')({
    logger: true,
    trustProxy: true
});
const mongoose = require('mongoose');
const crypto = require('crypto');
const { z } = require('zod');
const sanitizeHtml = require('sanitize-html');
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Strip ALL HTML tags — returns plain text only
function stripHtml(value) {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

require('dotenv').config();

// --- ENV FAIL-SAFE: halt if critical vars are missing ---
const REQUIRED_ENV = ['SIGN_SECRET', 'MONGO_URI', 'DEV_KEY'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`[FATAL] Missing required environment variable: ${key}. Halting.`);
        process.exit(1);
    }
}

const SIGN_SECRET = process.env.SIGN_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const MASTER_KEY = process.env.DEV_KEY;
const DURACAO_KEY = 12 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

// --- LOAD & OBFUSCATE SCRIPT AT STARTUP ---
let OBFUSCATED_SCRIPT = '';
try {
    const raw = fs.readFileSync(path.join(__dirname, 'Scripts', 'asfixy.js'), 'utf8');
    OBFUSCATED_SCRIPT = JavaScriptObfuscator.obfuscate(raw, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2,
        stringEncryption: true,
        rotateStringArray: true,
        shuffleStringArray: true,
        splitStrings: true,
        identifierNamesGenerator: 'hexadecimal'
    }).getObfuscatedCode();
    console.log('[Asfixy] Script loaded and obfuscated successfully.');
} catch (e) {
    console.error('[Asfixy] WARN: Could not load Scripts/asfixy.js:', e.message);
}

// --- ZOD SCHEMAS ---
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

// Helper para o Node.js renderizar o tempo inicial no servidor
function formatTimeServer(ms) {
    if (ms < 0) return "INFINITY";
    let s = Math.floor(ms / 1000);
    let h = Math.floor(s / 3600);
    let m = Math.floor((s % 3600) / 60);
    let sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper para escapar strings em atributos JS (onclick, etc)
function escapeJs(str = "") {
    return str.replace(/[\\'"<>&]/g, c => ({
        '\\': '\\\\', "'": "\\'", '"': '\\"',
        '<': '\\x3c', '>': '\\x3e', '&': '\\x26'
    }[c]));
}

// Helper para IP consistente
function getClientIp(request) {
    return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
}

function verifySignature(req) {
    const key = req.headers['x-asfixy-key'];
    const ts = req.headers['x-asfixy-ts'];
    const sign = req.headers['x-asfixy-sign'];

    if (!key || !ts || !sign) return false;

    // evita replay (1 min)
    if (Math.abs(Date.now() - Number(ts)) > 60000)
        return false;

    const expected = crypto
        .createHmac('sha256', SIGN_SECRET)
        .update(key + ":" + ts)
        .digest('hex');

    return expected === sign;
}

mongoose.connect(MONGO_URI).then(async () => {
    console.log("💉 Abyss Connection Active");

    // Remove index antigo de IP unico (se existir)
    // Isso permite multiplas keys com ip: "MANUAL"
    try {
        await mongoose.connection.db.collection('keys').dropIndex('ip_1');
        console.log("🗑️ Dropped old ip_1 unique index");
    } catch (e) {
        // Index nao existe, ok
        if (e.codeName !== 'IndexNotFound') {
            console.log("Index ip_1 not found or already dropped");
        }
    }
});

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
    lastUpdate: { type: Date, default: Date.now }
});
FarmSchema.index({ ownerKey: 1 }); // index para consultas por ownerKey
const FarmModel = mongoose.model('Farm', FarmSchema);

const BanSchema = new mongoose.Schema({
    ip: String,
    key: String,
    reason: String,
    createdAt: { type: Date, default: Date.now }
});

const BanModel = mongoose.model('Ban', BanSchema);

const LogSchema = new mongoose.Schema({
    ip: String,
    key: String,
    route: String,
    method: String,
    status: Number,
    createdAt: { type: Date, default: Date.now }
});

const LogModel = mongoose.model('Log', LogSchema);

// --- NONCE GENERATOR (per-request, used by Helmet CSP) ---
const NONCE_MAP = new WeakMap();
function getReqNonce(req) { return NONCE_MAP.get(req); }

// --- HELMET: secure HTTP headers + nonce-based CSP ---
fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            // scriptSrc is set dynamically per-request via the addHook below
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"]
        }
    }
});

// Generate nonce and patch CSP header on every request
fastify.addHook('onRequest', async (req, reply) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    NONCE_MAP.set(req, nonce);
    // Override the script-src after helmet sets the header
    reply.header(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'`
    );
});

// --- CORS: whitelist only known origins ---
const ALLOWED_ORIGINS = [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'https://asfixy-api.onrender.com',
    'https://orteil.dashnet.org' // Cookie Clicker origin for extension calls
];
fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => {
        // Allow requests with no origin (curl, server-to-server, extension)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            cb(null, true);
        } else {
            cb(new Error('CORS: Origin not allowed'), false);
        }
    },
    credentials: true
});

fastify.register(require('@fastify/cookie'));

// --- GLOBAL RATE LIMIT ---
fastify.register(require('@fastify/rate-limit'), {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip
});

// --- NOSQL SANITIZER: strip MongoDB operators from all user input ---
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

fastify.addHook('preHandler', async (req) => {
    if (req.body && typeof req.body === 'object') sanitizeInput(req.body);
    if (req.query && typeof req.query === 'object') sanitizeInput(req.query);
});

const RL = new Map();

function rateLimit(ip, limit, ms) {
    const now = Date.now();
    const data = RL.get(ip) || [];

    const fresh = data.filter(t => now - t < ms);

    if (fresh.length >= limit) return false;

    fresh.push(now);
    RL.set(ip, fresh);

    return true;
}

function sendError(reply, request, code, msg, desc, btnText = "GET NEW KEY", btnHref = "/get-key") {
    if (request.method !== 'GET' || request.headers.accept?.includes('application/json')) {
        return reply.code(code).send({ error: msg });
    }
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Asfixy - Error</title>
<style>
:root { --bg:#050505; --card:rgba(20,20,20,0.7); --accent:#ff3333; --text:#eaeaea; }
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif;}
body{ background:radial-gradient(circle at top,#0a0a0a,#050505); color:var(--text); height:100vh; display:flex; justify-content:center; align-items:center; flex-direction:column; text-align:center;}
canvas { position:fixed; inset:0; z-index:-1; }
.card { background:var(--card); padding:40px; border-radius:20px; border:1px solid rgba(255,51,51,0.2); backdrop-filter:blur(20px); max-width:400px; width:90%; animation:shake 0.5s; }
@keyframes shake { 0%,100%{transform:translateX(0);} 25%{transform:translateX(-10px);} 75%{transform:translateX(10px);} }
h1 { color:var(--accent); letter-spacing:3px; margin-bottom:15px; font-size:1.5rem; text-transform:uppercase; }
p { opacity:0.7; font-size:0.9rem; margin-bottom:25px; line-height:1.5; }
.btn { display:inline-block; padding:12px 25px; background:var(--accent); color:#fff; text-decoration:none; border-radius:12px; font-weight:bold; transition:0.3s; border:none; cursor:pointer; }
.btn:hover { transform:scale(1.05); box-shadow:0 0 20px rgba(255,51,51,0.4); }
</style>
</head>
<body>
<canvas id="bg"></canvas>
<div class="card">
    <h1>${msg}</h1>
    <p>${desc}</p>
    <a href="${btnHref}" class="btn">${btnText}</a>
</div>
<script nonce="${getReqNonce(request)}">
const c=document.getElementById('bg');const ctx=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;
let p=[];for(let i=0;i<50;i++)p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.5});
function draw(){ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(255,51,51,0.2)';
p.forEach(e=>{e.y+=e.v;if(e.y>c.height)e.y=0;ctx.fillRect(e.x,e.y,2,2);});requestAnimationFrame(draw);}draw();
</script>
</body>
</html>`;
    return reply.code(code).type('text/html').send(html);
}

// --- 404 HANDLER ---
fastify.setNotFoundHandler((request, reply) => {
    return sendError(reply, request, 404, "404 Not Found", "The page or endpoint you are looking for does not exist.", "HOME", "/");
});

// --- IP LOCK RIGOROSO (Middleware) ---
fastify.addHook('preHandler', async (request, reply) => {
    if (request.is404) return;
    try {
        const path = (request.routerPath || request.url || "").toLowerCase();
        const publicPaths = [
            '/get-key',
            '/redeem',
            '/redeem-key',
            '/admin'
        ];
        if (request.method === 'OPTIONS') return;
        if (path === '/' || publicPaths.some(p => path.startsWith(p))) return;

        const userKey = request.query?.key || request.headers['x-asfixy-key'] || request.cookies?.asfixy_key;
        if (!userKey) return sendError(reply, request, 401, "Missing Key", "You need an active key to access this page.");

        if (userKey === MASTER_KEY) return;

        // Signature removed for now, as new-asfixy.js does not generate it.
        // if (!verifySignature(request))
        //    return sendError(reply, request, 401, "Invalid signature", "Request signature verification failed.");

        const keyDoc = await KeyModel.findOne({ key: userKey.toLowerCase() })
            .collation({ locale: 'en', strength: 2 })
            .lean();
        if (!keyDoc) return sendError(reply, request, 401, "Invalid Key", "Your key is invalid or has expired.");

        if (keyDoc.ip === "MANUAL" && !keyDoc.isPermanent) {
            return sendError(reply, request, 403, "Redeem key first", "Please redeem your key to lock it to this device.");
        }

        if (keyDoc.ip !== request.ip)
            return sendError(reply, request, 401, "IP Mismatch", "This key is registered to another device.");

        const banned = await BanModel.findOne({
            $or: [
                { ip: request.ip },
                { key: userKey }
            ]
        }).lean();

        if (banned)
            return sendError(reply, request, 403, "Banned", "Your access has been permanently revoked.");

    } catch {
        return sendError(reply, request, 500, "Auth Failure", "Internal authentication error occurred.");
    }
});

fastify.addHook('onResponse', async (req, reply) => {
    try {
        await LogModel.create({
            ip: req.ip,
            key: req.headers['x-asfixy-key'] || req.query?.key || null,
            route: req.routerPath || req.url,
            method: req.method,
            status: reply.statusCode
        });
    } catch { }
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
        <meta charset="UTF-8"><title>Keys Control</title>
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
                <h1>Keys Control</h1>
                <button class="btn-main" onclick="criarNovaKey()">+ NEW KEY</button>
            </div>
            <table>
                <thead><tr><th>Key / IP</th><th>Status / Expiry</th><th>Actions</th></tr></thead>
                <tbody>
                    ${keysData.map(item => `
                    <tr>
                        <td>
                            <span class="key-name">${escapeHtml(item.key)}</span><br>
                            <small style="opacity: 0.5; font-family: monospace;">${escapeHtml(item.ip)}</small>
                        </td>
                        <td class="timer" data-ms="${item.timeLeft}">${item.isPermanent ? '<span style="color:var(--success)">PERMANENT</span>' : formatTimeServer(item.timeLeft)}</td>
                        <td class="actions">
                            <button class="btn-opt" style="color:var(--success)" onclick="resetIP('${escapeJs(item.key)}')">RESET IP</button>
                            <button class="btn-opt" onclick="updateKey('${escapeJs(item.key)}')">EDIT</button>
                            <button class="btn-opt" onclick="revogarKey('${escapeJs(item.key)}')" style="color:var(--accent)">REVOKE</button>
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
        <script nonce="${getReqNonce(request)}">
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

fastify.post('/admin/ban', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    await BanModel.create({
        ip: r.body.ip || null,
        key: r.body.key || null,
        reason: r.body.reason || "manual"
    });

    return { success: true };
});

// --- ADMIN ACTIONS ---
fastify.post('/admin/bulk-create', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    const amount = Math.min(100, Math.max(1, parseInt(r.body.amount) || 1));

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const keys = [];

    for (let i = 0; i < amount; i++) {
        let rand = "";
        for (let j = 0; j < 23; j++)
            rand += chars[Math.floor(Math.random() * chars.length)];

        keys.push({
            key: `Asfixy-${rand}`,
            isPermanent: !!r.body.permanent,
            ip: "MANUAL"
        });
    }

    await KeyModel.insertMany(keys);
    return { success: true };
});

fastify.post('/admin/reset-ip', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    const targetKey = String(r.body.targetKey || "").toLowerCase();
    await KeyModel.updateOne({ key: targetKey }, { ip: "MANUAL" })
        .collation({ locale: 'en', strength: 2 });
    return { success: true };
});

fastify.post('/admin/edit-full', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    const { targetKey, newName, hours } = r.body;

    if (!targetKey) return rp.code(400).send();

    const update = {};

    if (newName && newName.length <= 50)
        update.key = newName.toLowerCase(); // sempre lowercase

    const h = parseInt(hours);
    if (!isNaN(h) && h > 0) {
        update.createdAt = new Date(Date.now() - (DURACAO_KEY - (h * 3600000)));
    }

    await KeyModel.updateOne({ key: targetKey.toLowerCase() }, update)
        .collation({ locale: 'en', strength: 2 });

    return { success: true };
});

fastify.post('/admin/revoke-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    const targetKey = String(r.body.targetKey || "").toLowerCase();
    await KeyModel.deleteOne({ key: targetKey })
        .collation({ locale: 'en', strength: 2 });
    return { success: true };
});

fastify.post('/admin/create-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    const name = String(r.body.customName || "").trim();
    if (!name || name.length > 50)
        return rp.code(400).send({ error: "Invalid name" });

    await KeyModel.create({
        ip: "MANUAL",
        key: name.toLowerCase(), // sempre lowercase para consistencia
        isPermanent: !!r.body.permanent
    });

    return { success: true };
});

fastify.get('/redeem', async (request, reply) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asfixy - Redeem Key</title>
        <style>
            :root { --bg: #0a0a0a; --card: #141414; --accent: #ff3333; --text: #e0e0e0; }
            body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { width: 90%; max-width: 400px; background: var(--card); border: 1px solid rgba(255,51,51,0.1); border-radius: 24px; padding: 40px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); text-align: center; }
            h1 { font-size: 1.2rem; letter-spacing: 3px; color: var(--accent); text-transform: uppercase; margin-bottom: 20px; }
            input { width: 100%; padding: 12px; background: #0a0a0a; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #fff; margin-bottom: 20px; box-sizing: border-box; text-align: center; }
            button { width: 100%; background: var(--accent); color: #fff; border: none; padding: 12px; border-radius: 12px; font-weight: bold; cursor: pointer; transition: 0.3s; }
            button:hover { transform: scale(1.02); opacity: 0.9; }
            #status { margin-top: 20px; font-size: 0.8rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Activation</h1>
            <p style="font-size: 0.8rem; opacity: 0.5;">Enter your key to lock it to this device.</p>
            <input type="text" id="keyInput" placeholder="Asfixy-XXXXXX">
            <button id="redeemBtn">ACTIVATE DEVICE</button>
            <div id="status"></div>
        </div>
        <script nonce="${getReqNonce(request)}">
            document.getElementById('redeemBtn').addEventListener('click', redeem);
            async function redeem() {
                const key = document.getElementById('keyInput').value;
                const status = document.getElementById('status');
                status.innerText = "Processing...";
                
                try {
                    const res = await fetch('/redeem-key', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key })
                    });
                    let data;
                    try {
                        data = await res.json();
                    } catch {
                        throw new Error("Invalid response");
                    }
                    if (data.valid) {
                        status.style.color = "#33ff77";
                        status.innerText = "SUCCESS: " + (data.msg || "Device Authorized");
                    } else {
                        status.style.color = "#ff3333";
                        status.innerText = "ERROR: " + (data.reason || "Invalid Key");
                    }
                } catch (e) { status.innerText = "Connection Error"; }
            }
        </script>
    </body>
    </html>`;
    reply.type('text/html').send(html);
});

fastify.get('/key-info/:key', async (request, reply) => {
    const k = await KeyModel.findOne({ key: request.params.key.toLowerCase() });
    if (!k) return { valid: false };
    if (k.isPermanent) return { valid: true, perm: true, ip: k.ip };
    const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
    if (ms <= 0) return { valid: false };
    return { valid: true, perm: false, ms, ip: k.ip };
});

fastify.get('/get-key', async (request, reply) => {
    const userIp = getClientIp(request);

    try {
        // 1. checa key permanente já existente nesse IP
        let permKey = await KeyModel.findOne({
            ip: userIp,
            isPermanent: true
        });

        let keyDoc;
        let isNew = false;
        let restanteMs;

        if (permKey) {
            // key permanente existente
            keyDoc = permKey;
            restanteMs = -1; // infinito
        } else {
            // 2. checa se já existe key temporária válida
            let existing = await KeyModel.findOne({ ip: userIp });

            if (existing && !existing.isPermanent) {
                const ms = DURACAO_KEY - (Date.now() - existing.createdAt.getTime());

                if (ms > 0) {
                    // key ainda valida, mostra ela
                    keyDoc = existing;
                    restanteMs = ms;
                    isNew = false;
                } else {
                    // key expirada, deleta e cria nova
                    await KeyModel.deleteOne({ _id: existing._id });
                    existing = null;
                }
            }

            // 3. se nao tem key valida, gera nova
            if (!keyDoc) {
                const chars = "123579";
                let rand = "";

                for (let i = 0; i < 6; i++) {
                    rand += chars[Math.floor(Math.random() * chars.length)];
                }

                keyDoc = await KeyModel.create({
                    ip: userIp,
                    key: `Asfixy-${rand}`.toLowerCase(),
                    isPermanent: false
                });

                restanteMs = DURACAO_KEY;
                isNew = true;
            }
        }

        const expiresMin = Math.ceil(restanteMs / 60000);

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Asfixy Key</title>

<style>
:root{
    --bg:#050505;
    --card:rgba(20,20,20,0.6);
    --accent:#ff3333;
    --accent-soft:rgba(255,51,51,0.15);
    --text:#eaeaea;
    --success:#33ff77;
}

*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif;}

body{
    background:radial-gradient(circle at top,#0a0a0a,#050505);
    color:var(--text);
    height:100vh;
    display:flex;
    justify-content:center;
    align-items:center;
    overflow:hidden;
}

/* PARTICLES */
canvas{
    position:fixed;
    inset:0;
    z-index:-1;
}

/* CARD */
.container{
    width:90%;
    max-width:420px;
    background:var(--card);
    backdrop-filter:blur(25px);
    border-radius:24px;
    padding:35px;
    border:1px solid rgba(255,255,255,0.05);
    box-shadow:0 20px 60px rgba(0,0,0,0.8);
    text-align:center;
    animation:fadeIn .6s ease;
}

@keyframes fadeIn{
    from{opacity:0;transform:translateY(20px);}
    to{opacity:1;transform:translateY(0);}
}

/* HEADER */
.title{
    letter-spacing:4px;
    font-size:1.2rem;
    color:var(--accent);
}

/* BADGE */
.badge{
    display:inline-block;
    margin-bottom:10px;
    padding:6px 12px;
    border-radius:20px;
    font-size:0.65rem;
    letter-spacing:1px;
}

.new{background:var(--success);color:#000;}
.old{background:#111;border:1px solid rgba(255,255,255,0.1);}
.perm{background:var(--accent);color:#fff;}

/* KEY BOX */
.key{
    margin:25px 0;
    font-size:1.6rem;
    color:var(--accent);
    background:rgba(255,51,51,0.08);
    border:1px solid rgba(255,51,51,0.2);
    padding:12px;
    border-radius:14px;
    cursor:pointer;
    transition:.2s;
}
.key:hover{
    background:rgba(255,51,51,0.15);
    transform:scale(1.03);
}

/* TIMER */
.timer{
    margin-top:10px;
    font-size:1rem;
    color:var(--accent);
    letter-spacing:2px;
}

/* BUTTON */
button{
    margin-top:20px;
    width:100%;
    padding:12px;
    border:none;
    border-radius:14px;
    background:var(--accent);
    color:#fff;
    font-weight:bold;
    cursor:pointer;
    transition:.25s;
}
button:hover{
    transform:scale(1.03);
    box-shadow:0 0 20px rgba(255,51,51,0.4);
}

/* INFO */
.info{
    margin-top:15px;
    font-size:0.7rem;
    opacity:0.5;
    line-height:1.6;
}

/* TOAST */
.toast{
    position:fixed;
    bottom:25px;
    right:25px;
    background:#111;
    border:1px solid var(--accent);
    padding:12px 18px;
    border-radius:12px;
    opacity:0;
    transform:translateY(20px);
    transition:.3s;
}
.toast.show{
    opacity:1;
    transform:translateY(0);
}
</style>
</head>

<body>

<canvas id="bg"></canvas>

<div class="container">

${keyDoc.isPermanent
                ? '<div class="badge perm">PERMANENT KEY</div>'
                : (isNew
                    ? '<div class="badge new">NEW KEY GENERATED</div>'
                    : '<div class="badge old">ACTIVE SESSION</div>')}

<div class="title">ASFIXY ACCESS</div>

<div class="key" id="key">${escapeHtml(keyDoc.key)}</div>

${keyDoc.isPermanent
                ? '<div class="timer">INFINITY</div>'
                : '<div class="timer" id="timer" data-ms="' + restanteMs + '">--:--</div>'}

<button id="copyBtn">COPY KEY</button>

<div class="info">
IP: ${escapeHtml(userIp)}<br>
${keyDoc.isPermanent ? 'Never expires' : 'Expires in ' + expiresMin + ' min'}
</div>

</div>

<div class="toast" id="toast">Copied</div>

<script nonce="${getReqNonce(request)}">
function copy(){
    navigator.clipboard.writeText(document.getElementById('key').innerText);
    showToast("Key copied");
}
document.getElementById('copyBtn').addEventListener('click', copy);
document.getElementById('key').addEventListener('click', copy);

/* TOAST */
function showToast(msg){
    const t=document.getElementById('toast');
    t.innerText=msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

/* TIMER */
function update(){
    const el=document.getElementById('timer');
    if(!el) return; // permanent keys dont have timer
    
    let ms=parseInt(el.dataset.ms);

    if(ms<=0){el.innerText="EXPIRED";return;}

    ms-=1000;
    el.dataset.ms=ms;

    const h=Math.floor(ms/3600000);
    const m=Math.floor((ms%3600000)/60000);
    const s=Math.floor((ms%60000)/1000);

    el.innerText=
        h.toString().padStart(2,'0')+":"+
        m.toString().padStart(2,'0')+":"+
        s.toString().padStart(2,'0');
}
setInterval(update,1000);
update();

/* PARTICLES */
const c=document.getElementById('bg');
const ctx=c.getContext('2d');
c.width=innerWidth;
c.height=innerHeight;

let p=[];
for(let i=0;i<70;i++){
    p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.6});
}

function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,51,51,0.2)';
    p.forEach(e=>{
        e.y+=e.v;
        if(e.y>c.height)e.y=0;
        ctx.fillRect(e.x,e.y,2,2);
    });
    requestAnimationFrame(draw);
}
draw();

localStorage.setItem("asfixy_key", document.getElementById("key").innerText);

</script>

</body>
</html>
`;

        reply.setCookie('asfixy_key', keyDoc.key, {
            path: '/',
            maxAge: 31536000,
            httpOnly: true,
            secure: IS_PROD,
            sameSite: 'Strict'
        });
        return reply.type('text/html').send(html);

    } catch (e) {
        if (!IS_PROD) console.error("get-key error:", e);
        return reply.code(500).send({ error: "Internal error" });
    }
});

// --- PUBLIC ROUTES (NO KEY REQUIRED FOR REDEEM) ---
fastify.post('/redeem-key', {
    config: {
        rateLimit: {
            max: 5,
            timeWindow: '1 minute',
            keyGenerator: (req) => getClientIp(req),
            errorResponseBuilder: () => ({
                valid: false,
                reason: "Too many requests",
                message: "Too many attempts. Please wait 1 minute."
            })
        }
    }
}, async (request, reply) => {
    try {
        const userIp = getClientIp(request);

        // --- ZOD validation ---
        const parsed = redeemBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ valid: false, reason: "Invalid input", message: parsed.error.issues[0]?.message });
        }

        const key = parsed.data.key.trim();

        const keyDoc = await KeyModel.findOne({
            key: key.toLowerCase()
        }).collation({ locale: 'en', strength: 2 });

        if (!keyDoc)
            return reply.send({ valid: false, reason: "Invalid key", message: "Invalid key" });

        if (keyDoc.ip !== "MANUAL" && keyDoc.ip !== userIp) {
            return reply.send({ valid: false, reason: "Already used", message: "Key already bound to another device" });
        }

        keyDoc.ip = userIp;
        await keyDoc.save();

        reply.setCookie('asfixy_key', keyDoc.key, {
            path: '/',
            maxAge: 31536000,
            httpOnly: true,
            secure: IS_PROD,
            sameSite: 'Strict'
        });

        return reply.send({
            valid: true,
            msg: "Activated",
            key: keyDoc.key,
            permanent: keyDoc.isPermanent
        });

    } catch (err) {
        if (!IS_PROD) console.error("redeem-key error:", err);
        return reply.code(500).send({ valid: false, reason: "Internal error" });
    }
});

// --- SCRIPT PROVIDER (key-gated, served from memory) ---
fastify.get('/script', async (request, reply) => {
    // Validate key before serving
    const userKey = request.headers['x-asfixy-key'] || request.query?.key;
    if (!userKey) return reply.code(401).send('// Unauthorized');

    if (userKey !== MASTER_KEY) {
        const keyDoc = await KeyModel.findOne({ key: String(userKey).toLowerCase() })
            .collation({ locale: 'en', strength: 2 }).lean();
        if (!keyDoc) return reply.code(403).send('// Invalid key');
    }

    if (!OBFUSCATED_SCRIPT) return reply.code(503).send('// Script unavailable');

    return reply.type('application/javascript').send(OBFUSCATED_SCRIPT);
});

// --- DATA ROUTES ---
fastify.get('/status', async (request, reply) => {
    const userKey = request.query.key || request.headers['x-asfixy-key'] || request.cookies?.asfixy_key;
    const query = userKey === MASTER_KEY ? {} : { ownerKey: userKey };

    const data = await FarmModel.find(query).select('-_id -__v');

    // Se for request de API (fetch, bot, etc)
    if (request.headers.accept?.includes('application/json')) {
        return data;
    }

    // UI PREMIUM
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Saves Storage</title>

<style>
:root {
    --bg:#050505;
    --card:rgba(20,20,20,0.7);
    --accent:#ff3333;
    --text:#eaeaea;
}

*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif;}

body{
    background:radial-gradient(circle at top,#0a0a0a,#050505);
    color:var(--text);
    padding:30px;
}

/* HEADER */
.header{
    display:flex;
    justify-content:space-between;
    margin-bottom:30px;
}
.title{
    color:var(--accent);
    letter-spacing:3px;
}
.badge{
    color:#33ff77;
    font-size:0.7rem;
}

/* GRID */
.grid{
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
    gap:20px;
}

/* CARD */
.card{
    position: relative;
    background:var(--card);
    backdrop-filter:blur(20px);
    padding:20px;
    border-radius:18px;
    border:1px solid rgba(255,255,255,0.05);
    transition:0.3s;
}
.card:hover{
    border-color:var(--accent);
    transform:translateY(-5px);
}

/* COPY BTN */
.copy-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(255,51,51,0.1);
    border: 1px solid rgba(255,51,51,0.3);
    color: var(--accent);
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 0.65rem;
    font-weight: bold;
    cursor: pointer;
    transition: 0.2s;
}
.copy-btn:hover {
    background: var(--accent);
    color: #fff;
}

/* TEXT */
.name{
    font-weight:bold;
    color:var(--accent);
}
.row{
    font-size:0.75rem;
    opacity:0.7;
    margin-top:5px;
}

/* SEARCH */
.search{
    width:100%;
    padding:10px;
    border-radius:10px;
    border:none;
    margin-bottom:20px;
    background:#111;
    color:#fff;
}

/* FOOTER */
.footer{
    text-align:center;
    margin-top:40px;
    font-size:0.7rem;
    opacity:0.3;
}

/* TOAST */
.toast{
    position:fixed;
    bottom:25px;
    right:25px;
    background:#111;
    border:1px solid var(--accent);
    padding:12px 18px;
    border-radius:12px;
    opacity:0;
    transform:translateY(20px);
    transition:.3s;
    pointer-events:none;
}
.toast.show{
    opacity:1;
    transform:translateY(0);
}
</style>
</head>

<body>

<div class="header">
<div class="title">ASFIXY STATUS</div>
<div class="badge">● LIVE (${data.length})</div>
</div>

<input class="search" id="searchInput" placeholder="Search bakery...">

<div class="grid" id="grid">
${data.map(f => `
<div class="card" data-name="${escapeHtml(String(f.bakeryName ?? ''))}"> 
    <button class="copy-btn" data-save="${escapeHtml(escapeJs(f.saveKey || ''))}">COPY</button>
    <div class="name">${escapeHtml(String(f.bakeryName ?? ''))}</div>
    <div class="row">Cookies: ${escapeHtml(String(f.cookies ?? 0))}</div>
    <div class="row">Prestige: ${escapeHtml(String(f.prestige ?? 0))}</div>
    <div class="row">CPS: ${escapeHtml(String(f.cookiesPs ?? 0))}</div>
    <div class="row">Version: ${escapeHtml(String(f.version ?? '?'))}</div>
    <div class="row">Game: ${escapeHtml(String(f.gameVersion ?? '?'))}</div>
    <div class="row">Last Update: ${escapeHtml(new Date(f.lastUpdate).toLocaleString())}</div>
</div>
`).join('')}
</div>

<div class="footer">
Realtime Farm Monitor • Asfixy Engine
</div>

<div class="toast" id="toast">Save copied!</div>

<script nonce="${getReqNonce(request)}">
document.getElementById('searchInput').addEventListener('input', function(){ filter(this.value); });
function filter(v){
    v = v.toLowerCase();
    document.querySelectorAll('.card').forEach(c=>{
        const name = c.getAttribute('data-name').toLowerCase();
        c.style.display = name.includes(v) ? 'block' : 'none';
    });
}

function copySave(saveStr) {
    if (!saveStr) return;
    navigator.clipboard.writeText(saveStr).then(() => {
        const t = document.getElementById('toast');
        t.innerText = "Save copied!";
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }).catch(() => { alert("Failed to copy save."); });
}

// Event delegation for dynamically rendered COPY buttons
document.getElementById('grid').addEventListener('click', function(e) {
    const btn = e.target.closest('.copy-btn[data-save]');
    if (btn) copySave(btn.getAttribute('data-save'));
});
</script>

</body>
</html>
    `;

    reply.type('text/html').send(html);
});

fastify.post('/update-farm', {
    config: {
        rateLimit: {
            max: 10,
            timeWindow: '10 seconds'
        }
    }
}, async (request, reply) => {

    // --- ZOD: validate x-asfixy-key header ---
    const headerParsed = keyHeaderSchema.safeParse(request.headers);
    if (!headerParsed.success)
        return reply.code(401).send({ error: "Invalid or missing key header" });

    const key = headerParsed.data['x-asfixy-key'];

    const keyDoc = await KeyModel.findOne({ key: key.toLowerCase() })
        .collation({ locale: 'en', strength: 2 });
    if (!keyDoc)
        return reply.code(403).send({ error: "Invalid key" });

    // --- ZOD: validate body ---
    const bodyParsed = updateFarmBodySchema.safeParse(request.body);
    if (!bodyParsed.success)
        return reply.code(400).send({ error: bodyParsed.error.issues[0]?.message || "Invalid body" });

    const { bakeryName, cookies, prestige, cookiesPs, version, gameVersion, saveKey } = bodyParsed.data;

    const now = Date.now();
    global.FARM_CD = global.FARM_CD || {};

    if (global.FARM_CD[key] && now - global.FARM_CD[key] < 3000)
        return reply.code(429).send({ error: "Cooldown" });

    global.FARM_CD[key] = now;

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
});

fastify.get('/download', async (r, rp) => rp.redirect('https://gofile.io/d/9c8Wlb'));
fastify.get('/', async (request, reply) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Asfixy</title>

<style>
:root {
    --bg: #050505;
    --card: rgba(20,20,20,0.7);
    --accent: #ff3333;
    --accent-soft: rgba(255,51,51,0.15);
    --text: #eaeaea;
}

* {margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif;}

body {
    background: radial-gradient(circle at top, #0a0a0a, #050505);
    color: var(--text);
    overflow-x:hidden;
}

/* LOADER */
.loader {
    position:fixed;
    inset:0;
    background:#000;
    display:flex;
    justify-content:center;
    align-items:center;
    z-index:9999;
}
.loader span {
    color:var(--accent);
    font-size:1.2rem;
    letter-spacing:4px;
    animation:pulse 1s infinite;
}
@keyframes pulse {
    0%{opacity:0.3;}
    50%{opacity:1;}
    100%{opacity:0.3;}
}

/* PARTICLES */
canvas {
    position:fixed;
    inset:0;
    z-index:-1;
}

/* CONTAINER */
.container {
    max-width:1200px;
    margin:auto;
    padding:40px 20px;
}

/* HEADER */
.header {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:40px;
}

.logo {
    font-size:1.4rem;
    letter-spacing:4px;
    color:var(--accent);
}

.status {
    background:rgba(51,255,119,0.1);
    color:#33ff77;
    padding:6px 14px;
    border-radius:20px;
    font-size:0.7rem;
}

/* HERO */
.hero {
    text-align:center;
    margin-bottom:50px;
}
.hero h1 {
    font-size:2.5rem;
}
.hero span {
    color:var(--accent);
}
.hero p {
    opacity:0.5;
    font-size:0.9rem;
    margin-top:10px;
}

/* GRID */
.grid {
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
    gap:20px;
}

/* CARD */
.card {
    background:var(--card);
    backdrop-filter:blur(20px);
    border-radius:20px;
    padding:25px;
    border:1px solid rgba(255,255,255,0.05);
    transition:0.3s;
    cursor:pointer;
    position:relative;
    overflow:hidden;
}

.card::after {
    content:'';
    position:absolute;
    inset:0;
    background:linear-gradient(120deg, transparent, rgba(255,51,51,0.2), transparent);
    opacity:0;
    transition:0.3s;
}

.card:hover {
    transform:translateY(-6px) scale(1.02);
    border-color:var(--accent);
}
.card:hover::after {
    opacity:1;
}

.card h2 {
    font-size:0.85rem;
    letter-spacing:2px;
    color:var(--accent);
}
.card p {
    font-size:0.75rem;
    opacity:0.6;
    margin-top:10px;
}

/* KEY DISPLAY */
.key-container {
    text-align:center;
    margin: 0 auto 50px auto;
    background:var(--card);
    backdrop-filter:blur(25px);
    border:1px solid rgba(255,255,255,0.05);
    padding:30px;
    border-radius:24px;
    display:flex;
    flex-direction:column;
    align-items:center;
    width:340px;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
}
.key-container .badge {
    display:inline-block;
    padding:6px 15px;
    border-radius:20px;
    font-size:0.65rem;
    letter-spacing:1px;
    border:1px solid rgba(255,255,255,0.1);
    background:#111;
    margin-bottom:15px;
}
.key-container h3 {
    color:var(--accent);
    font-size:1.2rem;
    letter-spacing:3px;
    margin-bottom:20px;
}
.key-container .key-val {
    font-size:1.5rem;
    color:var(--accent);
    background:rgba(255,51,51,0.08);
    border:1px solid rgba(255,51,51,0.2);
    padding:15px 30px;
    border-radius:14px;
    margin-bottom:20px;
    font-family:'Inter', sans-serif;
    letter-spacing: 1px;
}
.key-container .btn-get {
    display:block;
    width:100%;
    padding:14px;
    background:var(--accent);
    color:#fff;
    text-decoration:none;
    border-radius:14px;
    font-size:0.9rem;
    font-weight:bold;
    transition:0.3s;
}
.key-container .btn-get:hover {
    transform:scale(1.03);
    box-shadow:0 0 20px rgba(255,51,51,0.4);
}

/* BUTTON */
.btn {
    margin-top:10px;
    padding:10px;
    border-radius:12px;
    border:none;
    background:var(--accent);
    color:#fff;
    cursor:pointer;
}

/* TOAST */
.toast {
    position:fixed;
    bottom:20px;
    right:20px;
    background:#111;
    border:1px solid var(--accent);
    padding:15px 20px;
    border-radius:12px;
    opacity:0;
    transform:translateY(20px);
    transition:0.3s;
}
.toast.show {
    opacity:1;
    transform:translateY(0);
}

/* FOOTER */
.footer {
    text-align:center;
    margin-top:60px;
    font-size:0.7rem;
    opacity:0.3;
}
</style>
</head>

<body>

<div class="loader"><span>ASFIXY</span></div>
<canvas id="bg"></canvas>

<div class="container">

<div class="header">
<div class="logo">HeHeHe</div>
<div class="status">● ONLINE</div>
</div>

<div class="hero">
<h1>Asfixy <span>Abyss</span></h1>
<p>Secure • Fast • Locked</p>
</div>

<div class="key-container" id="keyDisplay">
    <!-- Populated by JS -->
</div>

<div class="grid">



<div class="card" data-href="/get-key">
<h2>GET KEY</h2>
<p>Generate instant acess key.</p>
</div>

<div class="card" data-href="/redeem">
<h2>REDEEM</h2>
<p>Activate IP-LOCK for Premium Keys.</p>
</div>

<div class="card" data-href="/status">
<h2>FARM STATUS</h2>
<p>View your live farms.</p>
</div>

<div class="card" data-href="/engine">
<h2>ENGINE</h2>
<p>Execute scripts remotely.</p>
</div>

<div class="card" data-href="https://discord.gg/uSvZ5BJuJ4">
<h2>DISCORD</h2>
<p>Join ur updates server.</p>
</div>

</div>

<div class="footer">
Asfixy Engine © 2026 • Premium System
</div>

</div>

<div class="toast" id="toast">Copied!</div>

<script nonce="${getReqNonce(request)}">
setTimeout(()=>document.querySelector('.loader').style.display='none',800);

/* NAV — wire cards via addEventListener (CSP blocks onclick attributes) */
document.querySelectorAll('.card[data-href]').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        const href = card.getAttribute('data-href');
        if (href.startsWith('http')) window.open(href, '_blank');
        else window.location.href = href;
    });
});

/* TOAST */
function toast(msg){
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

/* COPY */
function copyApi(){
    navigator.clipboard.writeText(location.origin + '/status');
    toast("API copied");
}

/* KEY CHECK */
const savedKey = localStorage.getItem('asfixy_key');
const kd = document.getElementById('keyDisplay');
if(savedKey) {
    kd.innerHTML = '<div class="badge">ACTIVE SESSION</div>' +
        '<h3>ASFIXY ACCESS</h3>' +
        '<div class="key-val" style="cursor:pointer;" onclick="navigator.clipboard.writeText(\'' + savedKey + '\');toast(\'Key copied!\');">' + savedKey + '</div>' +
        '<div id="keyTime" style="color:var(--accent);margin-bottom:20px;font-size:1.1rem;letter-spacing:2px;">Loading...</div>' +
        '<button class="btn-get" onclick="navigator.clipboard.writeText(\'' + savedKey + '\');toast(\'Key copied!\');">COPY KEY</button>' +
        '<div style="font-size:0.7rem;opacity:0.5;margin-top:15px;" id="keyIp">IP: Checking...</div>';

    fetch('/key-info/' + savedKey).then(r=>r.json()).then(d => {
        if(!d.valid) {
            kd.innerHTML = '<div class="badge" style="background:#ff3333;color:#fff;">EXPIRED</div><h3>SESSION ENDED</h3><a href="/get-key" class="btn-get">GET NEW KEY</a>';
            localStorage.removeItem('asfixy_key');
        } else {
            document.getElementById('keyIp').innerText = 'IP: ' + (d.ip || 'Unknown');
            if(d.perm) {
                document.getElementById('keyTime').innerText = 'LIFETIME';
            } else {
                setInterval(()=>{
                    d.ms -= 1000;
                    if(d.ms <= 0) location.reload();
                    let s = Math.floor(d.ms / 1000);
                    let h = Math.floor(s / 3600);
                    let m = Math.floor((s % 3600) / 60);
                    let sec = s % 60;
                    document.getElementById('keyTime').innerText = 
                        h.toString().padStart(2, '0') + ':' + 
                        m.toString().padStart(2, '0') + ':' + 
                        sec.toString().padStart(2, '0');
                }, 1000);
            }
        }
    }).catch(()=>{});
} else {
    kd.innerHTML = '<div class="badge" style="opacity:0.5;">NO SESSION</div>' +
        '<h3>ASFIXY ACCESS</h3>' +
        '<div class="key-val" style="color:#555;border-color:rgba(255,255,255,0.1);background:rgba(0,0,0,0.5);">---</div>' +
        '<a href="/get-key" class="btn-get">GET NEW KEY</a>';
}


/* PARTICLES */
const c = document.getElementById('bg');
const ctx = c.getContext('2d');
c.width = innerWidth;
c.height = innerHeight;

let p = [];
for(let i=0;i<60;i++){
    p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.5});
}

function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,51,51,0.2)';
    p.forEach(e=>{
        e.y+=e.v;
        if(e.y>c.height) e.y=0;
        ctx.fillRect(e.x,e.y,2,2);
    });
    requestAnimationFrame(draw);
}
draw();

</script>

</body>
</html>
`;
    reply.type('text/html').send(html);
});

let ENGINE_STATE = {};

fastify.get('/engine/status', async (req, reply) => {
    const key = req.headers['x-asfixy-key'];
    if (!key || !ENGINE_STATE[key]) return { connected: false };
    return { connected: Date.now() - ENGINE_STATE[key].lastPing < 5000 };
});

// pull request da extesao
fastify.get('/engine/pull', async (req, reply) => {
    const key = req.headers['x-asfixy-key'];
    if (!key) return reply.code(401).send({ error: "Missing key" });

    if (!ENGINE_STATE[key]) ENGINE_STATE[key] = { history: [] };

    ENGINE_STATE[key].lastPing = Date.now();

    return {
        code: ENGINE_STATE[key].code || null,
        updatedAt: ENGINE_STATE[key].updatedAt || 0
    };
});

// recebe código do site
fastify.post('/engine/execute', async (req, reply) => {
    // --- ZOD: validate header ---
    const headerParsed = keyHeaderSchema.safeParse(req.headers);
    if (!headerParsed.success)
        return reply.code(401).send({ error: "Invalid or missing key header" });

    const key = headerParsed.data['x-asfixy-key'];

    // --- ZOD: validate body ---
    const bodyParsed = engineExecuteSchema.safeParse(req.body);
    if (!bodyParsed.success)
        return reply.code(400).send({ error: bodyParsed.error.issues[0]?.message || "Invalid code" });

    const { code } = bodyParsed.data;

    const keyDoc = await KeyModel.findOne({ key: key.toLowerCase() })
        .collation({ locale: 'en', strength: 2 });
    if (!keyDoc)
        return reply.code(403).send({ error: "Invalid key" });

    // Verificacao de game aberto e extensão conectada
    const state = ENGINE_STATE[key];
    const isExtensionPinged = state && state.lastPing && (Date.now() - state.lastPing < 5000); // 5 secs

    if (!isExtensionPinged) {
        return reply.code(400).send({ error: "Game is not open or extension is not installed/connected!" });
    }

    // cooldown por execução
    if (
        ENGINE_STATE[key] &&
        Date.now() - ENGINE_STATE[key].updatedAt < 3000
    ) {
        return reply.code(429).send({ error: "Cooldown" });
    }

    // rate limit por key (20/min)
    if (!ENGINE_STATE[key]) ENGINE_STATE[key] = { history: [] };

    ENGINE_STATE[key].history =
        ENGINE_STATE[key].history.filter(
            t => Date.now() - t < 60000
        );

    if (ENGINE_STATE[key].history.length >= 20) {
        return reply.code(429).send({ error: "Too many executions" });
    }

    ENGINE_STATE[key].history.push(Date.now());

    ENGINE_STATE[key].code = code;
    ENGINE_STATE[key].updatedAt = Date.now();

    return { ok: true };
});

// recebe logs do script
fastify.post('/log', async (req, reply) => {
    const key = req.headers['x-asfixy-key'] || 'UNKNOWN_KEY';
    const { msg, type } = req.body || {};
    
    // Formata visualmente no console do server
    const t = type === 'error' ? '\x1b[31m[ERROR]\x1b[0m' : 
              type === 'warn' ? '\x1b[33m[WARN]\x1b[0m' : 
              type === 'success' ? '\x1b[32m[SUCCESS]\x1b[0m' : '\x1b[36m[INFO]\x1b[0m';
              
    console.log(`[ClientLog] ${t} [${key}] ${msg}`);
    return { ok: true };
});

fastify.get('/engine', async (req, reply) => {

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Asfixy Engine</title>

<style>
:root{
--bg:#050505;
--card:rgba(20,20,20,0.7);
--accent:#ff3333;
--text:#eaeaea;
}

*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',sans-serif;}

body{
background:radial-gradient(circle at top,#0a0a0a,#050505);
color:var(--text);
height:100vh;
display:flex;
flex-direction:column;
overflow:hidden;
}

/* HEADER */
.header{
padding:20px 30px;
background:rgba(0,0,0,0.5);
backdrop-filter:blur(10px);
border-bottom:1px solid rgba(255,255,255,0.05);
display:flex;
justify-content:space-between;
align-items:center;
}

.title{
color:var(--accent);
letter-spacing:4px;
font-weight:bold;
font-size:1.2rem;
}

.status{
font-size:0.75rem;
color:#33ff77;
background:rgba(51,255,119,0.1);
padding:6px 12px;
border-radius:20px;
}

/* MAIN LAYOUT */
.main-area{
flex:1;
display:flex;
padding:20px;
gap:20px;
max-width:1400px;
margin:0 auto;
width:100%;
min-height:0;
overflow:hidden;
}

/* EDITOR PANEL */
.editor-panel{
flex:2;
display:flex;
flex-direction:column;
background:var(--card);
border-radius:20px;
border:1px solid rgba(255,255,255,0.05);
overflow:hidden;
min-height:0;
}

.panel-header{
padding:15px 20px;
background:rgba(0,0,0,0.3);
border-bottom:1px solid rgba(255,255,255,0.05);
font-size:0.8rem;
color:var(--accent);
letter-spacing:2px;
font-weight:bold;
display:flex;
justify-content:space-between;
align-items:center;
}

textarea{
flex:1;
background:transparent;
border:none;
color:#fff;
padding:20px;
resize:none;
font-size:14px;
font-family:monospace;
outline:none;
line-height:1.5;
}

.actions{
display:flex;
gap:10px;
padding:15px;
background:rgba(0,0,0,0.3);
border-top:1px solid rgba(255,255,255,0.05);
}

button{
flex:1;
padding:14px;
border:none;
border-radius:10px;
background:rgba(255,255,255,0.05);
color:#fff;
cursor:pointer;
font-weight:bold;
transition:.3s;
font-size:0.85rem;
}

button:hover{
background:rgba(255,255,255,0.1);
}

button.primary{
background:var(--accent);
}
button.primary:hover{
background:#e62e2e;
transform:translateY(-2px);
box-shadow:0 5px 15px rgba(255,51,51,0.3);
}

/* CONSOLE PANEL */
.console-panel{
flex:1;
display:flex;
flex-direction:column;
background:var(--card);
border-radius:20px;
border:1px solid rgba(255,255,255,0.05);
overflow:hidden;
min-height:0;
}

.console{
flex:1;
padding:20px;
overflow-y:auto;
font-size:13px;
font-family:monospace;
color:#eaeaea;
display:flex;
flex-direction:column;
gap:8px;
}

.log-entry{
padding:8px 12px;
background:rgba(0,0,0,0.3);
border-radius:8px;
border-left:3px solid #555;
word-break:break-all;
}

.log-entry.error{
border-left-color:var(--accent);
color:#ff8888;
background:rgba(255,51,51,0.05);
}

.log-entry.success{
border-left-color:#33ff77;
color:#aaffaa;
background:rgba(51,255,119,0.05);
}

.log-entry.info{
border-left-color:#33aaff;
}

/* TOAST */
.toast{
position:fixed;
bottom:25px;
right:25px;
background:#111;
border:1px solid var(--accent);
padding:15px 25px;
border-radius:12px;
opacity:0;
transform:translateY(20px);
transition:.3s;
font-weight:bold;
color: #fff;
z-index:999;
}
.toast.show{
opacity:1;
transform:translateY(0);
}
.toast.error{ border-color: var(--accent); }
.toast.success{ border-color: #33ff77; }
</style>
</head>

<body>

<div class="header">
<div class="title">ASFIXY ENGINE</div>
<div class="status">● CONNECTED</div>
</div>

<div class="main-area">
    <div class="editor-panel">
        <div class="panel-header">
            <span>EXECUTOR</span>
            <span style="opacity:0.5;font-size:0.7rem;letter-spacing:0;">JS / Asfixy API</span>
        </div>
        <textarea id="code" spellcheck="false">// Write your script here...
Game.Earn(1000000);
Game.Notify('Asfixy Engine', 'Script executed successfully!', [16,5]);
</textarea>
        
        <div class="actions">
            <button id="btnExecute" class="primary">EXECUTE SCRIPT</button>
            <button id="btnClear">CLEAR</button>
            <button id="btnOpenGame">OPEN GAME</button>
        </div>
    </div>
    
    <div class="console-panel">
        <div class="panel-header">OUTPUT CONSOLE</div>
        <div class="console" id="log">
            <div class="log-entry info">System initialized. Waiting for execution...</div>
        </div>
    </div>
</div>

<div class="toast" id="toast">Message</div>

<script nonce="${getReqNonce(req)}">
function showToast(msg, type = "error"){
    const t=document.getElementById('toast');
    t.innerText=msg;
    t.className = 'toast show ' + type;
    setTimeout(()=>t.classList.remove('show'), 3000);
}

document.getElementById('btnExecute').addEventListener('click', execute);
document.getElementById('btnClear').addEventListener('click', clearCode);
document.getElementById('btnOpenGame').addEventListener('click', openGame);

function log(msg, type="info"){
    const el = document.getElementById('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    entry.innerText = "[" + time + "] " + msg;
    
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
}

function openGame(){
    const key = localStorage.getItem("asfixy_key");
    if (!key) {
        showToast("No key found! Get a key first.", "error");
        return;
    }
    const url = "https://orteil.dashnet.org/cookieclicker/?asfixy_key=" + encodeURIComponent(key);
    window.open(url, "_blank");
}

async function execute(){
    const code = document.getElementById('code').value.trim();
    const key = localStorage.getItem("asfixy_key");

    if(!key){
        log("Cannot execute: No Access Key found in LocalStorage. Please visit /get-key.", "error");
        showToast("Missing Key", "error");
        return;
    }
    
    if(!code){
        log("Cannot execute: Script is empty.", "warn");
        return;
    }

    log("Sending script payload to engine...", "info");

    try {
        const res = await fetch('/engine/execute', {
            method:'POST',
            headers:{
                'Content-Type':'application/json',
                'x-asfixy-key': key
            },
            body:JSON.stringify({code})
        });

        const data = await res.json().catch(() => ({}));

        if(res.ok){
            showToast("Payload delivered!", "success");
            log("Execution queued successfully. Waiting for game client to pull.", "success");
        } else {
            const err = data.error || "Unknown server error";
            showToast("Execution failed", "error");
            log("Execution rejected: " + err, "error");
        }
    } catch(err) {
        showToast("Network error", "error");
        log("Network error: Failed to reach Asfixy API.", "error");
    }
}

function clearCode(){
    document.getElementById('code').value = "";
    log("Editor cleared.", "info");
}

let wasConnected = false;
setInterval(async () => {
    const key = localStorage.getItem("asfixy_key");
    if (!key) return;
    try {
        const res = await fetch('/engine/status', {
            headers: { 'x-asfixy-key': key }
        });
        const data = await res.json();
        if (data.connected && !wasConnected) {
            showToast("Injection Successful", "success");
            log("Game connected to Asfixy Engine.", "success");
            wasConnected = true;
        } else if (!data.connected && wasConnected) {
            wasConnected = false;
            log("Game connection lost.", "error");
        }
    } catch(e) {}
}, 2000);

</script>

</body>
</html>
`;


    reply.type('text/html').send(html);
});

// Limpeza periodica de rate limits e ENGINE_STATE (evita memory leak)
setInterval(() => {
    const now = Date.now();

    // Limpa ENGINE_STATE
    for (const k in ENGINE_STATE) {
        if (now - ENGINE_STATE[k].updatedAt > 60000) {
            delete ENGINE_STATE[k];
        }
    }

    // Limpa rate limit Map (RL)
    for (const [ip, times] of RL.entries()) {
        const fresh = times.filter(t => now - t < 60000);
        if (fresh.length === 0) {
            RL.delete(ip);
        } else {
            RL.set(ip, fresh);
        }
    }
}, 30000);

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });