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
        version: "Dataloss",
        debugMode: true
    };

    const ALLOWED_VERSIONS = ["2.058", "2.052"];
    const logPrefix = `[Asfixy ${CONFIG.version}]: `;

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

    function runDataloss() {
        if (!window.Game || !Game.ready) { setTimeout(runDataloss, 500); return; }

        const MSG = "Asfixy Engine: Dataloss System Active.\nNothing will be saved. Refresh the page to reset.\nJoin discord: https://discord.gg/uSvZ5BJuJ4";

        Game.WriteSave = function () { return ""; };
        Game.Save = function () {
            if (Game.Notify) Game.Notify("Dataloss Active", "Asfixy blocked save. Dataloss is active! =)", [16, 5]);
        };
        Game.autosave = 0;
        if (Game.prefs) Game.prefs.autosave = 0;

        window.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.keyCode === 83) {
                e.preventDefault();
                if (Game.Notify) Game.Notify("Ctrl+S Blocked", "Asfixy prevented shortcut save.", [16, 5]);
            }
        }, true);

        document.addEventListener('click', function (e) {
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
        Game.UpdateMenu = function () {
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
                    runDataloss();
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
    window.ASFIXY_FARM_INSTANCE = { stop: () => { } };

    checkGameReady();
})();