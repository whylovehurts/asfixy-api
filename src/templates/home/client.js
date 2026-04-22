setTimeout(()=>document.querySelector('.loader').style.display='none',800);

document.querySelectorAll('.card[data-href]').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        const href = card.getAttribute('data-href');
        if (href.startsWith('http')) window.open(href, '_blank');
        else window.location.href = href;
    });
});

function toast(msg){
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

function copyApi(){
    navigator.clipboard.writeText(location.origin + '/status');
    toast("API copied");
}

const savedKey = localStorage.getItem('asfixy_key');
const kd = document.getElementById('keyDisplay');
if(savedKey) {
    kd.innerHTML = '<div class="badge">ACTIVE SESSION</div>' +
        '<h3>ASFIXY ACCESS</h3>' +
        '<div class="key-val" style="cursor:pointer;" onclick="navigator.clipboard.writeText(\'' + savedKey + '\');toast(\'Key copied!\');">' + savedKey + '</div>' +
        '<div id="keyTime" style="color:var(--accent);margin-bottom:20px;font-size:1.1rem;letter-spacing:2px;">Loading...</div>' +
        '<button class="btn-get" onclick="navigator.clipboard.writeText(\'' + savedKey + '\');toast(\'Key copied!\');">COPY KEY</button>' +
        '<div style="font-size:0.7rem;opacity:0.5;margin-top:15px;" id="keyIp">IP: Checking...</div>';

    fetch('/key-info/' + savedKey).then(r=>r.json()).then(d => {
        if(!d.valid) {
            kd.innerHTML = '<div class="badge" style="background:#ff3333;color:#fff;">EXPIRED</div><h3>SESSION ENDED</h3><a href="/get-key" class="btn-get">GET NEW KEY</a>';
            localStorage.removeItem('asfixy_key');
        } else {
            document.getElementById('keyIp').innerText = 'IP: ' + (d.ip || 'Unknown');
            if(d.perm) {
                document.getElementById('keyTime').innerText = 'LIFETIME';
            } else {
                setInterval(()=>{
                    d.ms -= 1000;
                    if(d.ms <= 0) location.reload();
                    let s = Math.floor(d.ms / 1000);
                    let h = Math.floor(s / 3600);
                    let m = Math.floor((s % 3600) / 60);
                    let sec = s % 60;
                    document.getElementById('keyTime').innerText = 
                        h.toString().padStart(2, '0') + ':' + 
                        m.toString().padStart(2, '0') + ':' + 
                        sec.toString().padStart(2, '0');
                }, 1000);
            }
        }
    }).catch(()=>{});
} else {
    kd.innerHTML = '<div class="badge" style="opacity:0.5;">NO SESSION</div>' +
        '<h3>ASFIXY ACCESS</h3>' +
        '<div class="key-val" style="color:#555;border-color:rgba(255,255,255,0.1);background:rgba(0,0,0,0.5);">---</div>' +
        '<a href="/get-key" class="btn-get">GET NEW KEY</a>';
}

const c = document.getElementById('bg');
const ctx = c.getContext('2d');
c.width = innerWidth;
c.height = innerHeight;

let p = [];
for(let i=0;i<60;i++){
    p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.5});
}

function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,51,51,0.2)';
    p.forEach(e=>{
        e.y+=e.v;
        if(e.y>c.height) e.y=0;
        ctx.fillRect(e.x,e.y,2,2);
    });
    requestAnimationFrame(draw);
}
draw();
