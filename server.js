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

// --- SRC MODULE IMPORTS ---
// Using src/models for schemas (registered on require)
require('./src/models');
const { connectDatabase } = require('./src/config/database');
const { PUBLIC_PATHS, DURACAO_KEY } = require('./src/lib/constants');
const { MASTER_KEY, IS_PROD } = require('./src/config/env');
const { getClientIp, isValidIp } = require('./src/lib/network');
const { escapeHtml, escapeJs, generateNonce } = require('./src/lib/security');
const { keyHeaderSchema, redeemBodySchema, updateFarmBodySchema, engineExecuteSchema, sanitizeInput } = require('./src/middleware/validation');
const { authMiddleware } = require('./src/middleware/auth');

// Note: Route handlers kept inline due to template literal issues with ${request.nonce}
// Admin routes imported from src/routes/admin.js
const { adminPageRoute, adminBanRoute, adminUnbanRoute, adminBulkCreateRoute, adminBulkDeleteRoute, adminResetIpRoute, adminEditFullRoute, adminRevokeKeyRoute, adminCreateKeyRoute } = require('./src/routes/admin');

// Import models from src
const { KeyModel, FarmModel, BanModel, LogModel } = require('./src/models');

// Strip ALL HTML tags — returns plain text only
function stripHtml(value) {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

require('dotenv').config();

// --- ENV VARIABLES (imported from src/config/env.js) ---
const { MONGO_URI, SIGN_SECRET } = require('./src/config/env');

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

// Note: Zod schemas are now imported from src/middleware/validation

// Helper para o Node.js renderizar o tempo inicial no servidor
// Note: escapeHtml, escapeJs, getClientIp are imported from src/lib/

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

// Note: Models are now imported from src/models (KeyModel, FarmModel, BanModel, LogModel)
// Models are registered with mongoose when src/models/index.js is required

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
    req.nonce = nonce; // Make available to routes
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
    'https://asfixy.up.railway.app',
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

// Note: sanitizeInput is imported from src/middleware/validation

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
            '/admin',
            '/download',
            '/key-info',
            '/engine/status',
            '/engine/pull',
            '/engine/execute',
            '/script',
            '/log'
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

        // Keys permanentes não precisam de IP match (podem ser usadas de qualquer lugar)
        if (!keyDoc.isPermanent && keyDoc.ip !== request.ip)
            return sendError(reply, request, 401, "IP Mismatch", "This key is registered to another device.");

        const clientIp = getClientIp(request);
        const banned = await BanModel.findOne({
            $or: [
                { ip: clientIp },
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
// Imported from src/routes/admin.js
fastify.get('/admin', adminPageRoute);
fastify.post('/admin/ban', adminBanRoute);
fastify.post('/admin/unban', adminUnbanRoute);
fastify.post('/admin/bulk-create', adminBulkCreateRoute);
fastify.post('/admin/bulk-delete', adminBulkDeleteRoute);
fastify.post('/admin/reset-ip', adminResetIpRoute);
fastify.post('/admin/edit-full', adminEditFullRoute);
fastify.post('/admin/revoke-key', adminRevokeKeyRoute);
fastify.post('/admin/create-key', adminCreateKeyRoute);

fastify.get('/redeem', async (request, reply) => {
    const templateLoader = require('./src/lib/templateLoader');
    const html = templateLoader.render('redeem', {
        NONCE: getReqNonce(request)
    });
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
        let permKey = await KeyModel.findOne({
            ip: userIp,
            isPermanent: true
        });

        let keyDoc;
        let isNew = false;
        let restanteMs;

        if (permKey) {
            keyDoc = permKey;
            restanteMs = -1;
        } else {
            let existing = await KeyModel.findOne({ ip: userIp });

            if (existing && !existing.isPermanent) {
                const ms = DURACAO_KEY - (Date.now() - existing.createdAt.getTime());

                if (ms > 0) {
                    keyDoc = existing;
                    restanteMs = ms;
                    isNew = false;
                } else {
                    await KeyModel.deleteOne({ _id: existing._id });
                    existing = null;
                }
            }

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

        const templateLoader = require('./src/lib/templateLoader');

        let badge, timer, timerScript, expiryText;

        if (keyDoc.isPermanent) {
            badge = '<div class="badge perm">PERMANENT KEY</div>';
            timer = '<div class="timer">INFINITY</div>';
            timerScript = '';
            expiryText = 'Never expires';
        } else {
            if (isNew) {
                badge = '<div class="badge new">NEW KEY GENERATED</div>';
            } else {
                badge = '<div class="badge old">ACTIVE SESSION</div>';
            }
            timer = `<div class="timer" id="timer" data-ms="${restanteMs}">--:--</div>`;
            timerScript = `
function update(){
    const el=document.getElementById('timer');
    if(!el) return;
    let ms=parseInt(el.dataset.ms);
    if(ms<=0){el.innerText="EXPIRED";return;}
    ms-=1000;
    el.dataset.ms=ms;
    const h=Math.floor(ms/3600000);
    const m=Math.floor((ms%3600000)/60000);
    const s=Math.floor((ms%60000)/1000);
    el.innerText=h.toString().padStart(2,'0')+":"+m.toString().padStart(2,'0')+":"+s.toString().padStart(2,'0');
}
setInterval(update,1000);
update();`;
            expiryText = `Expires in ${expiresMin} min`;
        }

        const html = templateLoader.render('get-key', {
            NONCE: getReqNonce(request),
            KEY: escapeHtml(keyDoc.key),
            BADGE: badge,
            TIMER: timer,
            USER_IP: escapeHtml(userIp),
            EXPIRY_TEXT: expiryText,
            TIMER_SCRIPT: timerScript
        });

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

    if (request.headers.accept?.includes('application/json')) {
        return data;
    }

    const templateLoader = require('./src/lib/templateLoader');
    const cardsHtml = data.map(f => `
<div class="card" data-name="${escapeHtml(String(f.bakeryName ?? ''))}"> 
    <button class="copy-btn" data-save="${escapeHtml(escapeJs(f.saveKey || ''))}">COPY</button>
    <div class="name">${escapeHtml(String(f.bakeryName ?? ''))}</div>
    <div class="row">Cookies: ${escapeHtml(String(f.cookies ?? 0))}</div>
    <div class="row">Prestige: ${escapeHtml(String(f.prestige ?? 0))}</div>
    <div class="row">CPS: ${escapeHtml(String(f.cookiesPs ?? 0))}</div>
    <div class="row">Version: ${escapeHtml(String(f.version ?? '?'))}</div>
    <div class="row">Game: ${escapeHtml(String(f.gameVersion ?? '?'))}</div>
    <div class="row">Last Update: ${escapeHtml(new Date(f.lastUpdate).toLocaleString())}</div>
</div>`).join('');

    const html = templateLoader.render('status', {
        NONCE: getReqNonce(request),
        COUNT: data.length,
        CARDS: cardsHtml
    });

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

fastify.get('/download', async (r, rp) => rp.redirect('https://gofile.io/d/8LVraB'));
fastify.get('/', async (request, reply) => {
    const templateLoader = require('./src/lib/templateLoader');
    const html = templateLoader.render('home', {
        NONCE: getReqNonce(request)
    });
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

    const code = ENGINE_STATE[key].code || null;
    ENGINE_STATE[key].code = null;

    return {
        code: code,
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

    // cooldown por execução (separado do lastPing para evitar conflito)
    const lastExecute = ENGINE_STATE[key].lastExecute || 0;
    if (Date.now() - lastExecute < 3000) {
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
    ENGINE_STATE[key].lastExecute = Date.now(); // Separate from updatedAt to avoid conflict with ping check
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
    const templateLoader = require('./src/lib/templateLoader');
    const html = templateLoader.render('engine', {
        NONCE: getReqNonce(req)
    });
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