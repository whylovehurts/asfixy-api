/**
 * Admin Routes
 * Key management, bulk operations, ban system
 * 2-Step Auth: key (first) -> pass (second)
 */

const { KeyModel, BanModel, LogModel } = require('../models');
const { MASTER_KEY, ADMIN_SECRET, IS_PROD } = require('../config/env');
const { DURACAO_KEY } = require('../lib/constants');
const fs = require('fs');
const path = require('path');

// Load admin CSS at startup
const ADMIN_STYLES = fs.readFileSync(path.join(__dirname, '..', 'templates', 'admin', 'styles.css'), 'utf8');
const ADMIN_CLIENT_JS = fs.readFileSync(path.join(__dirname, '..', 'templates', 'admin', 'client.js'), 'utf8');

/**
 * Check if key is valid
 */
function isValidKey(request) {
    return request.query?.key === MASTER_KEY;
}

/**
 * Verify reinforced admin auth (full: key + pass)
 */
function verifyAdminAuth(request) {
    const key = request.query?.key;
    const pass = request.headers['x-admin-pass'] || request.query?.pass;

    if (key !== MASTER_KEY) return false;
    if (pass !== ADMIN_SECRET) return false;
    return true;
}

/**
 * Password Entry UI (Glassmorphism)
 * Shown when key is correct but pass is missing/wrong
 */
