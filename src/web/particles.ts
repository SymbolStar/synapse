/** Returns an inline <script> tag that renders a floating particle background. */
export function getParticleScript(): string {
	return `<canvas id="particle-bg" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none"></canvas>
<script>
(function(){
var canvas=document.getElementById('particle-bg');
var ctx=canvas.getContext('2d');
var W,H;
var mouse={x:-9999,y:-9999};
var PARTICLE_COUNT=70;
var REPEL_RADIUS=150;
var particles=[];

function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;}
resize();
window.addEventListener('resize',resize);

document.addEventListener('mousemove',function(e){mouse.x=e.clientX;mouse.y=e.clientY;});
document.addEventListener('mouseleave',function(){mouse.x=-9999;mouse.y=-9999;});

var colors=[
{r:255,g:255,b:255,a:0},
{r:255,g:255,b:255,a:0},
{r:255,g:255,b:255,a:0},
{r:0,g:113,b:227,a:0},
{r:217,g:119,b:87,a:0}
];
var weights=[0.45,0.45,0.45,0.3,0.15];

function pickColor(){
var r=Math.random(),sum=0;
for(var i=0;i<weights.length;i++){sum+=weights[i];if(r<sum)return colors[i];}
return colors[0];
}

function createParticle(){
var c=pickColor();
var isBlue=c.r===0&&c.g===113;
var isAmber=c.r===217;
var baseAlpha=isAmber?0.08:isBlue?0.1:(0.1+Math.random()*0.2);
var size=2+Math.random()*6;
var ring=Math.random()<0.35;
return{
x:Math.random()*W,
y:Math.random()*H,
vx:(Math.random()-0.5)*0.6,
vy:(Math.random()-0.5)*0.6,
size:size,
ring:ring,
color:c,
alpha:baseAlpha,
phase:Math.random()*Math.PI*2,
freq:0.005+Math.random()*0.01,
amp:0.3+Math.random()*0.5,
pushX:0,
pushY:0
};
}

for(var i=0;i<PARTICLE_COUNT;i++) particles.push(createParticle());

function tick(){
if(document.hidden){requestAnimationFrame(tick);return;}
ctx.clearRect(0,0,W,H);
for(var i=0;i<particles.length;i++){
var p=particles[i];
p.phase+=p.freq;
var ox=Math.sin(p.phase)*p.amp;
var oy=Math.cos(p.phase*0.7)*p.amp;

var dx=p.x-mouse.x,dy=p.y-mouse.y;
var dist=Math.sqrt(dx*dx+dy*dy);
if(dist<REPEL_RADIUS&&dist>0){
var force=(1-dist/REPEL_RADIUS)*2.5;
p.pushX+=dx/dist*force;
p.pushY+=dy/dist*force;
}
p.pushX*=0.92;
p.pushY*=0.92;

p.x+=p.vx+ox*0.1+p.pushX;
p.y+=p.vy+oy*0.1+p.pushY;

if(p.x<-p.size)p.x=W+p.size;
if(p.x>W+p.size)p.x=-p.size;
if(p.y<-p.size)p.y=H+p.size;
if(p.y>H+p.size)p.y=-p.size;

ctx.beginPath();
ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
var rgba='rgba('+p.color.r+','+p.color.g+','+p.color.b+','+p.alpha+')';
if(p.ring){
ctx.strokeStyle=rgba;
ctx.lineWidth=1;
ctx.stroke();
}else{
ctx.fillStyle=rgba;
ctx.fill();
}
}
requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
})();
<\/script>`;
}
