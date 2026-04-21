/**
 * Authentication Routes
 * Key generation, redemption, validation
 */

const { KeyModel } = require('../models');
const { DURACAO_KEY } = require('../lib/constants');
const { MASTER_KEY, IS_PROD } = require('../config/env');
const { getClientIp } = require('../lib/network');
const { escapeHtml } = require('../lib/security');
const { redeemBodySchema } = require('../middleware/validation');

/**
 * GET /get-key
 * Generate or retrieve access key
 */
async function getKeyRoute(request, reply) {
    try {
        const userIp = getClientIp(request);

        // Check for existing permanent key
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
            // Check for existing temp key
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

canvas{
    position:fixed;
    inset:0;
    z-index:-1;
}

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

.title{
    letter-spacing:4px;
    font-size:1.2rem;
    color:var(--accent);
}

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

.timer{
    margin-top:10px;
    font-size:1rem;
    color:var(--accent);
    letter-spacing:2px;
}

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

.info{
    margin-top:15px;
    font-size:0.7rem;
    opacity:0.5;
    line-height:1.6;
}

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

<script nonce="${request.nonce}">
function copy(){
    navigator.clipboard.writeText(document.getElementById('key').innerText);
    showToast("Key copied");
}
document.getElementById('copyBtn').addEventListener('click', copy);
document.getElementById('key').addEventListener('click', copy);

function showToast(msg){
    const t=document.getElementById('toast');
    t.innerText=msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

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

    el.innerText=
        h.toString().padStart(2,'0')+":"+
        m.toString().padStart(2,'0')+":"+
        s.toString().padStart(2,'0');
}
setInterval(update,1000);
update();

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
}

/**
 * POST /redeem-key
 * Redeem a key to lock it to user's IP
 */
async function redeemKeyRoute(request, reply) {
    try {
        const userIp = getClientIp(request);

        // Validate input
        const parsed = redeemBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ valid: false, reason: "Invalid input", message: parsed.error.issues[0]?.message });
        }

        const key = parsed.data.key.trim();

        const keyDoc = await KeyModel.findOne({
            key: key.toLowerCase()
        }).collation({ locale: 'en', strength: 2 });

        if (!keyDoc) {
            return reply.send({ valid: false, reason: "Invalid key", message: "Invalid key" });
        }

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
}

/**
 * GET /redeem
 * Redeem page UI
 */
async function redeemPageRoute(request, reply) {
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
            <input type="text" id="keyInput" placeholder="asfixy-XXXXXX">
            <button id="redeemBtn">ACTIVATE DEVICE</button>
            <div id="status"></div>
        </div>
        <script nonce="${request.nonce}">
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
}

module.exports = {
    getKeyRoute,
    redeemKeyRoute,
    redeemPageRoute
};
