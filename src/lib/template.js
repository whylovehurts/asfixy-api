/**
 * Template Loader
 * Loads HTML templates from src/templates folder
 */
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplate(templatePath) {
    const fullPath = path.join(TEMPLATES_DIR, templatePath);
    try {
        return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        console.error(`[Template] Error loading ${templatePath}:`, e.message);
        return '';
    }
}

function render(templatePath, data = {}) {
    let html = loadTemplate(templatePath);
    for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return html;
}

module.exports = {
    loadTemplate,
    render,
    TEMPLATES_DIR
};