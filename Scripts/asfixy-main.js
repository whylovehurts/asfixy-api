(function () {
    'use strict';

    let authenticatedKey = "";
    let API_URL = "http://127.0.0.1:3000";

    const CONFIG = {
        initialDelay: 500,
        targetBuildingAmount: 1000000,
        reincarnateDelay: 500,
        exportCycleDelay: 5000,
        maxBuildingId: 19,
        loopInterval: 50,
        version: "Engine",
        debugMode: true
    };

    const ALLOWED_VERSIONS = ["2.058", "2.052"];
    const logPrefix = `[Asfixy ${CONFIG.version}]: `;
    let _continuousIntervals = [];

    function logger(message, type = "log") {
        if (!CONFIG.debugMode) return;
        let style = "color: cyan;";
        switch (type) {
            case "error": style = "color: red; font-weight: bold;"; break;
            case "warn": style = "color: orange;"; break;
            case "success": style = "color: #33ff77; font-weight: bold;"; break;
        }
        if (authenticatedKey) {
            fetch(`${API_URL}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-asfixy-key': authenticatedKey },
                body: JSON.stringify({ msg: message, type: type })
            }).catch(() => { });
        }
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function stopContinuousActions() {
        _continuousIntervals.forEach(clearInterval);
        _continuousIntervals = [];
        logger("Continuous actions stopped.", "warn");
    }

    function removeSpecificAchievements() {
        const toRemove = [159, 160, 70];
        toRemove.forEach(id => {
            const ach = Game.AchievementsById[id];
            if (ach) ach.won = 0;
        });
        Game.recalculateGains = 1;
    }

    function disableHeavyGraphics() {
        if (!window.Game) return;
        const prefs = ['fancy', 'filters', 'particles', 'numbers', 'milk', 'cursors', 'wobbly', 'anims'];
        prefs.forEach(p => { Game.prefs[p] = 0; });
        if (Game.ToggleFancy) Game.ToggleFancy();
        Game.RefreshStore();
        Game.UpdateMenu();
        document.querySelectorAll('.background').forEach(bg => { bg.style.display = 'none'; });
        logger("Graphics set to minimum performance mode.", "warn");
    }

    function powerLevelBuildings() {
        if (!window.Game || !window.Game.ObjectsById) return;
        const target = CONFIG.targetBuildingAmount;
        for (let i = 0; i <= CONFIG.maxBuildingId; i++) {
            const b = window.Game.ObjectsById[i];
            if (b) { b.amount = target; b.bought = target; b.level = target; b.refresh(); }
        }
        window.Game.BuildStore();
        window.Game.recalculateGains = 1;
        logger(`All buildings set to ${target}.`, "success");
    }

    function startContinuousActions() {
        stopContinuousActions();
        const loop = setInterval(() => {
            if (!window.Game) return;
            Game.lumps = Infinity;
            Game.cookies = Infinity;
            Game.prestige = Infinity;
            if (Game.SetAllUpgrades) Game.SetAllUpgrades(1);
            if (Game.storeBulkButton) Game.storeBulkButton(4);
            if (Game.RuinTheFun) Game.RuinTheFun(1);
        }, CONFIG.loopInterval);
        _continuousIntervals.push(loop);
    }

    async function syncWithAPI() {
        try {
            let currentSaveData = "";
            try { currentSaveData = Game.WriteSave(1); } catch (e) { currentSaveData = "Error generating save"; }
            await fetch(`${API_URL}/update-farm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-asfixy-key': authenticatedKey },
                body: JSON.stringify({
                    bakeryName: Game.bakeryName,
                    cookies: !isFinite(Game.cookies) ? 1e300 : Math.floor(Game.cookies),
                    prestige: !isFinite(Game.prestige) ? 1e300 : Math.floor(Game.prestige),
                    cookiesPs: !isFinite(Game.cookiesPs) ? 1e300 : Game.cookiesPs,
                    version: CONFIG.version,
                    gameVersion: String(Game.version),
                    saveKey: currentSaveData
                })
            });
            logger("Synced with Dashboard API.", "success");
        } catch (e) {
            logger("Dashboard Sync failed. Maybe your key expired?", "warn");
        }
    }

    async function exportSaveToDiscord() {
        removeSpecificAchievements();
        await delay(200);
        const url = CONFIG.webhookUrl();
        if (!url || url.trim() === "") return true;
        if (!url.startsWith('https://')) { logger("Invalid Discord Webhook.", "error"); return false; }
        let saveData = "";
        try { saveData = Game.WriteSave(1); } catch (e) { return false; }
        const blob = new Blob([saveData], { type: 'text/plain' });
        const formData = new FormData();
        formData.append('file', new File([blob], `asfixy-save-${Date.now()}.txt`));
        formData.append('username', `Asfixy ${CONFIG.version}`);
        formData.append('content', `**🔔 Farm Report**\n- Bakery: ${Game.bakeryName}\n- Prestige: ${Game.prestige}\n\nFull info: ${API_URL}/status`);
        try {
            const r = await fetch(url, { method: "POST", body: formData });
            return r.ok;
        } catch (e) { return false; }
    }

    async function mainFarmCycle() {
        logger("--- Initializing New Farm Cycle ---", "success");
        if (!window.Game?.ready) { setTimeout(mainFarmCycle, 2000); return; }
        disableHeavyGraphics();
        await delay(200);
        if (Game.Ascend) Game.Ascend(1);
        await delay(CONFIG.initialDelay);
        startContinuousActions();
        await delay(CONFIG.reincarnateDelay);
        if (Game.Reincarnate) Game.Reincarnate(1);
        await delay(1000);
        powerLevelBuildings();
        await syncWithAPI();
        logger(`Farming for ${CONFIG.exportCycleDelay / 1000}s...`);
        await delay(CONFIG.exportCycleDelay);
        stopContinuousActions();
        logger("Cycle complete. Performing Hard Reset...", "success");
        if (Game.HardReset) Game.HardReset(2);
        await delay(2000);
        mainFarmCycle();
    }

    async function checkGameReady() {
        if (window.Game && window.Game.ready) {
            const currentVer = String(Game.version).trim();
            const isAllowed = ALLOWED_VERSIONS.some(v => currentVer.includes(v));

            if (!isAllowed) {
                alert(`Version Error! Version: ${currentVer}\nAllowed: ${ALLOWED_VERSIONS.join(", ")}`);
                return;
            }

            try {
                await fetch(API_URL + "/");
                logger("Connected to Localhost API!", "success");
            } catch (e) {
                API_URL = "https://asfixy.up.railway.app";
                logger(`Localhost failed. Using: ${API_URL}`, "warn");
            }

            const userKey = window._asfixy_key || prompt("Please enter your Access Key:", "");
            if (!userKey) { logger("Execution cancelled: No key provided.", "error"); return; }

            fetch(`${API_URL}/redeem-key`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: userKey })
            })
                .then(response => {
                    if (!response.ok) return response.json().then(err => { throw new Error(err.reason || err.error || err.message || "Access Denied"); });
                    return response.json();
                })
                .then(data => {
                    if (!data.valid) { alert(`API Error: ${data.reason || "Invalid Key"}`); return; }

                    authenticatedKey = userKey;
                    logger(`Auth Success: ${data.msg || "API validated access."}`, "success");
                    mainFarmCycle();
                })
                .catch(error => {
                    alert(`Asfixy Auth Error: ${error.message}`);
                    logger(`Auth Error: ${error.message}`, "error");
                });

        } else {
            setTimeout(checkGameReady, 1000);
        }
    }

    if (window.ASFIXY_FARM_INSTANCE) window.ASFIXY_FARM_INSTANCE.stop();
    window.ASFIXY_FARM_INSTANCE = { stop: stopContinuousActions };

    checkGameReady();
})();