/**
 * Admin Routes
 * Key management, bulk operations, ban system
 */

const { KeyModel, BanModel, LogModel } = require('../models');
const { MASTER_KEY, ADMIN_SECRET, IS_PROD } = require('../config/env');
const { DURACAO_KEY } = require('../lib/constants');

/**
 * Verify reinforced admin auth
 * Requires both MASTER_KEY and ADMIN_SECRET
 */
function verifyAdminAuth(request) {
    const key = request.query?.key;
    const secret = request.headers['x-admin-secret'] || request.query?.admin_secret;
    
    if (key !== MASTER_KEY) return false;
    if (secret !== ADMIN_SECRET) return false;
    return true;
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
 * Admin panel UI with pagination
 * Requires both MASTER_KEY and ADMIN_SECRET
 */
async function adminPageRoute(request, reply) {
    if (!verifyAdminAuth(request)) return reply.code(403).send("DENIED");

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

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asfixy Admin</title>
        <style>
            :root {
                --bg: #050505;
                --card: rgba(20, 20, 20, 0.6);
                --accent: #ff3333;
                --accent-soft: rgba(255, 51, 51, 0.15);
                --text: #eaeaea;
                --success: #33ff77;
            }
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
            body { background: radial-gradient(circle at top, #0a0a0a, #050505); color: var(--text); min-height: 100vh; padding: 40px 20px; overflow-y: auto; }
            .container { max-width: 1100px; margin: 0 auto; }
            
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
            .logo { font-size: 1.5rem; font-weight: bold; letter-spacing: 4px; color: var(--accent); }
            .btn { background: var(--accent); color: #fff; padding: 12px 24px; border-radius: 12px; border: none; font-weight: bold; cursor: pointer; transition: 0.3s; font-size: 0.9rem; }
            .btn:hover { transform: scale(1.05); box-shadow: 0 0 20px rgba(255,51,51,0.4); }
            .btn-outline { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
            .btn-outline:hover { background: var(--accent-soft); }

            .panel { background: var(--card); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.05); border-radius: 24px; padding: 30px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow-x: auto; }
            
            table { width: 100%; border-collapse: collapse; min-width: 700px; }
            th { text-align: left; padding: 15px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05); }
            td { padding: 18px 15px; border-bottom: 1px solid rgba(255,255,255,0.02); vertical-align: middle; }
            tr:hover { background: rgba(255,255,255,0.02); }
            
            .key-title { font-size: 1.1rem; font-weight: bold; color: var(--accent); margin-bottom: 4px; display: inline-block; }
            .key-ip { font-size: 0.8rem; opacity: 0.5; font-family: monospace; }
            .badge { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: bold; letter-spacing: 1px; }
            .badge.perm { background: rgba(255,51,51,0.1); color: var(--accent); border: 1px solid var(--accent-soft); }
            .badge.temp { background: rgba(51,255,119,0.1); color: var(--success); border: 1px solid rgba(51,255,119,0.2); }
            
            .actions { display: flex; gap: 10px; }
            .btn-sm { padding: 8px 14px; font-size: 0.75rem; border-radius: 8px; border: none; cursor: pointer; transition: 0.2s; font-weight: bold; }
            .btn-sm.edit { background: rgba(255,255,255,0.05); color: #fff; }
            .btn-sm.edit:hover { background: rgba(255,255,255,0.1); }
            .btn-sm.reset { background: rgba(51,255,119,0.1); color: var(--success); }
            .btn-sm.reset:hover { background: rgba(51,255,119,0.2); }
            .btn-sm.revoke { background: rgba(255,51,51,0.1); color: var(--accent); }
            .btn-sm.revoke:hover { background: rgba(255,51,51,0.2); }

            .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 30px; }
            .page-info { font-size: 0.9rem; opacity: 0.6; }

            /* MODAL */
            .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); display: flex; justify-content: center; align-items: center; opacity: 0; pointer-events: none; transition: 0.3s; z-index: 100; }
            .modal-overlay.active { opacity: 1; pointer-events: all; }
            .modal { background: #111; border: 1px solid rgba(255,51,51,0.2); border-radius: 20px; padding: 30px; width: 90%; max-width: 400px; transform: translateY(20px); transition: 0.3s; }
            .modal-overlay.active .modal { transform: translateY(0); }
            .modal h2 { color: var(--accent); margin-bottom: 20px; font-size: 1.3rem; letter-spacing: 2px; text-transform: uppercase; }
            .input-group { margin-bottom: 20px; }
            .input-group label { display: block; font-size: 0.8rem; margin-bottom: 8px; opacity: 0.7; }
            .input-group input { width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 10px; font-family: 'Inter', sans-serif; outline: none; }
            .input-group input:focus { border-color: var(--accent); }
            .input-group input[type="checkbox"] { width: auto; transform: scale(1.3); margin-left: 5px; }
            .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
            
            /* TABS */
            .tab-btn { background: rgba(255,255,255,0.05); color: #888; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.3s; }
            .tab-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
            .tab-btn.active { background: var(--accent); color: #fff; }
        </style>
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
                    window.location.href = '/admin?key='+MASTER_KEY+'&admin_secret='+ADMIN_SECRET+'&tab='+tab;
                });
            });

            function getUrlParams() {
                const params = new URLSearchParams(window.location.search);
                return {
                    key: params.get('key'),
                    admin_secret: params.get('admin_secret'),
                    tab: params.get('tab') || 'keys',
                    page: params.get('page') || 1
                };
            }

            function changePage(p) { 
                const params = getUrlParams();
                window.location.href = '/admin?key='+params.key+'&admin_secret='+params.admin_secret+'&tab='+params.tab+'&page='+p; 
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
                    await fetch(endpoint + '?key=' + MASTER_KEY + '&admin_secret=' + ADMIN_SECRET, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-secret': ADMIN_SECRET
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
                    await fetch('/admin/' + type + '?key=' + MASTER_KEY + '&admin_secret=' + ADMIN_SECRET, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-secret': ADMIN_SECRET
                        },
                        body: JSON.stringify(payload)
                    });
                    location.reload();
                } catch(e) { alert("Action failed: " + e.message); }
            }

            async function unbanAction(ip, key) {
                if (!confirm("Are you sure you want to unban this entry?")) return;
                try {
                    await fetch('/admin/unban?key=' + MASTER_KEY + '&admin_secret=' + ADMIN_SECRET, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-admin-secret': ADMIN_SECRET
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