(function() {
    /**
     * ASFIXY ENGINE - UNIFIED SCRIPT
     * Modes: main = AutoFarm | dataloss = RollBack | crash = Crash :D
     *
     * Usage: Change the Script variable below and inject this file.
     */
    'use strict';

    const Script = "main"; // [ main | dataloss | crash ]

    // ─────────────────────────────────────────────
    //  SHARED CONFIG & UTILITIES
    // ─────────────────────────────────────────────

    let authenticatedKey = "";
    let API_URL         = "http://127.0.0.1:3000";

    const CONFIG = {
        initialDelay:         500,
        targetBuildingAmount: 1000000,
        reincarnateDelay:     500,
        exportCycleDelay:     5000,
        maxBuildingId:        19,
        loopInterval:         50,
        version:              "Engine",
        debugMode:            true
    };

    const ALLOWED_VERSIONS       = ["2.058", "2.052"];
    const logPrefix              = `[Asfixy ${CONFIG.version}]: `;
    let   _continuousIntervals   = [];

    function logger(message, type = "log") {
        if (!CONFIG.debugMode) return;
        let style = "color: cyan;";
        switch (type) {
            case "error":   style = "color: red; font-weight: bold;";   break;
            case "warn":    style = "color: orange;";                    break;
            case "success": style = "color: #33ff77; font-weight: bold;"; break;
        }
        console.log(`%c${logPrefix}${message}`, style);
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ─────────────────────────────────────────────
    //  MODE: MAIN — AutoFarm
    // ─────────────────────────────────────────────

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
            Game.lumps    = Infinity;
            Game.cookies  = Infinity;
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
                    bakeryName:  Game.bakeryName,
                    cookies:     !isFinite(Game.cookies)  ? 1e300 : Math.floor(Game.cookies),
                    prestige:    !isFinite(Game.prestige) ? 1e300 : Math.floor(Game.prestige),
                    cookiesPs:   !isFinite(Game.cookiesPs)? 1e300 : Game.cookiesPs,
                    version:     CONFIG.version,
                    gameVersion: String(Game.version),
                    saveKey:     currentSaveData
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
        const blob     = new Blob([saveData], { type: 'text/plain' });
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

    // ─────────────────────────────────────────────
    //  MODE: DATALOSS — RollBack / Save Blocker
    // ─────────────────────────────────────────────

    function runDataloss() {
        if (!window.Game || !Game.ready) { setTimeout(runDataloss, 500); return; }

        const MSG = "Asfixy Engine: Dataloss System Active.\nNothing will be saved. Refresh the page to reset.\nJoin discord: https://discord.gg/uSvZ5BJuJ4";

        Game.WriteSave  = function() { return ""; };
        Game.Save       = function() {
            if (Game.Notify) Game.Notify("Dataloss Active", "Asfixy blocked save. Dataloss is active! =)", [16, 5]);
        };
        Game.autosave   = 0;
        if (Game.prefs) Game.prefs.autosave = 0;

        window.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.keyCode === 83) {
                e.preventDefault();
                if (Game.Notify) Game.Notify("Ctrl+S Blocked", "Asfixy prevented shortcut save.", [16, 5]);
            }
        }, true);

        document.addEventListener('click', function(e) {
            const isSaveButton = e.target && (
                e.target.innerHTML === "Save" ||
                e.target.getAttribute('onclick')?.includes('Game.toSave=true')
            );
            if (isSaveButton) {
                e.stopImmediatePropagation();
                e.preventDefault();
                if (Game.Notify) Game.Notify("Button Blocked", "Asfixy prevented menu save. Dataloss is Active! =)", [16, 5]);
            }
        }, true);

        const originalUpdateMenu = Game.UpdateMenu;
        Game.UpdateMenu = function() {
            originalUpdateMenu.apply(this, arguments);
            const el = document.getElementById('commentsText1');
            if (el) el.innerHTML = MSG;
        };

        setInterval(() => {
            const el = document.getElementById('commentsText1');
            if (el && el.innerHTML !== MSG) el.innerHTML = MSG;
            Game.Ticker = MSG;
        }, 100);

        if (Game.Notify) Game.Notify("Asfixy Guard", "Dataloss started. Nothing will be saved. Refresh to reset.", [17, 5]);
        logger("Dataloss mode active.", "warn");
    }

    // ─────────────────────────────────────────────
    //  MODE: CRASH
    // ─────────────────────────────────────────────

    function runCrash() {
        logger("Crash mode initiated. :D", "warn");
        Game.CalculateGains = NaN;
        Game.CalculateGains();
        alert(":o");
    }

    // ─────────────────────────────────────────────
    //  KEY SYSTEM + DISPATCHER
    // ─────────────────────────────────────────────

    async function checkGameReady() {
        if (window.Game && window.Game.ready) {
            const currentVer = String(Game.version).trim();
            const isAllowed  = ALLOWED_VERSIONS.some(v => currentVer.includes(v));

            if (!isAllowed) {
                alert(`Version Error! Version: ${currentVer}\nAllowed: ${ALLOWED_VERSIONS.join(", ")}`);
                return;
            }

            // Localhost fallback
            try {
                await fetch(API_URL + "/");
                logger("Connected to Localhost API!", "success");
            } catch (e) {
                API_URL = "https://asfixy-api.onrender.com";
                logger(`Localhost failed. Using: ${API_URL}`, "warn");
            }

            // --- crash mode skips auth ---
            if (Script === "crash") {
                runCrash();
                return;
            }

            const userKey = window._asfixy_key || prompt("Please enter your Access Key:", "");
            if (!userKey) { logger("Execution cancelled: No key provided.", "error"); return; }

            fetch(`${API_URL}/redeem-key`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ key: userKey })
            })
            .then(response => {
                if (!response.ok) return response.json().then(err => { throw new Error(err.message || "Access Denied"); });
                return response.json();
            })
            .then(data => {
                if (!data.valid) { alert(`API Error: ${data.reason || "Invalid Key"}`); return; }

                authenticatedKey = userKey;
                logger(`Auth Success: ${data.msg || "API validated access."}`, "success");

                if (Script === "dataloss") {
                    runDataloss();
                } else {
                    // main = AutoFarm
                    mainFarmCycle();
                }
            })
            .catch(error => {
                alert(`Asfixy Auth Error: ${error.message}`);
                logger(`Auth Error: ${error.message}`, "error");
            });

        } else {
            setTimeout(checkGameReady, 1000);
        }
    }

    // Cleanup and Start
    if (window.ASFIXY_FARM_INSTANCE) window.ASFIXY_FARM_INSTANCE.stop();
    window.ASFIXY_FARM_INSTANCE = { stop: stopContinuousActions };

    checkGameReady();
})();
