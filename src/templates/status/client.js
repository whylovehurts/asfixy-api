document.getElementById('searchInput').addEventListener('input', function(){ filter(this.value); });
function filter(v){
    v = v.toLowerCase();
    document.querySelectorAll('.card').forEach(c=>{
        const name = c.getAttribute('data-name').toLowerCase();
        c.style.display = name.includes(v) ? 'block' : 'none';
    });
}

function copySave(saveStr) {
    if (!saveStr) return;
    navigator.clipboard.writeText(saveStr).then(() => {
        const t = document.getElementById('toast');
        t.innerText = "Save copied!";
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }).catch(() => { alert("Failed to copy save."); });
}

document.getElementById('grid').addEventListener('click', function(e) {
    const btn = e.target.closest('.copy-btn[data-save]');
    if (btn) copySave(btn.getAttribute('data-save'));
});