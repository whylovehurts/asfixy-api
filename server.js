const fastify = require('fastify')({ 
    logger: true,
    trustProxy: true 
});
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

function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
    try {
        const path = (request.routerPath || request.url || "").toLowerCase();
        const publicPaths = ['/get-key', '/redeem', '/redeem-key', '/admin', '/download', '/script/'];
        if (path === '/' || publicPaths.some(p => path.startsWith(p))) return;

        const userKey = request.query?.key || request.headers['x-asfixy-key'];
        if (!userKey) return reply.code(401).send({ error: "Missing Key" });

        if (userKey === MASTER_KEY) return;

        const keyDoc = await KeyModel.findOne({ key: userKey }).lean();
        if (!keyDoc) return reply.code(401).send({ error: "Invalid Key" });

        if (keyDoc.ip === "MANUAL")
            return reply.code(403).send({ error: "Redeem key first" });

        if (keyDoc.ip !== request.ip)
            return reply.code(401).send({ error: "IP mismatch" });

    } catch {
        return reply.code(500).send({ error: "Auth failure" });
    }
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
    await KeyModel.updateOne({ key: r.body.targetKey }, { ip: "MANUAL" });
    return { success: true };
});

fastify.post('/admin/edit-full', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    const { targetKey, newName, hours } = r.body;

    if (!targetKey) return rp.code(400).send();

    const update = {};

    if (newName && newName.length <= 50)
        update.key = newName;

    const h = parseInt(hours);
    if (!isNaN(h) && h > 0) {
        update.createdAt = new Date(Date.now() - (DURACAO_KEY - (h * 3600000)));
    }

    await KeyModel.updateOne({ key: targetKey }, update);

    return { success: true };
});

fastify.post('/admin/revoke-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();
    await KeyModel.deleteOne({ key: r.body.targetKey });
    return { success: true };
});

