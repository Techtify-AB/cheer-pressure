// Dot — wellbeing companion (soft or shaggy fur). Requires three.js r160+ resolvable as 'three'.
//   import { createCompanion } from './companion.js';
//   const dot = createCompanion(containerEl, { mood: 'idle', color: 'peach' });
//   dot.setMood('joy'); dot.setFur('shaggy'); dot.setColor('mint'); dot.setColor('#ffd0e0'); dot.destroy();
import * as THREE from 'three';

export const COLORS = { peach:'#ffc2ad', butter:'#ffe3a1', mint:'#b5e6d3', sky:'#b9d9f7', lilac:'#d6c6f5', offwhite:'#f6f1e7' };
const BASE = { tilt:0, lean:0, y:0, sq:1, lx:0, ly:0, es:1, et:0 };
const STATES = {
  idle:      { eye:'open',  aura:'still', c:'#d8c4aa', p:{} },
  speaking:  { eye:'open',  aura:'out',   c:'#d9a48e', p:{} },
  listening: { eye:'open',  aura:'in',    c:'#9bb7c9', p:{ tilt:.15, lean:.08, es:1.12 } },
  thinking:  { eye:'open',  aura:'pulse', c:'#aaa3c4', p:{ tilt:-.1, lx:.7, ly:.8 } },
  attention: { eye:'open',  aura:'pulse', c:'#dcb872', p:{ lean:.12, es:1.08 } },
  joy:       { eye:'happy', aura:'pulse', c:'#e0c47a', p:{ lean:-.06 } },
  concern:   { eye:'open',  aura:'still', c:'#9db7d8', p:{ tilt:.1, lean:.15, es:.92, et:.38, ly:-.3 } },
  sleeping:  { eye:'sleep', aura:'still', c:'#8f93c9', p:{ tilt:.12, lean:.1, sq:.9 } },
  celebrate: { eye:'happy', aura:'out',   c:'#d6a39c', p:{ lean:-.08 } },
};
export const MOODS = Object.keys(STATES);
const ALIAS = { celebrating:'celebrate', empathy:'concern', sleep:'sleeping', happy:'joy', talk:'speaking', listen:'listening', think:'thinking', wantingattention:'attention' };
const FURS = {
  soft:   { S:64, seed:11, pow:.75, RU:5, N:22, len:.17, lean:2.6, swirl:1, droop:.9, dark:.78, light:1.04, cPow:1, taper:1, tip:.9, eyeOut:.15 },
  shaggy: { S:96, seed:5, pow:1.1, RU:3, N:72, len:.42, lean:9, swirl:1.6, droop:1.2, dark:.8, light:1.14, cPow:1.1, taper:.9, tip:.93, map:.86, fall:true, hang:.3, cutZ:1.17, cuts:[[.3,.12,.15,.2],[-.3,.12,.15,.2],[0,-.05,.12,.07]], eyeOut:.22 },
};
const DIMS = { top:2.0, side:1.15, foot:1.25 };

const resolveColor = (c) => COLORS[String(c).toLowerCase().replace(/[^a-z]/g, '')] || c;
const resolveMood = (m) => { const k = String(m).toLowerCase().replace(/[^a-z]/g, ''); return STATES[k] ? k : ALIAS[k]; };

