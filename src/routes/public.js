/**
 * Public Routes
 * GET / (home), /download, /key-info, /status
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { KeyModel, FarmModel } = require('../models');
const { escapeHtml, escapeJs } = require('../lib/security');
const { DURACAO_KEY } = require('../lib/constants');
const { MASTER_KEY, IS_PROD } = require('../config/env');
const { getClientIp } = require('../lib/network');

// Load and obfuscate script at startup
let OBFUSCATED_SCRIPT = '';
function loadObfuscatedScript() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'Scripts', 'asfixy.js'), 'utf8');
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
}

loadObfuscatedScript();

/**
 * Helper to format time for server rendering
 */
function formatTimeServer(ms) {
    if (ms < 0) return "INFINITY";
    let s = Math.floor(ms / 1000);
    let h = Math.floor(s / 3600);
    let m = Math.floor((s % 3600) / 60);
    let sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

/**
 * GET /
 * Home page with key display and navigation
 */
async function homeRoute(request, reply) {
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

canvas {
    position:fixed;
    inset:0;
    z-index:-1;
}

.container {
    max-width:1200px;
    margin:auto;
    padding:40px 20px;
}

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

.grid {
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
    gap:20px;
}

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

.btn {
    margin-top:10px;
    padding:10px;
    border-radius:12px;
    border:none;
    background:var(--accent);
    color:#fff;
    cursor:pointer;
}

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

<script nonce="${request.nonce}">
setTimeout(()=>document.querySelector('.loader').style.display='none',800);

document.querySelectorAll('.card[data-href]').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        const href = card.getAttribute('data-href');
        if (href.startsWith('http')) window.open(href, '_blank');
        else window.location.href = href;
    });
});

function toast(msg){
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

function copyApi(){
    navigator.clipboard.writeText(location.origin + '/status');
    toast("API copied");
}

const savedKey = localStorage.getItem('asfixy_key');
const kd = document.getElementById('keyDisplay');
if(savedKey) {
    kd.innerHTML = '<div class="badge">ACTIVE SESSION</div>' +
        '<h3>ASFIXY ACCESS</h3>' +
        '<div class="key-val" style="cursor:pointer;">' + savedKey + '</div>' +
        '<div id="keyTime" style="color:var(--accent);margin-bottom:20px;font-size:1.1rem;letter-spacing:2px;">Loading...</div>' +
        '<button class="btn-get" onclick="navigator.clipboard.writeText(\\\'' + savedKey + '\\\');toast(\\\'Key copied!\\\');">COPY KEY</button>' +
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
}

/**
 * GET /download
 * Redirect to download page
 */
async function downloadRoute(request, reply) {
    return reply.redirect('https://gofile.io/d/9c8Wlb');
}

/**
 * GET /key-info/:key
 * Get information about a key
 */
async function keyInfoRoute(request, reply) {
    try {
        const k = await KeyModel.findOne({ key: request.params.key.toLowerCase() });
        if (!k) return { valid: false };
        
        if (k.isPermanent) {
            return { valid: true, perm: true, ip: k.ip };
        }
        
        const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
        if (ms <= 0) return { valid: false };
        
        return { valid: true, perm: false, ms, ip: k.ip };
    } catch (e) {
        return { valid: false };
    }
}

/**
 * GET /status
 * Farm status dashboard
 */
async function statusRoute(request, reply) {
    try {
        const userKey = request.query.key || request.headers['x-asfixy-key'] || request.cookies?.asfixy_key;
        const query = userKey === MASTER_KEY ? {} : { ownerKey: userKey };

        const data = await FarmModel.find(query).select('-_id -__v');

        // JSON API response
        if (request.headers.accept?.includes('application/json')) {
            return data;
        }

        // HTML UI
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

.grid{
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(300px,1fr));
    gap:20px;
}

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

.name{
    font-weight:bold;
    color:var(--accent);
}
.row{
    font-size:0.75rem;
    opacity:0.7;
    margin-top:5px;
}

.search{
    width:100%;
    padding:10px;
    border-radius:10px;
    border:none;
    margin-bottom:20px;
    background:#111;
    color:#fff;
}

.footer{
    text-align:center;
    margin-top:40px;
    font-size:0.7rem;
    opacity:0.3;
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
\`).join('')}
</div>

<div class="footer">
Realtime Farm Monitor • Asfixy Engine
</div>

<div class="toast" id="toast">Save copied!</div>

<script nonce="${request.nonce}">
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

document.getElementById('grid').addEventListener('click', function(e) {
    const btn = e.target.closest('.copy-btn[data-save]');
    if (btn) copySave(btn.getAttribute('data-save'));
});
</script>

</body>
</html>
`;

        reply.type('text/html').send(html);
    } catch (e) {
        if (!IS_PROD) console.error("status route error:", e);
        return reply.code(500).send({ error: "Internal error" });
    }
}

/**
 * GET /script
 * Serve obfuscated game script
 */
async function scriptRoute(request, reply) {
    try {
        const userKey = request.headers['x-asfixy-key'] || request.query?.key;
        if (!userKey) return reply.code(401).send('// Unauthorized');

        if (userKey !== MASTER_KEY) {
            const keyDoc = await KeyModel.findOne({ key: String(userKey).toLowerCase() })
                .collation({ locale: 'en', strength: 2 }).lean();
            if (!keyDoc) return reply.code(403).send('// Invalid key');
        }

        if (!OBFUSCATED_SCRIPT) return reply.code(503).send('// Script unavailable');

        return reply.type('application/javascript').send(OBFUSCATED_SCRIPT);
    } catch (e) {
        if (!IS_PROD) console.error("script route error:", e);
        return reply.code(500).send('// Server error');
    }
}

module.exports = {
    homeRoute,
    downloadRoute,
    keyInfoRoute,
    statusRoute,
    scriptRoute
};
