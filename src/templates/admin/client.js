// Admin Panel Client-Side JavaScript
const ADMIN_SECRET = "{{adminSecret}}";
const MASTER_KEY = "{{masterKey}}";
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

// Timer countdown
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
        modalBody.innerHTML = `
            <div class="input-group">
                <label>Custom Name (Optional)</label>
                <input type="text" id="m_name" placeholder="Leave empty for random">
            </div>
            <div class="input-group" style="display:flex; align-items:center;">
                <label style="margin:0;">Permanent Key?</label>
                <input type="checkbox" id="m_perm">
            </div>
        `;
    } else if (type === 'bulk') {
        modalTitle.innerText = "BULK CREATE KEYS";
        modalBody.innerHTML = `
            <div class="input-group">
                <label>Amount (1-100)</label>
                <input type="number" id="m_amount" value="10" min="1" max="100">
            </div>
            <div class="input-group" style="display:flex; align-items:center;">
                <label style="margin:0;">Permanent Keys?</label>
                <input type="checkbox" id="m_perm">
            </div>
        `;
    } else if (type === 'bulk-delete') {
        modalTitle.innerText = "BULK DELETE KEYS";
        modalBody.innerHTML = `
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
        `;
        setTimeout(() => {
            document.getElementById('m_del_type').addEventListener('change', (e) => {
                const valGroup = document.getElementById('m_del_val_group');
                valGroup.style.display = (e.target.value === 'name' || e.target.value === 'ip') ? 'block' : 'none';
            });
        }, 100);
    } else if (type === 'edit') {
        modalTitle.innerText = "EDIT KEY";
        modalBody.innerHTML = `
            <div class="input-group">
                <label>New Name</label>
                <input type="text" id="m_name" placeholder="Enter new name">
            </div>
            <div class="input-group">
                <label>Add Hours (optional)</label>
                <input type="number" id="m_hours" placeholder="Hours to add">
            </div>
        `;
    }

    modalOverlay.classList.add('active');
}

async function executeModalAction() {
    if (!currentAction) return;

    let endpoint = '/admin/create-key';
    let payload = {};

    if (currentAction.type === 'create') {
        payload = {
            customName: document.getElementById('m_name').value,
            permanent: document.getElementById('m_perm')?.checked || false
        };
    } else if (currentAction.type === 'bulk') {
        endpoint = '/admin/bulk-create';
        payload = {
            amount: parseInt(document.getElementById('m_amount').value) || 10,
            permanent: document.getElementById('m_perm')?.checked || false
        };
    } else if (currentAction.type === 'bulk-delete') {
        endpoint = '/admin/bulk-delete';
        payload = {
            type: document.getElementById('m_del_type').value,
            value: document.getElementById('m_del_val').value
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

// Event Listeners
document.getElementById('btnBulk')?.addEventListener('click', () => openModal('bulk'));
document.getElementById('btnBulkDelete')?.addEventListener('click', () => openModal('bulk-delete'));
document.getElementById('btnCreate')?.addEventListener('click', () => openModal('create'));
document.getElementById('btnModalCancel')?.addEventListener('click', closeModal);
modalConfirmBtn?.addEventListener('click', executeModalAction);

const btnPrev = document.getElementById('btnPrevPage');
if(btnPrev && !btnPrev.hasAttribute('disabled')) btnPrev.addEventListener('click', () => changePage(btnPrev.getAttribute('data-page')));

const btnNext = document.getElementById('btnNextPage');
if(btnNext && !btnNext.hasAttribute('disabled')) btnNext.addEventListener('click', () => changePage(btnNext.getAttribute('data-page')));

// Action buttons
document.querySelectorAll('.act-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const act = btn.getAttribute('data-act');
        const key = btn.getAttribute('data-key');
        if (act === 'edit') {
            openModal('edit', key);
        } else if (act === 'unban') {
            unbanAction(btn.getAttribute('data-ip'), btn.getAttribute('data-key'));
        } else {
            action(act, key);
        }
    });
});