function buildRig(color) {
  const M = (name, col, o={}) => { const m = new THREE.MeshStandardMaterial({ color:col, roughness:1, metalness:0, ...o }); m.name = name; return m; };
  const mat = {
    body: Object.assign(new THREE.MeshPhysicalMaterial({ color, roughness:1, metalness:0, sheen:1, sheenRoughness:.55, sheenColor:'#fff6ea' }), { name:'body' }),
    eye: M('eye', '#2a2220'), mist: M('mist', '#ffffff', { roughness:.9 }),
    s1: M('spark_sun', '#f5cc66', { roughness:.5 }), s2: M('spark_rose', '#f3a7b6', { roughness:.5 }), s3: M('spark_sky', '#98c6ec', { roughness:.5 }),
  };
  const sphG = new THREE.SphereGeometry(1, 48, 32);
  const sph = (name, m, r, s=[1,1,1], p=[0,0,0]) => { const o = new THREE.Mesh(sphG, m); o.name = name; o.scale.set(r*s[0], r*s[1], r*s[2]); o.position.set(...p); return o; };
  const root = new THREE.Group(); root.name = 'companion_dot';
  const bob = new THREE.Group(); bob.name = 'bob'; root.add(bob);
  const head = new THREE.Group(); head.name = 'head'; head.position.y = .25; bob.add(head);
  const inHead = (o) => { o.position.y -= head.position.y; head.add(o); return o; };
  inHead(sph('body', mat.body, 1, [1.04,.96,1], [0,.98,0]));

  // Shell fur: stacked alpha-tested layers over the body. Built on demand per style.
  const furMats = [], furs = {};
  const makeFur = (name, col) => {
    const o = FURS[name], grp = new THREE.Group(); grp.name = 'fur_' + name;
    const S = o.S, cv = document.createElement('canvas'); cv.width = cv.height = S; const cx = cv.getContext('2d'), im = cx.createImageData(S, S);
    let seed = o.seed; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i = 0; i < S*S; i++) { const v = Math.pow(rnd(), o.pow)*255; im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = v; im.data[i*4+3] = 255; }
    cx.putImageData(im, 0, 0);
    let cmap = null; if (o.map) { const c2 = document.createElement('canvas'); c2.width = c2.height = S; const x2 = c2.getContext('2d'), i2 = x2.createImageData(S, S);
      for (let i = 0; i < S*S; i++) { const v = 255*(o.map + (1-o.map)*rnd()); i2.data[i*4] = i2.data[i*4+1] = i2.data[i*4+2] = v; i2.data[i*4+3] = 255; }
      x2.putImageData(i2, 0, 0); cmap = new THREE.CanvasTexture(c2); cmap.wrapS = cmap.wrapT = THREE.RepeatWrapping; cmap.repeat.set(o.RU, o.RU/2); cmap.colorSpace = THREE.SRGBColorSpace; }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.repeat.set(o.RU, o.RU/2);
    const baseG = new THREE.SphereGeometry(1, 72, 48), bp = baseG.attributes.position, bu = baseG.attributes.uv;
    for (let s = 0; s < o.N; s++) {
      const hh = (s+1)/o.N, g = baseG.clone(), uv = g.attributes.uv, k = hh*hh*o.lean, q = o.swirl;
      for (let i = 0; i < uv.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), st = Math.sqrt(Math.max(0, 1-y*y));
        const du = o.fall ? (.3*(Math.sin(3.1*q*y+1.3) + Math.cos(2.3*q*z)) + .25*Math.sin(2.9*q*x+2.1)) / Math.max(st, .35) : Math.sin(3.1*q*y+1.3) + Math.cos(2.3*q*z) + Math.sin(2.9*q*x+2.1);
        const dv = o.fall ? o.droop*(.2 + .8*st)*(1 + .2*Math.sin(2.7*q*z+.7)) : o.droop + .8*Math.cos(3.3*q*x) + .8*Math.sin(2.7*q*z+.7);
        uv.setXY(i, bu.getX(i) + du*k/(S*o.RU), bu.getY(i) + dv*k/(S*o.RU/2)); }
      const f = o.dark + (o.light-o.dark)*Math.pow(hh, o.cPow), m = new THREE.MeshStandardMaterial({ color:new THREE.Color(col).multiplyScalar(f), roughness:1, metalness:0, map:cmap, alphaMap:tex, alphaTest:.04 + Math.pow(hh, o.taper)*o.tip });
      m.name = grp.name + '_' + (s+1); m.userData.f = f; furMats.push(m);
      const sh = new THREE.Mesh(g, m); sh.name = grp.name + '_shell_' + (s+1); const e = 1 + hh*o.len, gp = g.attributes.position;
      for (let i = 0; i < gp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), w = Math.pow(Math.min(1, Math.max(0, (.1-y)/.8)), 1.5);
        gp.setXYZ(i, x*1.04*e, y*.96*e - (o.hang || 0)*hh*w, z*e); }
      if (o.cuts) { const ix = g.index.array, out = [];
        for (let t = 0; t < ix.length; t += 3) { const a = ix[t], b = ix[t+1], c = ix[t+2];
          const px = (gp.getX(a)+gp.getX(b)+gp.getX(c))/3, py = (gp.getY(a)+gp.getY(b)+gp.getY(c))/3, pz = (gp.getZ(a)+gp.getZ(b)+gp.getZ(c))/3;
          const g0 = o.cutZ - .06, tt = 1 + .7*Math.min(1, Math.max(0, (pz-g0)/.3));
          if (pz > g0 && o.cuts.some(c2 => ((px-c2[0])/(c2[2]*tt))**2 + ((py-c2[1])/(c2[3]*tt))**2 < 1)) continue; out.push(a, b, c); }
        g.setIndex(out); }
      grp.add(sh);
    }
    grp.position.set(0,.98,0); inHead(grp); return grp;
  };
  const setFur = (name, col) => { if (name !== 'smooth' && !furs[name]) furs[name] = makeFur(name, col);
    for (const k in furs) furs[k].visible = k === name; const off = name === 'smooth' ? 0 : FURS[name].eyeOut;
    for (const e of eyes) e.base.z = .95 + off; mouth.position.z = .985 + off; };

  const eyeAt = [.3, 1.1, .95], arcG = new THREE.TorusGeometry(.12, .03, 12, 28, Math.PI);
  const eyes = [-1,1].map(s => {
    const n = s<0?'l':'r', g = new THREE.Group(); g.name = 'eye_'+n; g.position.set(s*eyeAt[0], eyeAt[1], eyeAt[2]); g.rotation.y = s*Math.atan2(eyeAt[0], eyeAt[2])*.8; inHead(g);
    const open = new THREE.Group(); open.name = 'eye_open_'+n; open.add(sph('pupil_'+n, mat.eye, .12, [1,1.4,.35]));
    const arc = new THREE.Mesh(arcG, mat.eye); arc.name = 'eye_arc_'+n;
    return { g, open, arc, s, base:g.position.clone() };
  });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(.075, .024, 10, 24, Math.PI), mat.eye); mouth.name = 'mouth'; mouth.rotation.set(.1, 0, Math.PI); mouth.position.set(0, .93, .985); inHead(mouth); head.remove(mouth);

  const ringG = new THREE.RingGeometry(1, 1.07, 72);
  const rings = [0,1,2].map(i => {
    const m = M('aura_'+(i+1), '#e6c9a8', { transparent:true, opacity:.4, emissive:'#e6c9a8', emissiveIntensity:.6, depthWrite:false, side:THREE.DoubleSide });
    const r = new THREE.Mesh(ringG, m); r.name = m.name; r.rotation.x = -Math.PI/2; r.position.y = .04 + i*.004; r.renderOrder = 2; root.add(r); return r;
  });
  const props = new THREE.Group(); props.name = 'props'; root.add(props);
  return { setFur, root, bob, head, eyes, mouth, rings, props, mat, furMats, sph, sphG, cur:{...BASE}, tgt:{...BASE}, state:'idle', blink:2 };
}

