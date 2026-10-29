/* ============================================================
   Always On Generators – Field Hub
   Holiday Themes  |  seasonal.js  |  v1.0.0

   ONE copy of the holiday-theme engine for every form page. Before this,
   each of the 8 forms carried its own ~45 KB copy, all slightly different.

   WHAT LIVES HERE (shared):
     - SEASONAL_THEMES          which holiday runs on which dates
     - getCurrentSeasonalTheme  today's theme
     - applySeasonalTheme(n)    turn a theme on/off (body.seasonal-<n> + particles)
     - createSeasonalCanvas(n)  the falling snow / bats / fireworks / ... layer

   WHAT STAYS IN EACH FORM (because it styles that form's own layout):
     - injectSeasonalStyles()   the per-form holiday colors (#seasonal-styles)
     - optional page settings, set before the form starts its theme:
         var SEASONAL_PAGE_TITLE = 'Maintenance Report';  // tab title to use
         var SEASONAL_TITLES = { halloween: '🎃 ...' };      // holiday tab titles
         var SEASONAL_CANVAS_OPACITY = 0.55;                 // particle strength
       Without SEASONAL_PAGE_TITLE the form keeps its own tab title.

   HOW TO USE: one line in the form's <head>, before the form's own scripts:
       <script src="../seasonal.js"></script>
   Testing: add ?season=halloween (or christmas, ... or off) to the URL.

   Saved PDFs / captures never show a theme: clean-capture.js turns it off
   (and pauses these particles) for the duration of every export.
   ============================================================ */

var SEASONAL_THEMES = {
  // ── Specific holidays first (narrow ranges take priority over broad seasons) ──
  'newyear':     {'start':{month:1,day:1},'end':{month:1,day:7}},
  'valentines':  {'start':{month:2,day:1},'end':{month:2,day:28}},
  'stpatricks':  {'start':{month:3,day:1},'end':{month:3,day:31}},
  'easter':      {'start':{month:3,day:25},'end':{month:4,day:20}},
  'mothersday':  {'start':{month:5,day:1},'end':{month:5,day:14}},
  'memorialday': {'start':{month:5,day:25},'end':{month:5,day:31}},
  'fathersday':  {'start':{month:6,day:1},'end':{month:6,day:20}},
  'fourthofjuly':{'start':{month:7,day:1},'end':{month:7,day:10}},
  'hotsummer':   {'start':{month:7,day:11},'end':{month:8,day:10}},
  'backtoschool':{'start':{month:8,day:11},'end':{month:8,day:31}},
  'laborday':    {'start':{month:9,day:1},'end':{month:9,day:7}},
  'halloween':   {'start':{month:10,day:1},'end':{month:10,day:31}},
  'veteransday': {'start':{month:11,day:11},'end':{month:11,day:11}},
  'thanksgiving':{'start':{month:11,day:1},'end':{month:11,day:30}},
  'christmas':   {'start':{month:12,day:1},'end':{month:12,day:31}},
  // ── Broad seasons last (catch-all fallbacks) ──
  'spring':      {'start':{month:3,day:20},'end':{month:6,day:20}},
  'summer':      {'start':{month:6,day:21},'end':{month:9,day:22}},
  'fall':        {'start':{month:9,day:23},'end':{month:10,day:31}}
};

function getCurrentSeasonalTheme() {
  var today=new Date(), month=today.getMonth()+1, date=today.getDate();
  for (var key in SEASONAL_THEMES) {
    var theme = SEASONAL_THEMES[key], start=theme.start, end=theme.end;
    var isActive = false;
    if (start.month===end.month) { isActive = month===start.month && date>=start.day && date<=end.day; }
    else { isActive = (month===start.month&&date>=start.day)||(month===end.month&&date<=end.day)||(month>start.month&&month<end.month); }
    if (isActive) return key;
  }
  return 'default';
}

function applySeasonalTheme(n) {
  Object.keys(SEASONAL_THEMES).forEach(function(k) { document.body.classList.remove('seasonal-'+k); });
  document.querySelectorAll('#seasonal-canvas, .seasonal-canvas').forEach(function(c) { c.remove(); });
  var on = (n !== 'default' && SEASONAL_THEMES[n]);
  if (on) {
    document.body.classList.add('seasonal-'+n);
    createSeasonalCanvas(n);
  }
  if (typeof SEASONAL_PAGE_TITLE === 'string') {
    document.title = (on && typeof SEASONAL_TITLES === 'object' && SEASONAL_TITLES[n]) || SEASONAL_PAGE_TITLE;
  }
}

