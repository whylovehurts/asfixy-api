/**
 * Authentication Middleware
 * Key validation, IP binding, ban checking
 */

const { KeyModel, BanModel } = require('../models');
const { MASTER_KEY, IS_PROD } = require('../config/env');
const { getClientIp } = require('../lib/network');
const { PUBLIC_PATHS, DURACAO_KEY } = require('../lib/constants');

/**
 * Auth middleware: validates key and enforces IP binding
 */
async function authMiddleware(request, reply) {
    try {
        const path = (request.routerPath || request.url || "").toLowerCase();
        
        // Skip auth for public paths and OPTIONS requests
        if (request.method === 'OPTIONS') return;
        if (path === '/' || PUBLIC_PATHS.some(p => path.startsWith(p))) return;

        // Get key from query, header, or cookie
        const userKey = request.query?.key || request.headers['x-asfixy-key'] || request.cookies?.asfixy_key;
        if (!userKey) {
            return sendError(reply, request, 401, "Missing Key", "You need an active key to access this page.");
        }

        // Master key bypass
        if (userKey === MASTER_KEY) return;

        // Look up key in database
        const keyDoc = await KeyModel.findOne({ key: userKey.toLowerCase() })
            .collation({ locale: 'en', strength: 2 })
            .lean();
        
        if (!keyDoc) {
            return sendError(reply, request, 401, "Invalid Key", "Your key is invalid or has expired.");
        }

        // Check if temporary key needs to be redeemed first
        if (keyDoc.ip === "MANUAL" && !keyDoc.isPermanent) {
            return sendError(reply, request, 403, "Redeem key first", "Please redeem your key to lock it to this device.");
        }

        // Enforce IP binding (non-permanent keys only)
        if (!keyDoc.isPermanent && keyDoc.ip !== request.ip) {
            return sendError(reply, request, 401, "IP Mismatch", "This key is registered to another device.");
        }

        // Check ban list
        const clientIp = getClientIp(request);
        const banned = await BanModel.findOne({
            $or: [
                { ip: clientIp },
                { key: userKey }
            ]
        }).lean();

        if (banned) {
            return sendError(reply, request, 403, "Banned", "Your access has been permanently revoked.");
        }

    } catch (e) {
        if (!IS_PROD) console.error("[Auth Error]", e);
        return sendError(reply, request, 500, "Auth Failure", "Internal authentication error occurred.");
    }
}

/**
 * Error response helper for HTML and JSON
 */
function sendError(reply, request, code, msg, desc, btnText = "GET NEW KEY", btnHref = "/get-key") {
    if (request.method !== 'GET' || request.headers.accept?.includes('application/json')) {
        return reply.code(code).send({ error: msg });
    }
    
    const nonce = request.nonce || '';
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
<script nonce="${nonce}">
const c=document.getElementById('bg');const ctx=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;
let p=[];for(let i=0;i<50;i++)p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.5});
function draw(){ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(255,51,51,0.2)';
p.forEach(e=>{e.y+=e.v;if(e.y>c.height)e.y=0;ctx.fillRect(e.x,e.y,2,2);});requestAnimationFrame(draw);}draw();
</script>
</body>
</html>`;
    return reply.code(code).type('text/html').send(html);
}

module.exports = {
    authMiddleware,
    sendError
};