function applyMood(rig, key) {
  const S = STATES[key], d = DIMS, { props, mat, sph } = rig; rig.state = key; rig.tgt = { ...BASE, ...S.p };
  for (const e of rig.eyes) { e.g.clear();
    if (S.eye === 'open') e.g.add(e.open); else { e.arc.rotation.z = S.eye === 'sleep' ? Math.PI : 0; e.arc.position.y = S.eye === 'sleep' ? .03 : -.04; e.g.add(e.arc); } }
  if (key === 'celebrate') rig.head.add(rig.mouth); else rig.head.remove(rig.mouth);
  const col = new THREE.Color(S.c); rig.rings.forEach(r => { r.material.color.copy(col); r.material.emissive.copy(col); });
  props.traverse(o => { if (o.geometry && o.geometry !== rig.sphG) o.geometry.dispose(); }); props.clear();
  if (key === 'thinking') { const cx = d.side*.75 + .65, cy = d.top + .45; props.add(sph('thought_dot', mat.mist, .1, [1,1,1], [d.side*.75+.05, d.top+.02, 0]));
    const base = new THREE.Mesh(new THREE.CapsuleGeometry(.21, .6, 12, 32), mat.mist); base.name = 'thought_cloud_base'; base.rotation.z = Math.PI/2; base.scale.z = .8; base.position.set(cx, cy, 0); props.add(base);
    [[-.1,.1,.24],[.22,.06,.19]].forEach((p,i) => props.add(sph('thought_cloud_'+(i+1), mat.mist, p[2], [1,1,.8], [cx+p[0], cy+p[1], 0]))); }
  if (key === 'sleeping') for (let i=0;i<3;i++) props.add(sph('sleep_'+(i+1), mat.mist, .11-i*.025, [1,1,1], [d.side*.6+i*.22, d.top+i*.3, 0]));
  if (key === 'joy') [[-1.8,1.85,.2],[1.85,1.6,.17],[1.45,2.55,.12],[-1.3,2.6,.1]].forEach((p,i) => { const g = new THREE.Group(); g.name = 'sparkle_'+(i+1); g.position.set(p[0], p[1], .2);
    g.add(sph(g.name+'_h', mat.s1, p[2], [1,.24,.24]), sph(g.name+'_v', mat.s1, p[2], [.24,1,.24])); props.add(g); });
  if (key === 'attention') [.6,.95,1.3].forEach((a,j) => { const o = sph('ping_'+(j+1), mat.body, j === 1 ? .13 : .1, [.26,1,.26], [Math.cos(a)*1.85, 1.0+Math.sin(a)*1.85, .2]); o.rotation.z = a - Math.PI/2; props.add(o); });
  if (key === 'celebrate') { const cg = new THREE.CylinderGeometry(.08, .08, .014, 14), fr = (n) => { const v = Math.sin(n*12.9898)*43758.5453; return v - Math.floor(v); };
    for (let i=0;i<20;i++) { const o = new THREE.Mesh(cg, [mat.s1,mat.s2,mat.s3][i%3]); o.name = 'confetti_'+(i+1); o.scale.setScalar(0);
      o.userData.c = { a:2.85 + i/20*3.7 + fr(i)*.2, r:1.7+fr(i+7)*.7, ph:fr(i+13), sp:.8+fr(i+21)*.4, pk:2.7+fr(i+33)*.7 }; props.add(o); } }
  props.children.forEach(o => { o.userData.p0 = o.position.clone(); o.userData.s0 = o.scale.clone(); });
}

