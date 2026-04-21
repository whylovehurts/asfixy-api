/**
 * Engine Routes
 * Code execution, status checks, logging
 */

const { KeyModel } = require('../models');
const { keyHeaderSchema, engineExecuteSchema } = require('../middleware/validation');
const { IS_PROD } = require('../config/env');
const { ENGINE_PING_TIMEOUT_MS, ENGINE_COOLDOWN_MS } = require('../lib/constants');
const {
    ENGINE_STATE,
    initializeEngine,
    getEngineState,
    setEngineCode,
    updateEnginePing,
    isEngineConnected,
    recordExecution,
    getExecutionCount,
    parseGameCode
} = require('../lib/engine');

/**
 * GET /engine/status
 * Check if extension is connected
 */
async function engineStatusRoute(request, reply) {
    try {
        const key = request.headers['x-asfixy-key'];
        if (!key || !getEngineState(key)) {
            return { connected: false };
        }
        return { connected: isEngineConnected(key, ENGINE_PING_TIMEOUT_MS) };
    } catch (e) {
        return { connected: false };
    }
}

/**
 * GET /engine/pull
 * Extension pulls pending code
 */
async function enginePullRoute(request, reply) {
    try {
        const key = request.headers['x-asfixy-key'];
        if (!key) {
            return reply.code(401).send({ error: "Missing key" });
        }

        initializeEngine(key);
        updateEnginePing(key);

        const state = getEngineState(key);
        const code = state.code || null;
        state.code = null;

        return {
            code: code,
            updatedAt: state.updatedAt || 0
        };
    } catch (e) {
        if (!IS_PROD) console.error("engine/pull error:", e);
        return reply.code(500).send({ error: "Internal error" });
    }
}

/**
 * POST /engine/execute
 * Execute code on the extension (with whitelist validation)
 */
async function engineExecuteRoute(request, reply) {
    try {
        // Validate key header
        const headerParsed = keyHeaderSchema.safeParse(request.headers);
        if (!headerParsed.success) {
            return reply.code(401).send({ error: "Invalid or missing key header" });
        }

        const key = headerParsed.data['x-asfixy-key'];

        // Validate body
        const bodyParsed = engineExecuteSchema.safeParse(request.body);
        if (!bodyParsed.success) {
            return reply.code(400).send({ error: bodyParsed.error.issues[0]?.message || "Invalid code" });
        }

        const { code } = bodyParsed.data;

        // Validate key exists
        const keyDoc = await KeyModel.findOne({ key: key.toLowerCase() })
            .collation({ locale: 'en', strength: 2 });
        if (!keyDoc) {
            return reply.code(403).send({ error: "Invalid key" });
        }

        // CRITICAL SECURITY: Validate code against whitelist
        let commands;
        try {
            commands = parseGameCode(code);
        } catch (e) {
            return reply.code(400).send({ error: `Invalid code: ${e.message}` });
        }

        // Check if extension is connected
        const isConnected = isEngineConnected(key, ENGINE_PING_TIMEOUT_MS);
        if (!isConnected) {
            return reply.code(400).send({ error: "Game is not open or extension is not installed/connected!" });
        }

        // Cooldown check
        const state = getEngineState(key);
        const lastExecute = state?.lastExecute || 0;
        if (Date.now() - lastExecute < ENGINE_COOLDOWN_MS) {
            return reply.code(429).send({ error: "Cooldown" });
        }

        // Rate limit per key (20/min)
        recordExecution(key);
        if (getExecutionCount(key) > 20) {
            return reply.code(429).send({ error: "Too many executions" });
        }

        // Store code for extension to pull
        setEngineCode(key, code);

        return { ok: true };
    } catch (e) {
        if (!IS_PROD) console.error("engine/execute error:", e);
        return reply.code(500).send({ error: "Internal error" });
    }
}

/**
 * POST /log
 * Receive logs from script execution
 */
async function logRoute(request, reply) {
    try {
        const key = request.headers['x-asfixy-key'] || 'UNKNOWN_KEY';
        const { msg, type } = request.body || {};

        // Format for console
        const typeTag = type === 'error' ? '\x1b[31m[ERROR]\x1b[0m' :
            type === 'warn' ? '\x1b[33m[WARN]\x1b[0m' :
                type === 'success' ? '\x1b[32m[SUCCESS]\x1b[0m' : '\x1b[36m[INFO]\x1b[0m';

        console.log(`[ClientLog] ${typeTag} [${key}] ${msg}`);
        return { ok: true };
    } catch (e) {
        return { ok: false };
    }
}

/**
 * GET /engine
 * Engine control panel UI
 */
async function enginePageRoute(request, reply) {
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
            <span style="opacity:0.5;font-size:0.7rem;letter-spacing:0;">JSON Commands</span>
        </div>
        <textarea id="code" spellcheck="false">[{"action": "click"}, {"action": "toggle_autoclick"}]
</textarea>
        
        <div class="actions">
            <button id="btnExecute" class="primary">EXECUTE</button>
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

<script nonce="${request.nonce}">
const codeInput = document.getElementById('code');
const logConsole = document.getElementById('log');
const toast = document.getElementById('toast');

function addLog(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    entry.innerText = msg;
    logConsole.appendChild(entry);
    logConsole.scrollTop = logConsole.scrollHeight;
}

function showToast(msg, type = 'info') {
    toast.className = 'toast ' + type + ' show';
    toast.innerText = msg;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.getElementById('btnClear').addEventListener('click', () => {
    codeInput.value = '';
    logConsole.innerHTML = '<div class="log-entry info">Cleared</div>';
});

document.getElementById('btnOpenGame').addEventListener('click', () => {
    window.open('https://orteil.dashnet.org/cookieclicker', '_blank');
});

document.getElementById('btnExecute').addEventListener('click', async () => {
    const code = codeInput.value.trim();
    if (!code) {
        showToast('Enter code first', 'error');
        return;
    }

    try {
        const key = localStorage.getItem('asfixy_key');
        if (!key) {
            showToast('No key found. Go to /get-key', 'error');
            return;
        }

        const res = await fetch('/engine/execute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-asfixy-key': key
            },
            body: JSON.stringify({ code })
        });

        const data = await res.json();
        
        if (res.ok && data.ok) {
            addLog('Code sent to game. Waiting for execution...', 'success');
            showToast('Code executed!', 'success');
        } else {
            addLog('Error: ' + (data.error || 'Unknown error'), 'error');
            showToast(data.error || 'Execution failed', 'error');
        }
    } catch (e) {
        addLog('Connection error: ' + e.message, 'error');
        showToast('Connection error', 'error');
    }
});

// Auto-load key from storage
const savedKey = localStorage.getItem('asfixy_key');
if (savedKey) {
    addLog('Key loaded: ' + savedKey.substring(0, 6) + '...', 'success');
}
</script>

</body>
</html>
`;
    reply.type('text/html').send(html);
}

module.exports = {
    engineStatusRoute,
    enginePullRoute,
    engineExecuteRoute,
    logRoute,
    enginePageRoute
};
