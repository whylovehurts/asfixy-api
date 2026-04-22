/**
 * Template Loader
 * Centralized template loading system
 */
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function load(name) {
    let filePath = path.join(TEMPLATES_DIR, name, 'index.html');
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    }
    filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        console.error(`[Template] Missing: ${filePath}`);
        return '';
    }
}

function css(name) {
    const filePath = path.join(TEMPLATES_DIR, name, 'styles.css');
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return '';
    }
}

function js(name) {
    const filePath = path.join(TEMPLATES_DIR, name, 'client.js');
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return '';
    }
}

function render(name, data = {}) {
    let html = load(name);
    
    // First: Inject CSS and JS (before variable replacement)
    const cssContent = css(name);
    const jsContent = js(name);
    
    // Replace CSS link with inline styles
    if (cssContent) {
        html = html.replace(
            `<link rel="stylesheet" href="/static/styles/${name}.css">`,
            `<style>${cssContent}</style>`
        );
    }
    
    // Replace JS script src with inline script (using placeholder for nonce)
    if (jsContent) {
        html = html.replace(
            `<script nonce="{{NONCE}}" src="/static/js/${name}.js">`,
            `<script nonce="{{NONCECE}}">${jsContent}</script>`
        );
    }
    
    // Second: Replace template variables
    for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    // Fix the nonce placeholder we used to avoid conflicts
    html = html.replace(/{{NONCECE}}/g, '{{NONCE}}');
    
    // Replace {{NONCE}} with actual nonce value from data
    if (data.NONCE) {
        html = html.replace(/nonce="{{NONCE}}"/g, `nonce="${data.NONCE}"`);
    }
    
    return html;
}

module.exports = {
    load,
    css,
    js,
    render,
    TEMPLATES_DIR
};