function animate(rig, t, dt) {
  const k = 1 - Math.exp(-dt*7), c = rig.cur, g = rig.tgt, s = rig.state;
  for (const key in c) c[key] += (g[key]-c[key])*k;
  let y = 0, sq = 1 + Math.sin(t*1.6)*.012, tilt = 0, lean = 0;
  if (s === 'speaking') { const v = (Math.sin(t*9)*.5+.5)*(Math.sin(t*2.3)*.4+.6); sq += v*.07; tilt = Math.sin(t*1.7)*.04; }
  if (s === 'listening') { tilt = Math.sin(t*1.1)*.03; lean = Math.sin(t*2.2)*.02; }
  if (s === 'thinking') tilt = Math.sin(t*.9)*.04;
  if (s === 'attention') { const j = Math.abs(Math.sin(t*3)); y += j*.14; sq += (j-.5)*.05; tilt = Math.sin(t*3)*.08; }
  if (s === 'joy') { const j = Math.abs(Math.sin(t*3)); y += j*.12; sq += (j-.5)*.07; tilt = Math.sin(t*3)*.07; }
  if (s === 'concern') lean = Math.sin(t*1.2)*.02;
  if (s === 'sleeping') sq = 1 + Math.sin(t*.9)*.035;
  if (s === 'celebrate') { const j = Math.abs(Math.sin(t*2.8)); y += j*.38; sq += (j-.5)*.09; }
  sq *= c.sq;
  rig.bob.position.y = c.y + y; rig.bob.scale.set(1/Math.sqrt(sq), sq, 1/Math.sqrt(sq));
  rig.head.rotation.z = c.tilt + tilt; rig.head.rotation.x = c.lean + lean;
  rig.blink -= dt; if (rig.blink < -.13) rig.blink = 2.5 + Math.random()*3;
  const bl = rig.blink < 0 ? .12 : 1;
  const glance = s === 'idle' ? Math.max(0, Math.sin(t*.7)-.8)*4 : s === 'thinking' ? Math.sin(t*.8)*.3 - .15 : 0;
  for (const e of rig.eyes) {
    e.g.position.set(e.base.x + (c.lx+glance)*.07, e.base.y + c.ly*.06, e.base.z);
    e.open.scale.set(c.es, c.es*bl*(s === 'thinking' ? .86 : 1), 1); e.open.rotation.z = e.s*c.et;
  }
  const A = STATES[s].aura;
  rig.rings.forEach((r,i) => {
    let sc = 1.4, op = 0;
    if (A === 'still') { if (i===0) op = .35; }
    else if (A === 'pulse') { if (i===0) { sc = 1.4 + Math.sin(t*2.4)*.06; op = .35 + Math.sin(t*2.4)*.15; } }
    else { let p = (t*.45 + i/3) % 1; if (A === 'in') p = 1-p; sc = 1.15 + p*.9; op = (A === 'in' ? p : 1-p)*.55; }
    r.scale.setScalar(DIMS.foot*sc); r.material.opacity = op; r.visible = op > .01;
  });
  rig.props.children.forEach((o,i) => {
    const p0 = o.userData.p0, s0 = o.userData.s0;
    if (s === 'thinking') { if (i === 0) o.scale.copy(s0).multiplyScalar(.8 + .3*Math.max(0, Math.sin(t*2.4))); else o.position.y = p0.y + Math.sin(t*1.4)*.04; }
    if (s === 'sleeping') { const p = (t*.25 + i/3) % 1; o.position.set(p0.x + Math.sin(p*6)*.08, p0.y + p*.5 - .2, p0.z); o.scale.copy(s0).multiplyScalar(Math.sin(p*Math.PI)); }
    if (s === 'joy') { const p = (t*.6 + i*.27) % 1; o.scale.copy(s0).multiplyScalar(Math.sin(p*Math.PI)); o.position.y = p0.y + p*.25; o.rotation.z = (p-.5)*.7; }
    if (s === 'attention') { const p = (t*.7) % 1; o.scale.copy(s0).multiplyScalar(p < .6 ? .35 + .65*Math.abs(Math.sin(p/.6*Math.PI*2)) : .35); }
    if (s === 'celebrate') { const q = o.userData.c, p = (t*.3*q.sp + q.ph) % 1, up = Math.min(1, p/.22), out = 1 - Math.pow(1-up, 2), R = q.r*(.25 + .75*out);
      const yy = p < .22 ? 1.5 + (q.pk-1.5)*out : q.pk - (q.pk-.1)*(p-.22)/.78;
      o.position.set(Math.cos(q.a)*R + Math.sin(t*2.6+i)*.09*up, yy, Math.sin(q.a)*R);
      o.rotation.set(t*2.4+i, t*1.7+i*2, 0); o.scale.setScalar(Math.min(1, p/.06, (1-p)/.15)); }
  });
}

