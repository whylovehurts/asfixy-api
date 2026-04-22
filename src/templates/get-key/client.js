function copy(){
    navigator.clipboard.writeText(document.getElementById('key').innerText);
    showToast("Key copied");
}
document.getElementById('copyBtn').addEventListener('click', copy);
document.getElementById('key').addEventListener('click', copy);

function showToast(msg){
    const t=document.getElementById('toast');
    t.innerText=msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
}

{{TIMER_SCRIPT}}

const c=document.getElementById('bg');
const ctx=c.getContext('2d');
c.width=innerWidth;
c.height=innerHeight;

let p=[];
for(let i=0;i<70;i++){
    p.push({x:Math.random()*c.width,y:Math.random()*c.height,v:Math.random()*0.6});
}

function draw(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(255,51,51,0.2)';
    p.forEach(e=>{
        e.y+=e.v;
        if(e.y>c.height)e.y=0;
        ctx.fillRect(e.x,e.y,2,2);
    });
    requestAnimationFrame(draw);
}
draw();

localStorage.setItem("asfixy_key", document.getElementById("key").innerText);