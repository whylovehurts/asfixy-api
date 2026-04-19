const DURACAO_KEY = 12 * 60 * 60 * 1000; 

function formatTime(ms) {
    if (ms < 0) return "INFINITY";
    let totalSecs = Math.floor(ms / 1000);
    let h = Math.floor(totalSecs / 3600);
    let m = Math.floor((totalSecs % 3600) / 60);
    let s = totalSecs % 60;
    return h.toString().padStart(2, '0') + ":" + m.toString().padStart(2, '0') + ":" + s.toString().padStart(2, '0');
}

const numToChar = (n) => String.fromCharCode(65 + parseInt(n));

function gerarKeyAsfixy() {
    const possiveisNumeros = [1, 2, 3, 5, 7, 9]; 
    let numerosGerados = "";
    let letrasAssinatura = "";
    for (let i = 0; i < 6; i++) {
        const num = possiveisNumeros[Math.floor(Math.random() * possiveisNumeros.length)];
        numerosGerados += num;
        letrasAssinatura += numToChar(num);
    }
    return `Asfixy-${numerosGerados}${letrasAssinatura}`;
}

module.exports = {
    DURACAO_KEY,
    formatTime,
    gerarKeyAsfixy
};