// ── SEASONAL CANVAS PARTICLES ──
function createSeasonalCanvas(theme) {
  // Only on a form page (any of the layouts the forms use).
  if (!document.querySelector('#page1, #page, .form-page, .page, .page-wrapper')) return;

  var canvas = document.createElement('canvas');
  canvas.id = 'seasonal-canvas';
  canvas.className = 'seasonal-canvas';            // both hooks, so any form's selectors find it
  var op = (typeof window.SEASONAL_CANVAS_OPACITY === 'number') ? window.SEASONAL_CANVAS_OPACITY : 0.5;
  // fixed to the VIEWPORT (not the multi-thousand-px page): ~10x fewer pixels to draw
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:0;opacity:' + op + ';';
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var W, H, particles = [], animId;

  function isDead() { return !(canvas.isConnected !== undefined ? canvas.isConnected : document.body.contains(canvas)); }
  function resize() {
    if (isDead()) { window.removeEventListener('resize', resize); return; }
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);
  setTimeout(resize, 500);

  var configs = {
    newyear: {
      count: 80,
      make: function() {
        var colors = ['#FFD700','#FF69B4','#00BFFF','#FF4500','#ADFF2F','#FF1493','#7FFF00'];
        return {
          x: Math.random()*W, y: Math.random()*H,
          vx: (Math.random()-0.5)*1.2, vy: -Math.random()*2-0.5,
          life: Math.random(), decay: 0.003+Math.random()*0.004,
          size: 3+Math.random()*5,
          color: colors[Math.floor(Math.random()*colors.length)],
          shape: Math.random()<0.5 ? 'rect' : 'star',
          spin: (Math.random()-0.5)*0.15
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y); ctx.rotate(p.spin * Date.now()/1000);
        if (p.shape==='rect') {
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.4);
        } else {
          ctx.beginPath();
          for (var i=0;i<5;i++) {
            var a = (i*4*Math.PI/5)-Math.PI/2;
            var b = a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*p.size, Math.sin(a)*p.size);
            ctx.lineTo(Math.cos(b)*p.size*0.4, Math.sin(b)*p.size*0.4);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.x+=p.vx; p.y+=p.vy; p.life-=p.decay;
        if (p.life<=0||p.y<-20) { p.y=H+10; p.x=Math.random()*W; p.life=0.8+Math.random()*0.2; }
      }
    },
    valentines: {
      count: 35,
      make: function() {
        var pinks = ['#FF69B4','#FF1493','#FFB6C1','#FF6EB4','#DC143C'];
        return {
          x: Math.random()*W, y: H+20,
          vx: (Math.random()-0.5)*0.6, vy: -0.6-Math.random()*1.2,
          life: 0.7+Math.random()*0.3, decay: 0.002+Math.random()*0.003,
          size: 8+Math.random()*18,
          color: pinks[Math.floor(Math.random()*pinks.length)],
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.02+Math.random()*0.03
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha = p.life * 0.8;
        ctx.fillStyle = p.color;
        var s = p.size;
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.wobble)*0.2);
        ctx.beginPath();
        ctx.moveTo(0, s*0.25);
        ctx.bezierCurveTo(-s*0.5, -s*0.3, -s, s*0.1, 0, s*0.8);
        ctx.bezierCurveTo(s, s*0.1, s*0.5, -s*0.3, 0, s*0.25);
        ctx.fill();
        ctx.restore();
      },
      tick: function(p) {
        p.wobble+=p.wobbleSpeed; p.x+=p.vx+Math.sin(p.wobble)*0.5; p.y+=p.vy; p.life-=p.decay;
        if (p.life<=0||p.y<-40) { p.y=H+20; p.x=Math.random()*W; p.life=0.7+Math.random()*0.3; }
      }
    },
    stpatricks: {
      count: 30,
      make: function() {
        return {
          x: Math.random()*W, y: Math.random()*H,
          vx: (Math.random()-0.5)*0.4, vy: -0.3-Math.random()*0.7,
          life: 0.6+Math.random()*0.4, decay: 0.002+Math.random()*0.003,
          size: 10+Math.random()*16,
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.04
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha = p.life * 0.7;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size*0.5;
        ['#22C55E','#16A34A','#15803D','#4ADE80'].forEach(function(col,i) {
          ctx.fillStyle=col;
          ctx.beginPath();
          var a=i*Math.PI/2;
          ctx.arc(Math.cos(a)*s*0.5, Math.sin(a)*s*0.5, s*0.6, 0, Math.PI*2);
          ctx.fill();
        });
        ctx.fillStyle='#166534';
        ctx.fillRect(-1, 0, 2, p.size);
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy; p.life-=p.decay;
        if (p.life<=0||p.y<-30) { p.y=H+10; p.x=Math.random()*W; p.life=0.6+Math.random()*0.4; }
      }
    },
    spring: {
      count: 40,
      make: function() {
        var cols=['#FFC0CB','#FFB347','#87CEEB','#98FB98','#DDA0DD','#F0E68C'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*1.5, vy: 0.8+Math.random()*1.2,
          life: 1, decay: 0,
          size: 6+Math.random()*10,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.06,
          swing: Math.random()*Math.PI*2, swingSpeed: 0.02+Math.random()*0.03
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.75;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        for (var i=0;i<5;i++) {
          ctx.save(); ctx.rotate(i*Math.PI*2/5);
          ctx.beginPath();
          ctx.ellipse(0,-s*0.6,s*0.3,s*0.6,0,0,Math.PI*2);
          ctx.fill(); ctx.restore();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.swing+=p.swingSpeed; p.rot+=p.rotSpeed;
        p.x+=p.vx+Math.sin(p.swing)*0.8; p.y+=p.vy;
        if (p.y>H+20) { p.y=-10; p.x=Math.random()*W; }
      }
    },
    summer: {
      count: 34,
      make: function(i) {
        // i 0: anchored corner sun.  i 1-4: drifting clouds.  rest: rising beach items.
        if (i === 0) {
          return { type:'sun', size:46, ray:0, raySpeed:0.004, pulse:Math.random()*Math.PI*2, pulseSpeed:0.03, life:1, decay:0 };
        }
        if (i !== undefined && i <= 4) {
          return {
            type:'cloud',
            x: Math.random()*W, y: 30+Math.random()*(H*0.35),
            vx: 0.15+Math.random()*0.25,
            size: 26+Math.random()*26,
            life:1, decay:0
          };
        }
        var kinds=['shades','palm','ball','icecream','watermelon','shades','ball'];
        return {
          type: kinds[Math.floor(Math.random()*kinds.length)],
          x: Math.random()*W, y: H+30+Math.random()*H,
          vx: (Math.random()-0.5)*0.5, vy: -(0.35+Math.random()*0.7),
          size: 14+Math.random()*16,
          rot: (Math.random()-0.5)*0.6, rotSpeed:(Math.random()-0.5)*0.012,
          bob: Math.random()*Math.PI*2, bobSpeed:0.02+Math.random()*0.03,
          life:1, decay:0
        };
      },
      draw: function(p) {
        ctx.save();
        if (p.type==='sun') {
          var cx=W-58, cy=58, s=p.size*(1+0.04*Math.sin(p.pulse));
          var glow=ctx.createRadialGradient(cx,cy,0,cx,cy,s*2.4);
          glow.addColorStop(0,'rgba(255,213,79,0.5)');
          glow.addColorStop(1,'rgba(255,213,79,0)');
          ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(cx,cy,s*2.4,0,Math.PI*2); ctx.fill();
          ctx.translate(cx,cy); ctx.rotate(p.ray);
          ctx.strokeStyle='rgba(255,179,0,0.85)'; ctx.lineWidth=4; ctx.lineCap='round';
          for (var i=0;i<12;i++){ ctx.save(); ctx.rotate(i*Math.PI/6);
            ctx.beginPath(); ctx.moveTo(0,s*1.25); ctx.lineTo(0,s*1.7); ctx.stroke(); ctx.restore(); }
          var sd=ctx.createRadialGradient(0,0,s*0.2,0,0,s);
          sd.addColorStop(0,'#FFF59D'); sd.addColorStop(1,'#FFB300');
          ctx.fillStyle=sd; ctx.beginPath(); ctx.arc(0,0,s,0,Math.PI*2); ctx.fill();
          ctx.restore(); return;
        }
        if (p.type==='cloud') {
          ctx.globalAlpha=0.7; ctx.translate(p.x,p.y); var s=p.size; ctx.fillStyle='#ffffff';
          [[0,0,1],[-s*0.55,s*0.18,0.7],[s*0.55,s*0.18,0.7],[-s*0.25,-s*0.18,0.75],[s*0.3,-s*0.12,0.7]].forEach(function(c){
            ctx.beginPath(); ctx.arc(c[0],c[1],s*0.55*c[2],0,Math.PI*2); ctx.fill(); });
          ctx.beginPath(); ctx.ellipse(0,s*0.32,s*0.95,s*0.32,0,0,Math.PI*2); ctx.fill();
          ctx.restore(); return;
        }
        ctx.globalAlpha=0.92; ctx.translate(p.x,p.y); ctx.rotate(p.rot+Math.sin(p.bob)*0.12);
        var s=p.size;
        if (p.type==='shades') {
          ctx.fillStyle='#1f2937'; ctx.strokeStyle='#1f2937'; ctx.lineWidth=s*0.16;
          ctx.beginPath(); ctx.arc(-s*0.5,0,s*0.42,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(s*0.5,0,s*0.42,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-s*0.12,-s*0.05); ctx.lineTo(s*0.12,-s*0.05); ctx.stroke();
          ctx.fillStyle='rgba(120,200,255,0.55)';
          ctx.beginPath(); ctx.arc(-s*0.5,0,s*0.30,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(s*0.5,0,s*0.30,0,Math.PI*2); ctx.fill();
        } else if (p.type==='palm') {
          ctx.strokeStyle='#8d6e63'; ctx.lineWidth=s*0.14; ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(0,s*0.7); ctx.quadraticCurveTo(s*0.1,0,-s*0.05,-s*0.5); ctx.stroke();
          ctx.fillStyle='#2e9e5b';
          for (var k=0;k<5;k++){ ctx.save(); ctx.translate(-s*0.05,-s*0.5); ctx.rotate((k-2)*0.55);
            ctx.beginPath(); ctx.ellipse(0,-s*0.45,s*0.16,s*0.5,0,0,Math.PI*2); ctx.fill(); ctx.restore(); }
        } else if (p.type==='ball') {
          ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(0,0,s*0.55,0,Math.PI*2); ctx.fill();
          var cols=['#ef4444','#f59e0b','#3b82f6','#10b981']; 
          for (var w=0;w<4;w++){ ctx.fillStyle=cols[w];
            ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,s*0.55,w*Math.PI/2,w*Math.PI/2+Math.PI/2); ctx.closePath();
            ctx.globalAlpha=0.85; ctx.fill(); ctx.globalAlpha=0.92; }
          ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(0,0,s*0.55,0,Math.PI*2); ctx.stroke();
        } else if (p.type==='icecream') {
          ctx.fillStyle='#e3b07a'; ctx.beginPath();
          ctx.moveTo(-s*0.32,-s*0.05); ctx.lineTo(s*0.32,-s*0.05); ctx.lineTo(0,s*0.7); ctx.closePath(); ctx.fill();
          ctx.fillStyle='#ffd1dc'; ctx.beginPath(); ctx.arc(-s*0.14,-s*0.18,s*0.27,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#fff1ba'; ctx.beginPath(); ctx.arc(s*0.16,-s*0.2,s*0.27,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#bff0d4'; ctx.beginPath(); ctx.arc(0,-s*0.42,s*0.27,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.arc(0,-s*0.64,s*0.09,0,Math.PI*2); ctx.fill();
        } else { // watermelon slice
          ctx.fillStyle='#2e9e5b'; ctx.beginPath(); ctx.arc(0,0,s*0.55,Math.PI,0); ctx.closePath(); ctx.fill();
          ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(0,0,s*0.47,Math.PI,0); ctx.closePath(); ctx.fill();
          ctx.fillStyle='#ff5e7e'; ctx.beginPath(); ctx.arc(0,0,s*0.4,Math.PI,0); ctx.closePath(); ctx.fill();
          ctx.fillStyle='#1f2937';
          [-0.22,0,0.22].forEach(function(dx){ ctx.beginPath(); ctx.arc(s*dx,-s*0.16,s*0.045,0,Math.PI*2); ctx.fill(); });
        }
        ctx.restore();
      },
      tick: function(p) {
        if (p.type==='sun') { p.ray+=p.raySpeed; p.pulse+=p.pulseSpeed; return; }
        if (p.type==='cloud') { p.x+=p.vx; if (p.x>W+p.size*1.5) { p.x=-p.size*1.5; p.y=30+Math.random()*(H*0.35); } return; }
        p.bob+=p.bobSpeed; p.rot+=p.rotSpeed;
        p.x+=p.vx+Math.sin(p.bob)*0.4; p.y+=p.vy;
        if (p.y<-40) { p.y=H+30+Math.random()*60; p.x=Math.random()*W; }
      }
    },
    fourthofjuly: (function() {
      // Real fireworks: rockets launch from the bottom, arc up trailing sparks,
      // then explode into varied bursts (sphere / ring / willow / two-color).
      var PALETTE=['#FF2D2D','#FFFFFF','#2D6DFF','#FF7A00','#FFD400','#22C55E','#FF3EA5','#00E5FF'];
      function rnd(a,b){ return a+Math.random()*(b-a); }
      function pick(a){ return a[(Math.random()*a.length)|0]; }
      var G=0.12; // gravity used for both launch calc and ascent
      function newRise(){
        var startY=H+rnd(0,30);
        var targetY=rnd(H*0.12,H*0.72);          // spread bursts: some high, some low
        var vy=-Math.sqrt(2*G*(startY-targetY))*rnd(1.0,1.05); // launch speed scaled to page height
        return {
          phase:'rise',
          x:rnd(W*0.12,W*0.88), y:startY,
          vx:rnd(-0.4,0.4), vy:vy,
          targetY:targetY,
          color:pick(PALETTE),
          trail:[], sparks:[], flash:0, delay:0
        };
      }
      function explode(p){
        p.phase='burst'; p.flash=1;
        if (window.AOGSound) AOGSound.play('explosion');
        var type=pick(['sphere','sphere','ring','willow','chrys']);
        var n=type==='ring'?44:(30+(Math.random()*22|0));
        var base=rnd(3.2,5.4);
        var twoColor=Math.random()<0.4, c2=pick(PALETTE);
        for(var i=0;i<n;i++){
          var ang=(i/n)*Math.PI*2+rnd(-0.06,0.06);
          var sp=type==='ring'?base:base*rnd(0.35,1);
          p.sparks.push({
            x:p.x, y:p.y,
            vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp,
            life:1, decay:rnd(0.008,0.016), size:rnd(1.4,2.8),
            color:twoColor?(i%2?c2:p.color):p.color,
            willow:type==='willow', tw:Math.random()*6.28, hist:[]
          });
        }
      }
      return {
        count: 6,
        make: function(){
          try { canvas.style.opacity='0.85'; } catch(e){}
          var p=newRise(); p.phase='wait'; p.delay=(Math.random()*170)|0; return p;
        },
        draw: function(p){
          ctx.save(); ctx.globalCompositeOperation='lighter';
          if (p.phase==='rise'){
            for (var i=0;i<p.trail.length;i++){
              var t=p.trail[i], a=(i+1)/p.trail.length;
              ctx.globalAlpha=a*0.6; ctx.fillStyle='#FFE9B0';
              ctx.beginPath(); ctx.arc(t.x,t.y,1.6*a+0.4,0,6.283); ctx.fill();
            }
            ctx.fillStyle=p.color;
            ctx.globalAlpha=0.35; ctx.beginPath(); ctx.arc(p.x,p.y,5,0,6.283); ctx.fill(); // halo
            ctx.globalAlpha=1; ctx.fillStyle='#FFF6D8';
            ctx.beginPath(); ctx.arc(p.x,p.y,2.2,0,6.283); ctx.fill();
          } else if (p.phase==='burst'){
            // PERF: no shadowBlur here — canvas shadows are hugely expensive
            // with hundreds of sparks. A soft halo circle fakes the glow.
            if (p.flash>0){
              var fr=16*(1-p.flash)+6;
              ctx.fillStyle=p.color;
              ctx.globalAlpha=p.flash*0.18; ctx.beginPath(); ctx.arc(p.x,p.y,fr*2.2,0,6.283); ctx.fill();
              ctx.globalAlpha=p.flash*0.5;  ctx.beginPath(); ctx.arc(p.x,p.y,fr,0,6.283); ctx.fill();
            }
            for (var j=0;j<p.sparks.length;j++){
              var s=p.sparks[j]; if (s.life<=0) continue;
              ctx.fillStyle=s.color;
              for (var k=0;k<s.hist.length;k++){
                var h=s.hist[k];
                ctx.globalAlpha=(k/s.hist.length)*s.life*0.5;
                ctx.beginPath(); ctx.arc(h.x,h.y,s.size*0.7,0,6.283); ctx.fill();
              }
              var flick=0.75+Math.sin(s.tw)*0.25, la=Math.max(0,s.life)*flick;
              ctx.globalAlpha=la*0.3; ctx.beginPath(); ctx.arc(s.x,s.y,s.size*2,0,6.283); ctx.fill(); // halo
              ctx.globalAlpha=la;     ctx.beginPath(); ctx.arc(s.x,s.y,s.size,0,6.283); ctx.fill();  // core
            }
          }
          ctx.restore();
        },
        tick: function(p){
          var kk, src;
          if (p.phase==='wait'){
            if (--p.delay<=0){ src=newRise(); for (kk in src) p[kk]=src[kk]; if (window.AOGSound) AOGSound.play('launch'); }
            return;
          }
          if (p.phase==='rise'){
            p.trail.push({x:p.x,y:p.y}); if (p.trail.length>8) p.trail.shift();
            p.x+=p.vx; p.y+=p.vy; p.vy+=G;
            if (p.y<=p.targetY || p.vy>=-0.3) explode(p);
            return;
          }
          if (p.flash>0) p.flash-=0.06;
          var alive=0;
          for (var j=0;j<p.sparks.length;j++){
            var s=p.sparks[j]; if (s.life<=0) continue;
            s.hist.push({x:s.x,y:s.y}); if (s.hist.length>3) s.hist.shift();
            s.vx*=0.985; s.vy*=0.985; s.vy+=s.willow?0.055:0.03;
            s.x+=s.vx; s.y+=s.vy; s.life-=s.decay; s.tw+=0.3;
            if (s.life>0) alive++;
          }
          if (alive===0){ src=newRise(); src.phase='wait'; src.delay=(Math.random()*130|0); for (kk in src) p[kk]=src[kk]; }
        }
      };
    })(),
    halloween: {
      count: 25,
      make: function() {
        var types=['bat','bat','bat','ghost','pumpkin'];
        return {
          x: Math.random()*W, y: Math.random()*H,
          vx: (Math.random()-0.5)*1.5, vy: (Math.random()-0.5)*0.8,
          life: 1, decay: 0,
          size: 14+Math.random()*18,
          type: types[Math.floor(Math.random()*types.length)],
          flap: Math.random()*Math.PI*2, flapSpeed: 0.08+Math.random()*0.08,
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.02+Math.random()*0.02
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.6;
        ctx.translate(p.x,p.y);
        var s=p.size;
        if (p.type==='bat') {
          var flap=Math.sin(p.flap)*0.5;
          ctx.fillStyle='#1a0a2e';
          ctx.beginPath(); ctx.ellipse(0,0,s*0.3,s*0.2,0,0,Math.PI*2); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(0,-s*0.1);
          ctx.bezierCurveTo(-s*0.3,-s*(0.5+flap),-s*0.8,-s*(0.2+flap),-s*0.9,s*0.1);
          ctx.bezierCurveTo(-s*0.6,s*0.3,-s*0.3,s*0.1,0,s*0.1);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(0,-s*0.1);
          ctx.bezierCurveTo(s*0.3,-s*(0.5+flap),s*0.8,-s*(0.2+flap),s*0.9,s*0.1);
          ctx.bezierCurveTo(s*0.6,s*0.3,s*0.3,s*0.1,0,s*0.1);
          ctx.fill();
          ctx.fillStyle='#FF6B00';
          ctx.beginPath(); ctx.arc(-s*0.1,-s*0.05,s*0.05,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(s*0.1,-s*0.05,s*0.05,0,Math.PI*2); ctx.fill();
        } else if (p.type==='ghost') {
          ctx.fillStyle='rgba(220,220,255,0.85)';
          ctx.beginPath();
          ctx.arc(0,-s*0.2,s*0.5,Math.PI,0);
          ctx.lineTo(s*0.5,s*0.4);
          ctx.bezierCurveTo(s*0.3,s*0.6,s*0.1,s*0.3,0,s*0.5);
          ctx.bezierCurveTo(-s*0.1,s*0.3,-s*0.3,s*0.6,-s*0.5,s*0.4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle='#1a0a2e';
          ctx.beginPath(); ctx.ellipse(-s*0.18,-s*0.15,s*0.09,s*0.12,0,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(s*0.18,-s*0.15,s*0.09,s*0.12,0,0,Math.PI*2); ctx.fill();
        } else {
          ctx.fillStyle='#FF6B00';
          ctx.beginPath(); ctx.arc(0,0,s*0.5,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#2D5016';
          ctx.fillRect(-s*0.08,-s*0.65,s*0.16,s*0.25);
          ctx.fillStyle='#1a0a2e';
          ctx.beginPath(); ctx.moveTo(-s*0.3,-s*0.1); ctx.lineTo(-s*0.1,-s*0.2); ctx.lineTo(-s*0.1,s*0.0); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(s*0.3,-s*0.1); ctx.lineTo(s*0.1,-s*0.2); ctx.lineTo(s*0.1,s*0.0); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.arc(0,s*0.15,s*0.25,0.2,Math.PI-0.2); ctx.stroke();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.flap+=p.flapSpeed; p.wobble+=p.wobbleSpeed;
        p.x+=p.vx+Math.sin(p.wobble)*0.3; p.y+=p.vy+Math.cos(p.wobble*0.7)*0.2;
        if (p.x<-40) p.x=W+40; if (p.x>W+40) p.x=-40;
        if (p.y<-40) p.y=H+40; if (p.y>H+40) p.y=-40;
      }
    },
    thanksgiving: {
      count: 25,
      make: function() {
        var cols=['#FA6700','#B45309','#92400E','#78350F','#FCD34D','#F59E0B','#DC2626'];
        return {
          x: -20, y: Math.random()*H*0.6,
          vx: 0.5+Math.random()*1.5, vy: 0.3+Math.random()*0.8,
          life: 1, decay: 0,
          size: 10+Math.random()*18,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.05,
          skew: 0.5+Math.random()*0.5
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.65;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        ctx.fillStyle=p.color;
        ctx.beginPath();
        ctx.moveTo(0,-s);
        ctx.bezierCurveTo(s*p.skew,-s*0.5,s*p.skew,s*0.5,0,s);
        ctx.bezierCurveTo(-s*p.skew,s*0.5,-s*p.skew,-s*0.5,0,-s);
        ctx.fill();
        ctx.strokeStyle=p.color; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,s); ctx.lineTo(0,s*1.4); ctx.stroke();
        ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=0.8;
        ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(0,s); ctx.stroke();
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy+Math.sin(p.rot)*0.3;
        if (p.x>W+30) { p.x=-20; p.y=Math.random()*H*0.6; }
        if (p.y>H+30) { p.y=-20; }
      }
    },
    easter: {
      count: 35,
      make: function() {
        var cols=['#FFD1DC','#B5EAD7','#FFDAC1','#C7CEEA','#FFB7B2','#E2F0CB','#F8C8D4'];
        return {
          x: Math.random()*W, y: -20,
          vx: (Math.random()-0.5)*1.2, vy: 0.6+Math.random()*1.2,
          life: 1, decay: 0,
          size: 10+Math.random()*14,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.04,
          type: Math.random()<0.6?'egg':'flower'
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.7;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if (p.type==='egg') {
          ctx.fillStyle=p.color;
          ctx.beginPath();
          ctx.ellipse(0,0,s*0.55,s*0.75,0,0,Math.PI*2);
          ctx.fill();
          ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.moveTo(-s*0.4,0); ctx.lineTo(s*0.4,0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0,-s*0.5); ctx.lineTo(0,s*0.5); ctx.stroke();
        } else {
          for(var i=0;i<5;i++){
            ctx.fillStyle=p.color;
            ctx.save(); ctx.rotate(i*Math.PI*2/5);
            ctx.beginPath(); ctx.ellipse(0,-s*0.45,s*0.22,s*0.45,0,0,Math.PI*2); ctx.fill(); ctx.restore();
          }
          ctx.fillStyle='#FFD700';
          ctx.beginPath(); ctx.arc(0,0,s*0.22,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-20;p.x=Math.random()*W;}
      }
    },
    memorialday: {
      count: 50,
      make: function() {
        var cols=['#B22234','#FFFFFF','#3C3B6E'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.8, vy: 0.8+Math.random()*1.5,
          life: 1, decay: 0,
          size: 5+Math.random()*9,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.05,
          type: Math.random()<0.6?'star':'rect'
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.7;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if(p.type==='star'){
          ctx.beginPath();
          for(var i=0;i<5;i++){
            var a=(i*4*Math.PI/5)-Math.PI/2;
            var b=a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);
            ctx.lineTo(Math.cos(b)*s*0.4,Math.sin(b)*s*0.4);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillRect(-s/2,-s*0.3,s,s*0.6);
        }
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
      }
    },
    laborday: {
      count: 50,
      make: function() {
        var cols=['#B22234','#FFFFFF','#3C3B6E'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.8, vy: 0.8+Math.random()*1.5,
          life: 1, decay: 0,
          size: 5+Math.random()*9,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.05,
          type: Math.random()<0.6?'star':'rect'
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.7;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if(p.type==='star'){
          ctx.beginPath();
          for(var i=0;i<5;i++){
            var a=(i*4*Math.PI/5)-Math.PI/2;
            var b=a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);
            ctx.lineTo(Math.cos(b)*s*0.4,Math.sin(b)*s*0.4);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillRect(-s/2,-s*0.3,s,s*0.6);
        }
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
      }
    },
    mothersday: {
      count: 30,
      make: function() {
        var cols=['#FF69B4','#DDA0DD','#FFB6C1','#EE82EE','#FF1493','#FFC0CB'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.8, vy: 0.5+Math.random()*1.0,
          life: 1, decay: 0,
          size: 10+Math.random()*14,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.03,
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.02+Math.random()*0.02
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.7;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        for(var i=0;i<5;i++){
          ctx.save(); ctx.rotate(i*Math.PI*2/5);
          ctx.beginPath(); ctx.ellipse(0,-s*0.5,s*0.25,s*0.5,0,0,Math.PI*2); ctx.fill(); ctx.restore();
        }
        ctx.fillStyle='#FFD700';
        ctx.beginPath(); ctx.arc(0,0,s*0.2,0,Math.PI*2); ctx.fill();
        ctx.restore();
      },
      tick: function(p) {
        p.wobble+=p.wobbleSpeed; p.rot+=p.rotSpeed;
        p.x+=p.vx+Math.sin(p.wobble)*0.5; p.y+=p.vy;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
      }
    },
    fathersday: {
      count: 25,
      make: function() {
        var cols=['#1B3A6B','#2563EB','#C8A951','#1E3A5F','#3B82F6'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.6, vy: 0.6+Math.random()*1.0,
          life: 1, decay: 0,
          size: 10+Math.random()*16,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.03,
          stripeColor: cols[Math.floor(Math.random()*cols.length)]
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.65;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        // Tie shape
        ctx.fillStyle=p.color;
        ctx.beginPath();
        ctx.moveTo(0,-s); ctx.lineTo(s*0.35,-s*0.2);
        ctx.lineTo(s*0.5,s*0.6); ctx.lineTo(0,s);
        ctx.lineTo(-s*0.5,s*0.6); ctx.lineTo(-s*0.35,-s*0.2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle=p.stripeColor;
        ctx.globalAlpha=0.3;
        ctx.fillRect(-s*0.4,-s*0.1,s*0.8,s*0.18);
        ctx.fillRect(-s*0.4,s*0.2,s*0.8,s*0.18);
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
      }
    },
    hotsummer: {
      count: 78,
      make: function(i) {
        // First 48 particles = 12 flame tongues anchored in each of the 4 corners.
        // Remaining particles = rising embers/heat drifting up the page.
        if (i !== undefined && i < 48) {
          var corner = Math.floor(i/12);            // 0=TL,1=TR,2=BL,3=BR
          return {
            type:'corner', corner:corner,
            jx: (Math.random()-0.5)*46,             // jitter within the corner cluster
            jy: (Math.random()-0.5)*46,
            size: 16+Math.random()*22,
            life: 1, decay: 0,
            phase: Math.random()*Math.PI*2,
            flick: 0.12+Math.random()*0.18,        // flicker speed
            sway: Math.random()*Math.PI*2,
            swaySpeed: 0.03+Math.random()*0.05
          };
        }
        var types=['flame','flame','sun','heat'];
        return {
          x: Math.random()*W, y: H+20,
          vx: (Math.random()-0.5)*1.5, vy: -(0.8+Math.random()*2.0),
          life: 0.8+Math.random()*0.2, decay: 0.008+Math.random()*0.008,
          size: 8+Math.random()*16,
          type: types[Math.floor(Math.random()*types.length)],
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.04+Math.random()*0.06,
          hue: 10+Math.random()*40
        };
      },
      drawFlame: function(s, alpha, squish) {
        // a single upward-pointing flame tongue, origin at its base (0,0)
        ctx.globalAlpha = alpha;
        var grad=ctx.createRadialGradient(0,-s*0.2,0,0,-s*0.3,s);
        grad.addColorStop(0,'#FFFFFF');
        grad.addColorStop(0.25,'#FFD700');
        grad.addColorStop(0.6,'#FF6600');
        grad.addColorStop(1,'rgba(220,0,0,0)');
        ctx.fillStyle=grad;
        var w = s*0.6*squish;
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.bezierCurveTo(-w,-s*0.4,-w*0.9,-s*1.0,-s*0.12,-s*1.5);
        ctx.bezierCurveTo(0,-s*1.1,0,-s*1.1,s*0.12,-s*1.5);
        ctx.bezierCurveTo(w*0.9,-s*1.0,w,-s*0.4,0,0);
        ctx.fill();
      },
      draw: function(p) {
        ctx.save();
        if(p.type==='corner'){
          var margin = 26;
          var cx = (p.corner===1||p.corner===3) ? W-margin : margin;
          var cy = (p.corner>=2)                ? H-margin : margin;
          ctx.translate(cx + p.jx, cy + p.jy);
          // flames always point "up" toward page interior-ish; tongues lean with sway
          var lean = Math.sin(p.sway)*0.25;
          ctx.rotate(lean);
          // flicker: size + brightness pulse
          var fl = 0.78 + Math.sin(p.phase)*0.22;
          var glow = ctx.createRadialGradient(0,-p.size*0.4,0,0,-p.size*0.4,p.size*1.4);
          glow.addColorStop(0,'rgba(255,120,0,0.18)');
          glow.addColorStop(1,'rgba(255,120,0,0)');
          ctx.fillStyle=glow;
          ctx.beginPath(); ctx.arc(0,-p.size*0.4,p.size*1.4,0,Math.PI*2); ctx.fill();
          this.drawFlame(p.size*fl, 0.78, 1+Math.sin(p.phase*1.7)*0.12);
          // inner brighter core
          ctx.fillStyle='rgba(255,235,150,0.85)';
          this.drawFlame(p.size*fl*0.5, 0.6, 1);
          ctx.restore();
          return;
        }
        ctx.globalAlpha=p.life*0.7;
        ctx.translate(p.x,p.y);
        var s=p.size;
        if(p.type==='flame'){
          var grad=ctx.createRadialGradient(0,s*0.3,0,0,0,s);
          grad.addColorStop(0,'#FFFFFF');
          grad.addColorStop(0.2,'#FFD700');
          grad.addColorStop(0.5,'#FF6600');
          grad.addColorStop(1,'rgba(220,0,0,0)');
          ctx.fillStyle=grad;
          ctx.beginPath();
          ctx.moveTo(0,s);
          ctx.bezierCurveTo(-s*0.6,s*0.4,-s*0.8,-s*0.2,-s*0.1,-s);
          ctx.bezierCurveTo(0,-s*0.6,0,-s*0.6,s*0.1,-s);
          ctx.bezierCurveTo(s*0.8,-s*0.2,s*0.6,s*0.4,0,s);
          ctx.fill();
        } else if(p.type==='sun'){
          ctx.fillStyle='rgba(255,220,0,0.9)';
          ctx.beginPath(); ctx.arc(0,0,s*0.5,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='rgba(255,160,0,0.7)'; ctx.lineWidth=s*0.15;
          for(var i=0;i<8;i++){
            ctx.save(); ctx.rotate(i*Math.PI/4);
            ctx.beginPath(); ctx.moveTo(0,s*0.6); ctx.lineTo(0,s*1.1); ctx.stroke();
            ctx.restore();
          }
        } else {
          // Heat shimmer wavy line
          ctx.strokeStyle='rgba(255,120,0,0.5)';
          ctx.lineWidth=2;
          ctx.beginPath();
          for(var j=0;j<6;j++){
            var x=( j-3)*s*0.25;
            var y=Math.sin(j*1.2+p.wobble)*s*0.3;
            j===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
          }
          ctx.stroke();
        }
        ctx.restore();
      },
      tick: function(p) {
        if(p.type==='corner'){
          p.phase += p.flick;
          p.sway  += p.swaySpeed;
          return;                         // anchored — never recycled
        }
        p.wobble+=p.wobbleSpeed;
        p.x+=p.vx+Math.sin(p.wobble)*0.8;
        p.y+=p.vy;
        p.life-=p.decay;
        if(p.life<=0||p.y<-p.size){
          p.y=H+20; p.x=Math.random()*W;
          p.life=0.8+Math.random()*0.2;
          p.vy=-(0.8+Math.random()*2.0);
        }
      }
    },
    backtoschool: {
      count: 30,
      make: function() {
        var types=['pencil','star','apple'];
        var cols=['#FF6B6B','#4ECDC4','#FFE66D','#A8E6CF','#FF8B94'];
        return {
          x: Math.random()*W, y: -20,
          vx: (Math.random()-0.5)*1.0, vy: 0.7+Math.random()*1.2,
          life: 1, decay: 0,
          size: 10+Math.random()*14,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.04,
          type: types[Math.floor(Math.random()*types.length)]
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.72;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if(p.type==='pencil'){
          ctx.fillStyle='#FFD700';
          ctx.fillRect(-s*0.15,-s,s*0.3,s*1.6);
          ctx.fillStyle='#FFB347';
          ctx.fillRect(-s*0.15,s*0.5,s*0.3,s*0.2);
          ctx.fillStyle='#FF6B6B';
          ctx.beginPath(); ctx.moveTo(-s*0.15,s*0.7); ctx.lineTo(s*0.15,s*0.7); ctx.lineTo(0,s); ctx.closePath(); ctx.fill();
          ctx.fillStyle='#333';
          ctx.beginPath(); ctx.arc(0,s*0.9,s*0.06,0,Math.PI*2); ctx.fill();
        } else if(p.type==='star'){
          ctx.fillStyle=p.color;
          ctx.beginPath();
          for(var i=0;i<5;i++){
            var a=(i*4*Math.PI/5)-Math.PI/2;
            var b=a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);
            ctx.lineTo(Math.cos(b)*s*0.4,Math.sin(b)*s*0.4);
          }
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillStyle='#FF6B6B';
          ctx.beginPath(); ctx.arc(0,s*0.1,s*0.7,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#8B4513';
          ctx.fillRect(-s*0.08,-s*0.7,s*0.16,s*0.5);
          ctx.fillStyle='#2D8A2D';
          ctx.beginPath(); ctx.ellipse(s*0.2,-s*0.65,s*0.3,s*0.18,-0.5,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-20;p.x=Math.random()*W;}
      }
    },
    fall: {
      count: 35,
      make: function() {
        var cols=['#D2691E','#CD853F','#A0522D','#8B4513','#DAA520','#B8860B','#FF8C00','#DC143C'];
        return {
          x: Math.random()*W, y: -20,
          vx: (Math.random()-0.5)*1.5, vy: 0.5+Math.random()*1.0,
          life: 1, decay: 0,
          size: 8+Math.random()*16,
          color: cols[Math.floor(Math.random()*cols.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.06,
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.02+Math.random()*0.02,
          skew: 0.5+Math.random()*0.5
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.75;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        // Leaf shape
        ctx.beginPath();
        ctx.moveTo(0,-s);
        ctx.bezierCurveTo(s*p.skew,-s*0.5,s*p.skew,s*0.4,0,s*0.8);
        ctx.bezierCurveTo(-s*p.skew,s*0.4,-s*p.skew,-s*0.5,0,-s);
        ctx.fill();
        ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=0.8;
        ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(0,s*0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,-s*0.2); ctx.lineTo(s*0.35,s*0.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,-s*0.2); ctx.lineTo(-s*0.35,s*0.1); ctx.stroke();
        ctx.restore();
      },
      tick: function(p) {
        p.wobble+=p.wobbleSpeed; p.rot+=p.rotSpeed;
        p.x+=p.vx+Math.sin(p.wobble)*1.2; p.y+=p.vy;
        if(p.y>H+20){p.y=-20;p.x=Math.random()*W;}
      }
    },
    veteransday: {
      count: 55,
      make: function() {
        var cols=['#B22234','#FFFFFF','#3C3B6E','#B22234','#FFFFFF'];
        var types=['star','star','star','ribbon','ribbon'];
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.8, vy: 0.6+Math.random()*1.2,
          life: 1, decay: 0,
          size: 5+Math.random()*10,
          color: cols[Math.floor(Math.random()*cols.length)],
          type: types[Math.floor(Math.random()*types.length)],
          rot: Math.random()*Math.PI*2, rotSpeed: (Math.random()-0.5)*0.04
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=0.75;
        ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if(p.type==='star'){
          ctx.beginPath();
          for(var i=0;i<5;i++){
            var a=(i*4*Math.PI/5)-Math.PI/2;
            var b=a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);
            ctx.lineTo(Math.cos(b)*s*0.4,Math.sin(b)*s*0.4);
          }
          ctx.closePath(); ctx.fill();
        } else {
          // Medal ribbon
          ctx.fillStyle='#B22234';
          ctx.fillRect(-s*0.25,-s,s*0.5,s*0.6);
          ctx.fillStyle='#3C3B6E';
          ctx.fillRect(-s*0.25,-s*0.5,s*0.5,s*0.25);
          ctx.fillStyle='#DAA520';
          ctx.beginPath(); ctx.arc(0,s*0.25,s*0.38,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#C8960C';
          ctx.beginPath(); ctx.arc(0,s*0.25,s*0.25,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#FFD700';
          ctx.font = (s*0.28)+'px serif';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText('★',0,s*0.25);
        }
        ctx.restore();
      },
      tick: function(p) {
        p.rot+=p.rotSpeed; p.x+=p.vx; p.y+=p.vy;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
      }
    },
    christmas: {
      count: 55,
      make: function() {
        return {
          x: Math.random()*W, y: -10,
          vx: (Math.random()-0.5)*0.8, vy: 0.8+Math.random()*1.5,
          life: 1, decay: 0,
          size: 4+Math.random()*8,
          opacity: 0.4+Math.random()*0.6,
          wobble: Math.random()*Math.PI*2, wobbleSpeed: 0.015+Math.random()*0.025,
          type: Math.random()<0.7?'snowflake':'star',
          rot: 0, rotSpeed: (Math.random()-0.5)*0.03,
          color: Math.random()<0.5?'#ffffff':'#e8f4fd'
        };
      },
      draw: function(p) {
        ctx.save(); ctx.globalAlpha=p.opacity;
        ctx.strokeStyle=p.color; ctx.fillStyle=p.color;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        var s=p.size;
        if (p.type==='snowflake') {
          ctx.lineWidth=1.2;
          for (var i=0;i<6;i++) {
            ctx.save(); ctx.rotate(i*Math.PI/3);
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,s); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,s*0.4); ctx.lineTo(s*0.2,s*0.6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,s*0.4); ctx.lineTo(-s*0.2,s*0.6); ctx.stroke();
            ctx.restore();
          }
        } else {
          ctx.fillStyle='#FFD700';
          ctx.beginPath();
          for (var j=0;j<5;j++) {
            var a=(j*4*Math.PI/5)-Math.PI/2;
            var b=a+2*Math.PI/10;
            ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);
            ctx.lineTo(Math.cos(b)*s*0.4,Math.sin(b)*s*0.4);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      },
      tick: function(p) {
        p.wobble+=p.wobbleSpeed; p.rot+=p.rotSpeed;
        p.x+=p.vx+Math.sin(p.wobble)*0.6; p.y+=p.vy;
        if (p.y>H+20) { p.y=-10; p.x=Math.random()*W; }
      }
    }
  };

  var cfg = configs[theme];
  if (!cfg) return;

  for (var i=0;i<cfg.count;i++) particles.push(cfg.make(i));

  function loop() {
    if (isDead()) { cancelAnimationFrame(animId); document.removeEventListener('visibilitychange', onVis); window._seasonalPauseAnimation = window._seasonalResumeAnimation = null; return; }
    // Paused during a capture/PDF: display:none does NOT stop requestAnimationFrame,
    // so the particles would keep competing with the renderer for the main thread.
    if (canvas._seasonalPaused) return;
    ctx.clearRect(0,0,W,H);
    particles.forEach(function(p) { cfg.tick(p); cfg.draw(p); });
    animId = requestAnimationFrame(loop);
  }
  canvas._seasonalPaused = false;
  window._seasonalPauseAnimation = function() {
    canvas._seasonalPaused = true;
    if (animId) cancelAnimationFrame(animId);
  };
  window._seasonalResumeAnimation = function() {
    if (canvas._seasonalPaused) {
      canvas._seasonalPaused = false;
      resize(); // re-measure the real viewport — a capture can temporarily widen the page
      loop();
    }
  };
  loop();

  function onVis() {
    if (isDead()) { cancelAnimationFrame(animId); document.removeEventListener('visibilitychange', onVis); return; }
    if (document.hidden) { cancelAnimationFrame(animId); }
    else if (!canvas._seasonalPaused) { cancelAnimationFrame(animId); loop(); }
  }
  document.addEventListener('visibilitychange', onVis);
}
