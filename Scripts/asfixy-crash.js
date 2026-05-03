(function () {
    'use strict';

    let API_URL = "http://127.0.0.1:3000";
    const CONFIG = { version: "Crash", debugMode: true };
    const ALLOWED_VERSIONS = ["2.058", "2.052"];

    function logger(message, type = "log") {
        if (!CONFIG.debugMode) return;
    }

    function runCrash() {
        logger("Crash mode initiated. :D", "warn");
        if (!window.Game) return;
        Game.CalculateGains = NaN;
        Game.CalculateGains();
        alert(":o");
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
            } catch (e) {
                API_URL = "https://asfixy.up.railway.app";
            }

            runCrash();
        } else {
            setTimeout(checkGameReady, 1000);
        }
    }

    if (window.ASFIXY_FARM_INSTANCE) window.ASFIXY_FARM_INSTANCE.stop();
    window.ASFIXY_FARM_INSTANCE = { stop: () => { } };

    checkGameReady();
})();