function renderPasswordUI(key, error = '', nonce = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Asfixy Admin - Security</title>
    <style>
        :root { --bg: #0a0a0a; --card: rgba(20, 20, 20, 0.7); --accent: #ff3333; --text: #eaeaea; --text-dim: #888; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
        body { background: radial-gradient(ellipse at top, #1a1a1a, #050505); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: var(--card); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; width: 100%; max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        h1 { text-align: center; font-size: 1.5rem; font-weight: 500; margin-bottom: 8px; color: var(--text); }
        .subtitle { text-align: center; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 32px; }
        .error { background: rgba(255, 51, 51, 0.15); border: 1px solid rgba(255, 51, 51, 0.3); color: #ff5555; padding: 12px 16px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 20px; text-align: center; }
        input { width: 100%; padding: 14px 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--text); font-size: 1rem; margin-bottom: 20px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
        input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255, 51, 51, 0.15); }
        input::placeholder { color: #555; }
        button { width: 100%; padding: 14px; background: linear-gradient(135deg, #ff3333, #cc2222); border: none; border-radius: 8px; color: white; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
        button:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(255, 51, 51, 0.4); }
        button:active { transform: translateY(0); }
    </style>
</head>
<body>
    <div class="card">
        <h1>ADMIN ACCESS</h1>
        <p class="subtitle">Enter your password to continue</p>
        ${error ? `<div class="error">${error}</div>` : ''}
        <form id="passForm" method="GET" action="/admin">
            <input type="hidden" name="key" value="${key}">
            <input type="password" name="pass" placeholder="Password" required autofocus>
            <button type="submit">Unlock Panel</button>
        </form>
    </div>
</body>
</html>`;
}

/**
 * Format time for display
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
 * Escape HTML
 */
function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * GET /admin
 * Admin panel UI with 2-step authentication
 * Step 1: key must be correct
 * Step 2: pass required to view panel
 */
async function adminPageRoute(request, reply) {
    const key = request.query?.key;
    const pass = request.headers['x-admin-pass'] || request.query?.pass;

    if (!key) return reply.code(403).send("DENIED");
    if (!isValidKey(request)) return reply.code(403).send("DENIED");

    if (!pass || pass !== ADMIN_SECRET) {
        const error = pass ? 'Incorrect password' : '';
        return reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .send(renderPasswordUI(escapeHtml(key), error));
    }

    const tab = request.query.tab || 'keys';
    const rawPage = parseInt(request.query.page) || 1;
    const page = Math.max(1, rawPage);
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalKeys = await KeyModel.countDocuments();
    const allKeys = await KeyModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalPages = Math.ceil(totalKeys / limit) || 1;

    const keysData = allKeys.map(k => {
        const ms = DURACAO_KEY - (Date.now() - k.createdAt.getTime());
        return { key: k.key, ip: k.ip, isPermanent: k.isPermanent, timeLeft: k.isPermanent ? -1 : Math.max(0, ms) };
    });

    // Get bans
    const totalBans = await BanModel.countDocuments();
    const allBans = await BanModel.find({}).sort({ createdAt: -1 }).limit(20);

    // Get logs
    const totalLogs = await LogModel.countDocuments();
    const allLogs = await LogModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const logPages = Math.ceil(totalLogs / limit) || 1;

    // Pass ADMIN_SECRET to template (but only for use in JavaScript)
    const adminSecretForJs = ADMIN_SECRET;
    const passParam = 'pass=' + encodeURIComponent(ADMIN_SECRET);

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asfixy Admin</title>
        <style>${ADMIN_STYLES}</style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">ASFIXY ADMIN</div>
                <div style="display:flex; gap:10px;">
                    <button class="tab-btn ${tab === 'keys' ? 'active' : ''}" data-tab="keys">KEYS</button>
                    <button class="tab-btn ${tab === 'bans' ? 'active' : ''}" data-tab="bans">BANS</button>
                    <button class="tab-btn ${tab === 'logs' ? 'active' : ''}" data-tab="logs">LOGS</button>
                    <button class="btn btn-outline" id="btnBulk">BULK CREATE</button>
                    <button class="btn btn-outline" style="border-color:var(--accent); color:var(--accent);" id="btnBulkDelete">BULK DELETE</button>
                    <button class="btn" id="btnCreate">+ NEW KEY</button>
                </div>
            </div>

            ${tab === 'keys' ? `
            <div class="panel">
                <table>
                    <thead>
                        <tr>
                            <th>Access Key & IP</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${keysData.map(item => `
                        <tr>
                            <td>
                                <div class="key-title">${escapeHtml(item.key)}</div><br>
                                <div class="key-ip">${escapeHtml(item.ip)}</div>
                            </td>
                            <td>
                                ${item.isPermanent
                ? '<div class="badge perm">PERMANENT</div>'
                : '<div class="badge temp timer" data-ms="' + item.timeLeft + '">' + formatTimeServer(item.timeLeft) + '</div>'}
                            </td>
                            <td class="actions">
                                <button class="btn-sm edit act-btn" data-act="edit" data-key="${escapeHtml(item.key)}">EDIT</button>
                                <button class="btn-sm reset act-btn" data-act="reset-ip" data-key="${escapeHtml(item.key)}">RESET IP</button>
                                <button class="btn-sm revoke act-btn" data-act="revoke-key" data-key="${escapeHtml(item.key)}">REVOKE</button>
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="pagination">
                    <button class="btn-sm edit" id="btnPrevPage" data-page="${page - 1}" ${page <= 1 ? 'disabled style="opacity:0.3"' : ''}>&laquo; PREV</button>
                    <div class="page-info">PAGE ${page} OF ${totalPages}</div>
                    <button class="btn-sm edit" id="btnNextPage" data-page="${page + 1}" ${page >= totalPages ? 'disabled style="opacity:0.3"' : ''}>NEXT &raquo;</button>
                </div>
            </div>
            ` : ''}

            ${tab === 'bans' ? `
            <div class="panel">
                <h3 style="color:var(--accent); margin-bottom:20px;">BANNED IPS & KEYS</h3>
                <table>
                    <thead>
                        <tr>
                            <th>IP / Key</th>
                            <th>Reason</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allBans.map(ban => `
                        <tr>
                            <td>${escapeHtml(ban.ip || ban.key || 'N/A')}</td>
                            <td>${escapeHtml(ban.reason || 'manual')}</td>
                            <td>${new Date(ban.createdAt).toLocaleString()}</td>
                            <td class="actions">
                                <button class="btn-sm reset act-btn" data-act="unban" data-ip="${escapeHtml(ban.ip || '')}" data-key="${escapeHtml(ban.key || '')}">UNBAN</button>
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            ${tab === 'logs' ? `
            <div class="panel">
                <h3 style="color:var(--accent); margin-bottom:20px;">RECENT ACTIVITY LOGS</h3>
                <table>
                    <thead>
                        <tr>
                            <th>IP</th>
                            <th>Key</th>
                            <th>Route</th>
                            <th>Method</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allLogs.map(log => `
                        <tr>
                            <td>${escapeHtml(log.ip || 'N/A')}</td>
                            <td>${escapeHtml(log.key || 'N/A')}</td>
                            <td>${escapeHtml(log.route || 'N/A')}</td>
                            <td>${escapeHtml(log.method || 'N/A')}</td>
                            <td><span class="badge ${log.status >= 400 ? 'perm' : 'temp'}">${log.status || 'N/A'}</span></td>
                            <td>${new Date(log.createdAt).toLocaleString()}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="pagination">
                    <button class="btn-sm edit" id="btnPrevLogPage" data-page="${page - 1}" ${page <= 1 ? 'disabled style="opacity:0.3"' : ''}>&laquo; PREV</button>
                    <div class="page-info">PAGE ${page} OF ${logPages}</div>
                    <button class="btn-sm edit" id="btnNextLogPage" data-page="${page + 1}" ${page >= logPages ? 'disabled style="opacity:0.3"' : ''}>NEXT &raquo;</button>
                </div>
            </div>
            ` : ''}
        </div>

        <!-- GLOBAL MODAL -->
        <div class="modal-overlay" id="modalOverlay">
            <div class="modal">
                <h2 id="modalTitle">Title</h2>
                <div id="modalBody"></div>
                <div class="modal-actions">
                    <button class="btn-sm edit" id="btnModalCancel">CANCEL</button>
                    <button class="btn-sm revoke" id="modalConfirmBtn" style="background:var(--accent); color:#fff;">CONFIRM</button>
                </div>
            </div>
        </div>

        <script nonce="${request.nonce}">
            const ADMIN_SECRET = "${adminSecretForJs}";
            const MASTER_KEY = "${request.query.key}";
            const passParam = 'pass=' + encodeURIComponent(ADMIN_SECRET);
            const modalOverlay = document.getElementById('modalOverlay');
            const modalTitle = document.getElementById('modalTitle');
            const modalBody = document.getElementById('modalBody');
            const modalConfirmBtn = document.getElementById('modalConfirmBtn');
            let currentAction = null;

            function formatTime(ms) {
                if (ms < 0) return "PERMANENT";
                let s = Math.floor(ms / 1000);
                return Math.floor(s/3600).toString().padStart(2,'0') + ":" + Math.floor((s%3600)/60).toString().padStart(2,'0') + ":" + (s%60).toString().padStart(2,'0');
            }

            setInterval(() => {
                document.querySelectorAll('.timer').forEach(td => {
                    let ms = parseInt(td.getAttribute('data-ms'));
                    if (ms > 0) { ms -= 1000; td.setAttribute('data-ms', ms); td.innerText = formatTime(ms); }
                });
            }, 1000);

            // Tab switching
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.getAttribute('data-tab');
                    window.location.href = '/admin?key='+MASTER_KEY+'&'+passParam+'&tab='+tab;
                });
            });

            function getUrlParams() {
                const params = new URLSearchParams(window.location.search);
                return {
                    key: params.get('key'),
                    pass: params.get('pass'),
                    tab: params.get('tab') || 'keys',
                    page: params.get('page') || 1
                };
            }

            function changePage(p) { 
                const params = getUrlParams();
                window.location.href = '/admin?key='+params.key+'&pass='+params.pass+'&tab='+params.tab+'&page='+p; 
            }

            function closeModal() {
                modalOverlay.classList.remove('active');
            }

            function openModal(type, targetKey = '') {
                currentAction = { type, targetKey };

                if (type === 'create') {
                    modalTitle.innerText = "CREATE NEW KEY";
                    modalBody.innerHTML = \`
                        <div class="input-group">
                            <label>Custom Name (Optional)</label>
                            <input type="text" id="m_name" placeholder="Leave empty for random">
                        </div>
                        <div class="input-group" style="display:flex; align-items:center;">
                            <label style="margin:0;">Permanent Key?</label>
                            <input type="checkbox" id="m_perm">
                        </div>
                    \`;
                } else if (type === 'bulk') {
                    modalTitle.innerText = "BULK CREATE KEYS";
                    modalBody.innerHTML = \`
                        <div class="input-group">
                            <label>Amount (1-100)</label>
                            <input type="number" id="m_amount" value="10" min="1" max="100">
                        </div>
                        <div class="input-group" style="display:flex; align-items:center;">
                            <label style="margin:0;">Permanent Keys?</label>
                            <input type="checkbox" id="m_perm">
                        </div>
                    \`;
                } else if (type === 'bulk-delete') {
                    modalTitle.innerText = "BULK DELETE KEYS";
                    modalBody.innerHTML = \`
                        <div class="input-group">
                            <label>Delete criteria</label>
                            <select id="m_del_type" style="width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 10px; font-family: 'Inter', sans-serif; outline: none; margin-bottom: 10px;">
                                <option value="all">Delete All Keys</option>
                                <option value="name">Delete by Name</option>
                                <option value="ip">Delete by IP</option>
                                <option value="no-ip">Keys without IP (MANUAL)</option>
                                <option value="permanent">All Permanent Keys</option>
                                <option value="timed">All Timed Keys</option>
                            </select>
                        </div>
                        <div class="input-group" id="m_del_val_group" style="display:none;">
                            <label>Value (Name or IP)</label>
                            <input type="text" id="m_del_val" placeholder="Enter name or IP...">
                        </div>
                    \`;
                    setTimeout(() => {
                        document.getElementById('m_del_type').addEventListener('change', (e) => {
                            const val = e.target.value;
                            document.getElementById('m_del_val_group').style.display = (val === 'name' || val === 'ip') ? 'block' : 'none';
                        });
                    }, 50);
                } else if (type === 'edit') {
                    modalTitle.innerText = "EDIT KEY";
                    modalBody.innerHTML = \`
                        <div class="input-group">
                            <label>New Name</label>
                            <input type="text" id="m_name" value="\${targetKey}">
                        </div>
                        <div class="input-group">
                            <label>Reset to Hours (0 to keep current)</label>
                            <input type="number" id="m_hours" value="0" min="0">
                        </div>
                    \`;
                }
                modalOverlay.classList.add('active');
            }

            async function executeModalAction() {
                let endpoint = '';
                let payload = {};

                if (currentAction.type === 'create') {
                    endpoint = '/admin/create-key';
                    payload = { customName: document.getElementById('m_name').value, permanent: document.getElementById('m_perm').checked };
                } else if (currentAction.type === 'bulk') {
                    endpoint = '/admin/bulk-create';
                    payload = { amount: parseInt(document.getElementById('m_amount').value), permanent: document.getElementById('m_perm').checked };
                } else if (currentAction.type === 'bulk-delete') {
                    endpoint = '/admin/bulk-delete';
                    payload = { 
                        type: document.getElementById('m_del_type').value, 
                        value: document.getElementById('m_del_val') ? document.getElementById('m_del_val').value : '' 
                    };
                } else if (currentAction.type === 'edit') {
                    endpoint = '/admin/edit-full';
                    payload = { targetKey: currentAction.targetKey, newName: document.getElementById('m_name').value, hours: parseInt(document.getElementById('m_hours').value) };
                }

                modalConfirmBtn.innerText = "WAIT...";
                modalConfirmBtn.disabled = true;

                try {
                    await fetch(endpoint + '?key=' + MASTER_KEY + '&' + passParam, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-pass': ADMIN_SECRET
                        },
                        body: JSON.stringify(payload)
                    });
                    location.reload();
                } catch(e) {
                    alert("Error executing action: " + e.message);
                    closeModal();
                    modalConfirmBtn.innerText = "CONFIRM";
                    modalConfirmBtn.disabled = false;
                }
            }

            async function action(type, targetKey, extraData = {}) {
                if (!confirm("Are you sure you want to perform this action on " + targetKey + "?")) return;
                try {
                    const payload = { targetKey, ...extraData };
                    await fetch('/admin/' + type + '?key=' + MASTER_KEY + '&' + passParam, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-pass': ADMIN_SECRET
                        },
                        body: JSON.stringify(payload)
                    });
                    location.reload();
                } catch(e) { alert("Action failed: " + e.message); }
            }

            async function unbanAction(ip, key) {
                if (!confirm("Are you sure you want to unban this entry?")) return;
                try {
                    await fetch('/admin/unban?key=' + MASTER_KEY + '&' + passParam, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-pass': ADMIN_SECRET
                        },
                        body: JSON.stringify({ ip: ip, key: key })
                    });
                    location.reload();
                } catch(e) { alert("Unban failed: " + e.message); }
            }

            /* Event Listeners */
            document.getElementById('btnBulk').addEventListener('click', () => openModal('bulk'));
            document.getElementById('btnBulkDelete').addEventListener('click', () => openModal('bulk-delete'));
            document.getElementById('btnCreate').addEventListener('click', () => openModal('create'));
            document.getElementById('btnModalCancel').addEventListener('click', closeModal);
            modalConfirmBtn.addEventListener('click', executeModalAction);
            
            const btnPrev = document.getElementById('btnPrevPage');
            if(btnPrev && !btnPrev.hasAttribute('disabled')) btnPrev.addEventListener('click', () => changePage(btnPrev.getAttribute('data-page')));
            
            const btnNext = document.getElementById('btnNextPage');
            if(btnNext && !btnNext.hasAttribute('disabled')) btnNext.addEventListener('click', () => changePage(btnNext.getAttribute('data-page')));

            document.querySelectorAll('.act-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const act = btn.getAttribute('data-act');
                    const k = btn.getAttribute('data-key');
                    if (act === 'edit') openModal('edit', k);
                    else if (act === 'unban') {
                        const ip = btn.getAttribute('data-ip');
                        const key = btn.getAttribute('data-key');
                        unbanAction(ip, key);
                    }
                    else action(act, k);
                });
            });
        </script>
    </body>
    </html>`;
    reply.type('text/html').send(html);
}

/**
 * POST /admin/ban
 * Ban a key or IP
 */
async function adminBanRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();

    await BanModel.create({
        ip: request.body.ip || null,
        key: request.body.key || null,
        reason: request.body.reason || "manual"
    });

    return { success: true };
}

/**
 * POST /admin/bulk-create
 * Bulk create keys
 */
async function adminBulkCreateRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();

    const amount = Math.min(100, Math.max(1, parseInt(request.body.amount) || 1));

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const keys = [];

    for (let i = 0; i < amount; i++) {
        let rand = "";
        for (let j = 0; j < 10; j++)
            rand += chars[Math.floor(Math.random() * chars.length)];

        keys.push({
            key: `asfixy-${rand.toLowerCase()}`,
            isPermanent: !!request.body.permanent,
            ip: "MANUAL"
        });
    }

    await KeyModel.insertMany(keys);
    return { success: true };
}

/**
 * POST /admin/bulk-delete
 * Bulk delete keys
 */
async function adminBulkDeleteRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();
    
    const type = request.body.type;
    const value = String(request.body.value || "").trim();
    let query = {};

    switch(type) {
        case 'all': query = {}; break;
        case 'name': 
            if(!value) return reply.code(400).send({error:"Value required"});
            query = { key: value.toLowerCase() };
            break;
        case 'ip':
            if(!value) return reply.code(400).send({error:"Value required"});
            query = { ip: value };
            break;
        case 'no-ip': query = { ip: "MANUAL" }; break;
        case 'permanent': query = { isPermanent: true }; break;
        case 'timed': query = { isPermanent: false }; break;
        default: return reply.code(400).send({error:"Invalid type"});
    }

    try {
        const result = await KeyModel.deleteMany(query).collation({ locale: 'en', strength: 2 });
        return { success: true, deleted: result.deletedCount };
    } catch(e) {
        return reply.code(500).send({ error: e.message });
    }
}

/**
 * POST /admin/reset-ip
 * Reset key IP to MANUAL
 */
async function adminResetIpRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();
    const targetKey = String(request.body.targetKey || "").toLowerCase();
    await KeyModel.updateOne({ key: targetKey }, { ip: "MANUAL" })
        .collation({ locale: 'en', strength: 2 });
    return { success: true };
}

/**
 * POST /admin/edit-full
 * Edit key name and/or expiration
 */
async function adminEditFullRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();

    const { targetKey, newName, hours } = request.body;

    if (!targetKey || typeof targetKey !== 'string') return reply.code(400).send();

    const update = {};

    if (newName && typeof newName === 'string' && newName.length <= 50)
        update.key = newName.toLowerCase();

    const h = parseInt(hours);
    if (!isNaN(h) && h > 0) {
        update.createdAt = new Date(Date.now() - (DURACAO_KEY - (h * 3600000)));
    }

    await KeyModel.updateOne({ key: targetKey.toLowerCase() }, update)
        .collation({ locale: 'en', strength: 2 });

    return { success: true };
}

/**
 * POST /admin/revoke-key
 * Delete a key
 */
async function adminRevokeKeyRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();
    const targetKey = String(request.body.targetKey || "").toLowerCase();
    await KeyModel.deleteOne({ key: targetKey })
        .collation({ locale: 'en', strength: 2 });
    return { success: true };
}

/**
 * POST /admin/create-key
 * Create a single key
 */
async function adminCreateKeyRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();

    let name = String(request.body.customName || "").trim();
    if (name.length > 50) return reply.code(400).send({ error: "Invalid name" });

    if (name && !/^[\w\-.]+$/.test(name)) {
        return reply.code(400).send({ error: "Invalid name" });
    }

    if (!name) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        for (let j = 0; j < 10; j++) name += chars[Math.floor(Math.random() * chars.length)];
        name = "asfixy-" + name.toLowerCase();
    } else {
        name = name.toLowerCase();
    }

    try {
        await KeyModel.create({
            ip: "MANUAL",
            key: name,
            isPermanent: !!request.body.permanent
        });
    } catch (e) {
        if (e.code === 11000) {
            return { success: true };
        }
        throw e;
    }

    return { success: true };
}

/**
 * POST /admin/unban
 * Remove a ban for IP or key
 */
async function adminUnbanRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send();

    const { ip, key } = request.body || {};
    
    if (!ip && !key) {
        return reply.code(400).send({ error: "Provide ip or key to unban" });
    }

    const query = {};
    if (ip) query.ip = ip;
    if (key) query.key = key.toLowerCase();

    const result = await BanModel.deleteOne(query);
    return { success: true, deleted: result.deletedCount };
}

module.exports = {
    adminPageRoute,
    adminBanRoute,
    adminUnbanRoute,
    adminBulkCreateRoute,
    adminBulkDeleteRoute,
    adminResetIpRoute,
    adminEditFullRoute,
    adminRevokeKeyRoute,
    adminCreateKeyRoute
};