/**
 * @param {HTMLElement} container  element to fill (the canvas is transparent)
 * @param {{mood?:string, color?:string, fur?:'soft'|'shaggy'|'smooth', rings?:boolean, effects?:boolean, zoom?:number}} [opts]
 *   rings   – mood ring on the ground (default true)
 *   effects – thought cloud, sparkles, confetti… (default true)
 *   zoom    – 1 leaves room for every effect; ~1.6 frames just the dot (pair with effects:false)
 */
export function createCompanion(container, opts = {}) {
  const o = { mood:'idle', color:'peach', fur:'soft', rings:true, effects:true, zoom:1, ...opts };
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { width:'100%', height:'100%', display:'block' });
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 7, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e6, .5); fill.position.set(-5, 3, -4); scene.add(fill);
  const rig = buildRig(resolveColor(o.color)); scene.add(rig.root);
  let mood = resolveMood(o.mood) || 'idle', color = o.color, fur = FURS[o.fur] || o.fur === 'smooth' ? o.fur : 'soft';
  rig.setFur(fur, resolveColor(color));
  const sync = () => { rig.props.visible = o.effects; rig.rings.forEach(r => { r.material.visible = o.rings; }); };
  applyMood(rig, mood); rig.cur = { ...rig.tgt }; sync();

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false);
    camera.aspect = w/h; const hh = 2.2/o.zoom, hw = 2.75/o.zoom, d = Math.max(hh, hw/camera.aspect) / Math.tan(camera.fov*Math.PI/360);
    const cy = o.zoom > 1.3 ? 1.1 : 1.55; camera.position.set(0, cy + d*.16, d); camera.lookAt(0, cy, 0); camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  let raf = 0, last = performance.now(), t = 0, dead = false;
  const frame = (now) => { if (dead) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now-last)/1000); last = now; t += dt; animate(rig, t, dt); renderer.render(scene, camera); };
  raf = requestAnimationFrame(frame);

  return {
    moods: MOODS, colors: Object.keys(COLORS),
    getMood: () => mood, getColor: () => color,
    setMood(m) { const k = resolveMood(m); if (!k) { console.warn('[companion] unknown mood:', m); return false; } if (k !== mood) { mood = k; applyMood(rig, k); } return true; },
    setColor(c) { color = c; const v = resolveColor(c); rig.mat.body.color.set(v); rig.furMats.forEach(m => m.color.set(v).multiplyScalar(m.userData.f)); },
    furs: [...Object.keys(FURS), 'smooth'], getFur: () => fur,
    setFur(f) { f = String(f).toLowerCase(); if (!FURS[f] && f !== 'smooth') { console.warn('[companion] unknown fur:', f); return false; } fur = f; rig.setFur(f, resolveColor(color)); return true; },
    setOptions(p) { Object.assign(o, p); sync(); resize(); },
    destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); scene.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) { x.material.alphaMap && x.material.alphaMap.dispose(); x.material.dispose(); } }); renderer.dispose(); renderer.domElement.remove(); },
  };
}
