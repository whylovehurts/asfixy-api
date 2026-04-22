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
        try { data = await res.json(); } catch { throw new Error("Invalid response"); }
        if (data.valid) {
            status.style.color = "#33ff77";
            status.innerText = "SUCCESS: " + (data.msg || "Device Authorized");
        } else {
            status.style.color = "#ff3333";
            status.innerText = "ERROR: " + (data.reason || "Invalid Key");
        }
    } catch (e) { status.innerText = "Connection Error"; }
}