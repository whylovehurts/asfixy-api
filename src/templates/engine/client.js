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
    if (!key) { showToast("No key found! Get a key first.", "error"); return; }
    const url = "https://orteil.dashnet.org/cookieclicker/?asfixy_key=" + encodeURIComponent(key);
    window.open(url, "_blank");
}

async function execute(){
    const code = document.getElementById('code').value.trim();
    const key = localStorage.getItem("asfixy_key");
    if(!key){ log("Cannot execute: No Access Key found in LocalStorage.", "error"); showToast("Missing Key", "error"); return; }
    if(!code){ log("Cannot execute: Script is empty.", "warn"); return; }
    log("Sending script payload to engine...", "info");
    try {
        const res = await fetch('/engine/execute', {
            method:'POST',
            headers:{ 'Content-Type':'application/json', 'x-asfixy-key': key },
            body:JSON.stringify({code})
        });
        const data = await res.json().catch(() => ({}));
        if(res.ok){ showToast("Payload delivered!", "success"); log("Execution queued successfully.", "success"); }
        else { const err = data.error || "Unknown server error"; showToast("Execution failed", "error"); log("Execution rejected: " + err, "error"); }
    } catch(err) { showToast("Network error", "error"); log("Network error: Failed to reach Asfixy API.", "error"); }
}

function clearCode(){
    document.getElementById('code').value = "";
    log("Editor cleared.", "info");
}

let wasConnected = false;
const injectStatus = document.getElementById('injectStatus');
function updateStatus(connected) {
    if (connected) {
        injectStatus.innerText = "Injected";
        injectStatus.style.color = "#33ff77";
        injectStatus.style.background = "rgba(51,255,119,0.1)";
    } else {
        injectStatus.innerText = "Not Injected";
        injectStatus.style.color = "#ff3333";
        injectStatus.style.background = "rgba(255,51,51,0.1)";
    }
}
updateStatus(false);
setInterval(async () => {
    const key = localStorage.getItem("asfixy_key");
    if (!key) return;
    try {
        const res = await fetch('/engine/status', { headers: { 'x-asfixy-key': key } });
        const data = await res.json();
        updateStatus(data.connected);
        if (data.connected && !wasConnected) { showToast("Injection Successful", "success"); log("Game connected to Asfixy Engine.", "success"); wasConnected = true; }
        else if (!data.connected && wasConnected) { wasConnected = false; log("Game connection lost.", "error"); }
    } catch(e) {}
}, 2000);