fastify.post('/admin/create-key', async (r, rp) => {
    if (r.query.key !== MASTER_KEY) return rp.code(403).send();

    const name = String(r.body.customName || "").trim();
    if (!name || name.length > 50)
        return rp.code(400).send({ error: "Invalid name" });

    await KeyModel.create({
        ip: "MANUAL",
        key: name,
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
            <button onclick="redeem()">ACTIVATE DEVICE</button>
            <div id="status"></div>
        </div>
        <script>
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

// --- PUBLIC ROUTES (NO KEY REQUIRED FOR REDEEM) ---
fastify.post('/redeem-key', async (request, reply) => {
    try {
        const key = String(request.body?.key || "").trim();
        const userIp = request.ip;

        if (!key)
            return reply.code(400).send({ valid: false, reason: "Key required" });

        const keyDoc = await KeyModel.findOne({ key });
        if (!keyDoc)
            return { valid: false, reason: "Not found" };

        if (keyDoc.ip === "MANUAL") {
            await KeyModel.updateOne({ key }, { ip: userIp });
            return { valid: true, msg: "Activated" };
        }

        if (keyDoc.ip === userIp)
            return { valid: true, msg: "Already active" };

        return { valid: false, reason: "Locked to another IP" };

    } catch {
        return reply.code(500).send({ valid: false });
    }
});

fastify.get('/get-key', async (request, reply) => {
    const userIp = request.ip;

    let keyDoc = await KeyModel.findOne({ ip: userIp });
    let isNew = false;

    if (!keyDoc) {
        const chars = "123579";
        let rand = "";
        for (let i = 0; i < 6; i++) {
            rand += chars[Math.floor(Math.random() * chars.length)];
        }

        keyDoc = await KeyModel.create({
            ip: userIp,
            key: `Asfixy-${rand}`
        });

        isNew = true;
    }

    const restanteMs = Math.max(0, DURACAO_KEY - (Date.now() - keyDoc.createdAt.getTime()));
    const expiresMin = Math.max(0, Math.round(restanteMs / 60000));

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

${isNew 
    ? '<div class="badge new">NEW KEY GENERATED</div>' 
    : '<div class="badge old">ACTIVE SESSION</div>'}

<div class="title">ASFIXY ACCESS</div>

<div class="key" id="key">${keyDoc.key}</div>

<div class="timer" id="timer" data-ms="${restanteMs}">--:--</div>

<button onclick="copy()">COPY KEY</button>

<div class="info">
IP: ${userIp}<br>
Expires in ${expiresMin} min
</div>

</div>

<div class="toast" id="toast">Copied</div>

<script>

/* COPY */
function copy(){
    navigator.clipboard.writeText(document.getElementById('key').innerText);
    showToast("Key copied");
}

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

</script>

</body>
</html>
`;

    reply.type('text/html').send(html);
});

// --- DATA ROUTES ---
fastify.get('/status', async (request, reply) => {
    const userKey = request.query.key || request.headers['x-asfixy-key'];
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
</style>
</head>

<body>

<div class="header">
<div class="title">ASFIXY STATUS</div>
<div class="badge">● LIVE (${data.length})</div>
</div>

<input class="search" placeholder="Search bakery..." oninput="filter(this.value)">

<div class="grid" id="grid">
${data.map(f => `
<div class="card" data-name="${f.bakeryName}">
    <div class="name">${f.bakeryName}</div>
    <div class="row">Cookies: ${f.cookies ?? 0}</div>
    <div class="row">Prestige: ${f.prestige ?? 0}</div>
    <div class="row">CPS: ${f.cookiesPs ?? 0}</div>
    <div class="row">Version: ${f.version ?? "?"}</div>
    <div class="row">Game: ${f.gameVersion ?? "?"}</div>
    <div class="row">Last Update: ${new Date(f.lastUpdate).toLocaleString()}</div>
</div>
`).join('')}
</div>

<div class="footer">
Realtime Farm Monitor • Asfixy Engine
</div>

<script>
function filter(v){
    v = v.toLowerCase();
    document.querySelectorAll('.card').forEach(c=>{
        const name = c.getAttribute('data-name').toLowerCase();
        c.style.display = name.includes(v) ? 'block' : 'none';
    });
}
</script>

</body>
</html>
    `;

    reply.type('text/html').send(html);
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

/* STATS */
.stats {
    display:flex;
    justify-content:center;
    gap:30px;
    margin:40px 0;
}
.stat {
    text-align:center;
}
.stat h3 {
    font-size:1.5rem;
    color:var(--accent);
}
.stat p {
    font-size:0.7rem;
    opacity:0.5;
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

<div class="stats">
<div class="stat">
<h3 id="users">0</h3>
<p>ACTIVE FARMS</p>
</div>
<div class="stat">
<h3>99.9%</h3>
<p>UPTIME</p>
</div>
<div class="stat">
<h3>V1.1</h3>
<p>VERSION</p>
</div>
</div>

<div class="grid">

<div class="card" onclick="go('/download')">
<h2>DOWNLOAD</h2>
<p>Get latest extension engine build.</p>
</div>

<div class="card" onclick="go('/get-key')">
<h2>GET KEY</h2>
<p>Generate instant acess key.</p>
</div>

<div class="card" onclick="go('/redeem')">
<h2>REDEEM</h2>
<p>Activate IP-LOCK for Premium Keys.</p>
</div>

<div class="card" onclick="copyApi()">
<h2>API STATUS</h2>
<p>Copy url endpoint.</p>
<button class="btn">COPY</button>
</div>

<div class="card" onclick="go('https://discord.gg/uSvZ5BJuJ4')">
<h2>DISCORD</h2>
<p>Join ur updates server.</p>
</div>

</div>

<div class="footer">
Asfixy Engine © 2026 • Premium System
</div>

</div>

<div class="toast" id="toast">Copied!</div>

<script>

/* LOADER */
setTimeout(()=>document.querySelector('.loader').style.display='none',800);

/* NAV */
function go(url){ window.open(url, '_self'); }

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

/* FETCH STATS */
fetch('/status')
.then(r=>r.json())
.then(data=>{
    document.getElementById('users').innerText = data.length || 0;
}).catch(()=>{});

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

let ENGINE_STATE = {
    code: "",
    updatedAt: 0
};

// recebe código do site
fastify.post('/engine/execute', async (req, reply) => {
    const code = String(req.body?.code || "");
    if (!code) return reply.code(400).send();

    ENGINE_STATE.code = code;
    ENGINE_STATE.updatedAt = Date.now();

    return { ok: true };
});

// extensão puxa código
fastify.get('/engine/pull', async (req, reply) => {
    return ENGINE_STATE;
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
--card:#111;
--accent:#ff3333;
--text:#eaeaea;
}

*{margin:0;padding:0;box-sizing:border-box;font-family:monospace;}

body{
background:radial-gradient(circle at top,#0a0a0a,#050505);
color:var(--text);
height:100vh;
display:flex;
flex-direction:column;
}

/* HEADER */
.header{
padding:15px 20px;
background:#000;
border-bottom:1px solid rgba(255,255,255,0.05);
display:flex;
justify-content:space-between;
align-items:center;
}

.title{
color:var(--accent);
letter-spacing:3px;
}

.status{
font-size:0.7rem;
color:#33ff77;
}

/* EDITOR */
.editor{
flex:1;
display:flex;
flex-direction:column;
padding:15px;
}

textarea{
flex:1;
background:#0a0a0a;
border:1px solid rgba(255,255,255,0.05);
color:#fff;
padding:15px;
border-radius:12px;
resize:none;
font-size:13px;
outline:none;
}

/* ACTIONS */
.actions{
display:flex;
gap:10px;
margin-top:10px;
}

button{
flex:1;
padding:12px;
border:none;
border-radius:12px;
background:var(--accent);
color:#fff;
cursor:pointer;
font-weight:bold;
transition:.2s;
}

button:hover{
transform:scale(1.03);
box-shadow:0 0 15px rgba(255,51,51,0.4);
}

/* CONSOLE */
.console{
height:120px;
background:#000;
margin-top:10px;
border-radius:12px;
padding:10px;
font-size:11px;
overflow:auto;
opacity:0.7;
}

</style>
</head>

<body>

<div class="header">
<div class="title">ASFIXY ENGINE</div>
<div class="status">● CONNECTED</div>
</div>

<div class="editor">

<textarea id="code">
// Example:
Game.Earn(1000000);
</textarea>

<div class="actions">
<button onclick="execute()">EXECUTE</button>
<button onclick="clearCode()">CLEAR</button>
</div>

<div class="console" id="log"></div>

</div>

<script>

function log(msg){
    const el = document.getElementById('log');
    el.innerHTML += msg + "<br>";
    el.scrollTop = el.scrollHeight;
}

async function execute(){
    const code = document.getElementById('code').value;

    const res = await fetch('/engine/execute', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({code})
    });

    if(res.ok){
        log("> sent to engine");
    }else{
        log("> error");
    }
}

function clearCode(){
    document.getElementById('code').value = "";
}

</script>

</body>
</html>
`;

reply.type('text/html').send(html);
});

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });