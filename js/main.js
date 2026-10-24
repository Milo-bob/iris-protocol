import './fog.js';
import * as THREE from 'three';
import { manager, loadGLB, loadProp } from './assets.js';
import { buildCity, districtAt, ZONES, eyeTexture } from './city.js';
import { buildTower } from './tower.js';
import { FX } from './fx.js';
import { NPCManager } from './npc.js';
import { Cutscene, pathShot, smooth } from './cutscene.js';
import { initAudio, sfx, announce, startMusic, setMood, setIntensity, duckMusic, toggleMusic } from './audio.js';
import { buildFloor, FLOORS, WALL_H } from './interior.js';
import { Boss, ARENA_R } from './boss.js';
import { buildTutorial } from './tutorial.js';

// ---------------------------------------------------------------------------
// The Iris Protocol, prototype M2: night city, prison start, over-the-shoulder camera,
// NPCs with eye-icon detection, melee combat, intro cutscene.
// ---------------------------------------------------------------------------

const FOG_COLOR = 0x2d0c0c, FOG_DENSITY = 0.034;
const $ = (id) => document.getElementById(id);
const stage = $('stage'), loadEl = $('loading'), barEl = $('bar'), startMsg = $('startmsg');
const fpsEl = $('fps'), shEl = $('sh'), pauseEl = $('pause');
const zoneEl = $('zone'), zoneName = $('zoneName'), zoneSub = $('zoneSub');
const hpFill = $('hpfill'), alarmFill = $('alarmfill'), alarmTxt = $('alarmtxt'), vignette = $('vignette'), deathEl = $('death');
const capEl = $('caption'), titleEl = $('titlecard'), barsEl = $('bars'), skipEl = $('skip');
const query = new URLSearchParams(location.search);

manager.itemStart('boot');
manager.onProgress = (url, loaded, total) => { barEl.style.width = Math.round(loaded / total * 100) + '%'; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.insertBefore(renderer.domElement, stage.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2500);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------- night sky ----------
let sky;
{
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#020104'); grad.addColorStop(0.3, '#0a0308'); grad.addColorStop(0.45, '#1c080a'); grad.addColorStop(0.5, '#2d0c0c'); grad.addColorStop(1, '#2d0c0c');
  g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const pts = [];
  for (let i = 0; i < 400; i++) { const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.3; pts.push(Math.cos(a) * Math.cos(e) * 1100, Math.sin(e) * 1100, Math.sin(a) * Math.cos(e) * 1100); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb0a0, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
  stars.renderOrder = -9; stars.frustumCulled = false; sky.add(stars);
}

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0x8a4254, 0x1a0608, 2.0); scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9a7090, 1.3);
moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const playerLight = new THREE.PointLight(0xffa878, 26, 18, 2); scene.add(playerLight);
const pool = [];
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 2); scene.add(l); pool.push(l); }

// ---------- world ----------
const P0 = {};
await Promise.all([
  loadProp('street_lamp_01').then((p) => (P0.lamp01 = p)),
  loadProp('street_lamp_02').then((p) => (P0.lamp02 = p)),
  loadProp('security_camera_01').then((p) => (P0.cam01 = p)),
  loadProp('security_camera_02').then((p) => (P0.cam02 = p)),
  loadProp('security_light').then((p) => (P0.secLight = p)),
  loadProp('concrete_road_barrier', { recenter: true }).then((p) => (P0.barrier = p)),
  loadProp('metal_trash_can', { names: ['metal_trash_can_handle_left'], recenter: true }).then((p) => (P0.trashClean = p)),
  loadProp('metal_trash_can', { names: ['metal_trash_can_rust'], recenter: true }).then((p) => (P0.trashRust = p)),
  loadProp('Barrel_01', { recenter: true }).then((p) => (P0.barrel = p)),
  loadProp('barrel_stove', { recenter: true }).then((p) => (P0.stove = p)),
  loadProp('exterior_aircon_unit', { names: ['exterior_aircon_unit'], recenter: true }).then((p) => (P0.aircon = p)),
  loadProp('rollershutter_door', { names: ['rollershutter_door'], recenter: true }).then((p) => (P0.shutter = p)),
  loadProp('cardboard_box_01', { recenter: true }).then((p) => (P0.cardboard = p)),
]);
const city = buildCity(scene, P0);
const cityColliders = city.colliders, cityLights = city.lights;
let colliders = cityColliders, lightSources = cityLights;
const towerObj = buildTower(scene);
const fx = new FX(scene);

// ---------- player ----------
const player = new THREE.Group();
let mixer = null; const actions = {}; let currentAction = null;
let bones = {}, baton = null;
{
  const gltf = await loadGLB('soldier');
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const k = 1.8 / (box.max.y - box.min.y);
  model.scale.setScalar(k); model.position.y = -box.min.y * k;
  model.rotation.y = Math.PI;   // the Mixamo soldier faces -z; our convention is +z
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  player.add(model);
  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
  for (const n of ['RightArm', 'RightForeArm', 'RightHand', 'Spine1', 'Spine2', 'LeftArm', 'LeftForeArm', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) bones[n] = model.getObjectByName('mixamorig' + n) || null;
  // baton in the right hand
  if (bones.RightHand) {
    model.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); bones.RightHand.getWorldScale(ws);
    const s = 1 / (ws.x || 1);
    baton = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.4 }));
    stick.rotation.x = Math.PI / 2; stick.position.z = 0.22; baton.add(stick);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); tip.position.z = 0.54; baton.add(tip);
    baton.scale.setScalar(s); bones.RightHand.add(baton);
  }
  scene.add(player);
}
function play(name, fade = 0.2, timeScale = 1) {
  const a = actions[name] || actions.idle; if (!a) return;
  a.timeScale = timeScale; if (a === currentAction) return;
  if (currentAction) { a.reset().fadeIn(fade).play(); currentAction.fadeOut(fade); } else a.reset().play();   // first clip: no fade (avoids a T-pose flash)
  currentAction = a;
}
play('idle');
player.position.set(city.spawn.x, 0, city.spawn.z);
player.rotation.y = Math.atan2(-1, -1);
player.rotation.order = 'YXZ';

// ---------- state ----------
const keys = new Set();
let paused = false, shadowsOn = true, mouseLocked = false, started = false;
const cam = { yaw: Math.PI / 4, pitch: 0.5, dist: 5, fov: 60 };
const PITCH_MIN = -1.1, PITCH_MAX = 1.45, MOUSE_SENS = 0.0022;
const roll = { t: 0, cd: 0, dx: 0, dz: 0 };
let zoneCur = null, zoneTimer = 0, lightTimer = 0, shake = 0, cullTimer = 0;
let jumpQueued = false, lastWTap = -1000, vy = 0, grounded = true, airT = 0;
const JP = { lUp: -1.0, lKnee: 1.3, rUp: -0.35, rKnee: 0.7, armZ: 0.9, armX: -0.4 };   // jump pose offsets (radians) on top of the idle pose
const freezeJump = new URLSearchParams(location.search).has('freezejump');
const GRAV = 24, JUMP_V = 8.2, SPEED = { sneak: 2.4, run: 5.6, sprint: 8.4, dash: 11 }, PR = 0.42;
const camOverride = { dist: null };
// combat state
const ATK = { dur: 0.45, cd: 0.55, hitAt: 0.35, dmg: 22, range: 2.7 };
let hp = 100, alive = true, atkT = 0, atkCd = 0, atkHit = true, atkYaw = 0, invuln = 0, deathT = 0, hurtFlash = 0;
// what the NPCs know about the player each frame
const Pst = { x: 0, y: 0, z: 0, alive: true, sneaking: false, sprinting: false, dashing: false, noise: 0, cutscene: false, attackedAt: -99 };

function setShadows(on) { shadowsOn = on; moon.castShadow = on; shEl.textContent = on ? 'on' : 'off'; }
setShadows(true);

// ---------- NPCs ----------
const npcCbs = {
  hitPlayer: (dmg, fx0, fz0) => hurtPlayer(dmg, fx0, fz0),
  onSpotted: () => { vignette.classList.add('spotted'); },
  onHit: (n, back) => { shake = Math.max(shake, back ? 0.35 : 0.18); if (back) fx.emit(n.x, 1.4, n.z, 14, 0xffe0a0, 5, 0.5); },
  onKill: (n) => { shake = Math.max(shake, 0.3); if (n.censor) { flags.censor = true; say('CHIEF CENSOR DOWN. ELEVATOR UNLOCKED.', 3, false); refreshObjective(); } },
};
const cityNpc = new NPCManager(scene, cityColliders, fx, npcCbs);
await cityNpc.init(city.spawn);
let npc = cityNpc;
const cityChunks = []; city.root.traverse((o) => { if (o.userData && o.userData.cx !== undefined) cityChunks.push(o); });
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
const tutorial = buildTutorial(scene, city, P0, cityColliders, fx);   // open tutorial: chalk drawings, barrier, punching bag
const tutorialGuard = cityNpc.add('guard', city.spawn.x + 7, city.spawn.z - 6.5, { post: true }); tutorialGuard.yaw = tutorialGuard.postBase = Math.PI / 2; tutorialGuard.scanAmp = 0.4;   // back turned: sneak up on him
const flags = { file: false, censor: false };
let world = 'city', floorIdx = -1, floorData = null, boss = null, arenaR = 0, interactables = [], nearInteract = null, holdE = false, holdProg = 0, gameEnded = false, transitioning = false;

// ---------- cutscene ----------
const ui = {
  currentCaption: '',
  bars: (on) => { barsEl.classList.toggle('on', on); stage.classList.toggle('cinematic', on); skipEl.style.display = on ? 'block' : 'none'; },
  caption: (t) => { ui.currentCaption = t; capEl.textContent = t; },
  title: (on) => titleEl.classList.toggle('on', on),
};
const cut = new Cutscene(camera, ui);

function camPose(dist) {
  const th = cam.yaw, p = cam.pitch, cp = Math.cos(p);
  const fx_ = -Math.sin(th) * cp, fy = Math.sin(p), fz = -Math.cos(th) * cp;
  const px = player.position.x + Math.cos(th) * 0.8, py = 1.85 + player.position.y, pz = player.position.z - Math.sin(th) * 0.8;
  let d = dist;
  for (let t = 0.6; t <= dist; t += 0.4) {
    const x = px - fx_ * t, y = Math.max(0.4, py - fy * t), z = pz - fz * t; let hit = false;
    for (const c of colliders) { if (y < c.h && x > c.minX - 0.3 && x < c.maxX + 0.3 && z > c.minZ - 0.3 && z < c.maxZ + 0.3) { hit = true; break; } }
    if (hit) { d = Math.max(0.8, t - 0.5); break; }
  }
  const yMax = world === 'tower' && floorIdx < FLOORS.length ? WALL_H - 0.45 : 999;   // stay below the ceiling inside the tower
  return { x: px - fx_ * d, y: Math.min(yMax, Math.max(0.4, py - fy * d)), z: pz - fz * d, fx: fx_, fy, fz };
}

function introDef() {
  const tmp = new THREE.Vector3(), eyeTarget = new THREE.Vector3();
  const A = pathShot(10, [[140, 28, 140], [100, 24, 96], [66, 18, 60], [38, 14, 34]], [[0, 170, 0], [0, 130, 0], [0, 100, 0], [0, 80, 0]], 50, 62,
    (u) => { scene.fog.density = 0.016 + 0.01 * u; });
  const B = pathShot(7.5, [[38, 14, 34], [32, 46, 28], [24, 98, 20], [16, 150, 14], [14, 176, 15]], [[0, 90, 0], [0, 150, 0], [0, 200, 0], [0, 214, 0], [0, 214, 0]], 62, 52,
    (u, c) => { if (u > 0.45) { eyeTarget.copy(c.position); towerObj.setOverride(eyeTarget); } if (u > 0.5) ui.title(true); });
  const C = {
    dur: 4.5, pc: null, headLook: new THREE.Vector3(),
    enter() {
      towerObj.setOverride(null); ui.title(false);
      const fwd = new THREE.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const head = new THREE.Vector3(player.position.x, 1.6, player.position.z);
      const front = head.clone().addScaledVector(fwd, 3.2).add(new THREE.Vector3(0, 0.1, 0));
      const side = head.clone().addScaledVector(right, 3.4).addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, 0.4, 0));
      const pose = camPose(cam.dist); const back = new THREE.Vector3(pose.x, pose.y, pose.z);
      this.pc = new THREE.CatmullRomCurve3([front, side, back], false, 'centripetal');
      this.head = head; this.endLook = new THREE.Vector3(pose.x + pose.fx * 50, pose.y + pose.fy * 50, pose.z + pose.fz * 50);
    },
    apply(u, c) {
      const e = smooth(u); c.position.copy(this.pc.getPoint(e));
      tmp.copy(this.head).lerp(this.endLook, smooth(Math.max(0, (u - 0.35) / 0.65)));
      c.lookAt(tmp);
      const f = 52 + (60 - 52) * e; if (Math.abs(c.fov - f) > 0.01) { c.fov = f; c.updateProjectionMatrix(); }
      scene.fog.density = 0.026 + (FOG_DENSITY - 0.026) * e;
    },
  };
  return {
    shots: [A, B, C],
    captions: [
      { t: 1.0, dur: 4, text: 'CITIZENS. THE IRIS SEES ALL.' },
      { t: 5.8, dur: 4.5, text: 'EVERY STREET. EVERY WINDOW. EVERY THOUGHT.' },
      { t: 11.5, dur: 5, text: 'THERE IS NOTHING TO HIDE. THERE IS NOTHING TO FEAR.' },
      { t: 18.2, dur: 3.5, text: 'PRISONER ZERO. YOUR FILE IS INCOMPLETE.' },
    ],
    onStart() { Pst.cutscene = true; scene.fog.density = 0.016; },
    onEnd() { Pst.cutscene = false; setMood('city'); towerObj.setOverride(null); scene.fog.density = FOG_DENSITY; camera.fov = 60; camera.updateProjectionMatrix(); started = true; cam.fov = 60; $('lock').style.display = mouseLocked ? 'none' : 'block'; },
  };
}

// ---------- input ----------
function setPaused(v) {
  paused = v; pauseEl.classList.toggle('on', paused); duckMusic(paused);
  if (paused) { initAudio(); announce('I STILL SEE YOU, PRISONER ZERO. STOPPING TIME WILL NOT SAVE YOU. YOU CANNOT ESCAPE ME.'); }
  else { try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ } }
}
renderer.domElement.addEventListener('click', () => { if (!mouseLocked && !paused && !cut.active) renderer.domElement.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => {
  const was = mouseLocked; mouseLocked = document.pointerLockElement === renderer.domElement; $('lock').style.display = mouseLocked || cut.active ? 'none' : 'block';
  if (was && !mouseLocked && started && !paused && !cut.active && alive && !gameEnded && !transitioning) setPaused(true);   // Esc releases the mouse: pause instead of losing control
});
document.addEventListener('mousemove', (e) => {
  if (!mouseLocked || paused || cut.active) return;
  cam.yaw -= e.movementX * MOUSE_SENS;
  cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch - e.movementY * MOUSE_SENS));
});
document.addEventListener('mousedown', (e) => { initAudio(); if (e.button === 0 && mouseLocked) tryAttack(); });
window.addEventListener('keydown', (e) => {
  initAudio();
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'backspace'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (gameEnded) { if (k === 'enter') location.reload(); return; }
  if (cut.active) { if (k === 'enter' || k === ' ' || k === 'escape') cut.skip(); return; }
  if (k === 'e') { holdE = true; if (nearInteract && nearInteract.type !== 'file') useInteract(nearInteract); }
  if (k === 'backspace' && paused) { try { window.parent !== window && window.parent.postMessage({ type: 'back' }, '*'); } catch (e) { /* ignore */ } location.reload(); return; }
  if (k === 'p') setPaused(!paused);
  else if (k === 'g') { if (world === 'city') setShadows(!shadowsOn); else { shadowsOn = !shadowsOn; shEl.textContent = shadowsOn ? 'on' : 'off'; } }
  else if (k === 'm') toggleMusic();
  else if (k === 'r' && !alive) respawn();
  else if (k === ' ' && !paused) jumpQueued = true;
  else if (k === 'w' && !paused) {
    const now = performance.now();
    if (now - lastWTap < 300 && roll.cd <= 0 && alive) startRoll();
    lastWTap = now;
  }
  keys.add(k);
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') holdE = false; });
window.addEventListener('blur', () => keys.clear());

const moveDir = new THREE.Vector2();
function inputDir() {
  let x = 0, z = 0;
  if (keys.has('w') || keys.has('arrowup')) z += 1;
  if (keys.has('s') || keys.has('arrowdown')) z -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  const th = cam.yaw, fx_ = -Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = -Math.sin(th);
  moveDir.set(fx_ * z + rx * x, fz * z + rz * x);
  if (moveDir.lengthSq() > 0) moveDir.normalize();
  return moveDir;
}
function startRoll() {
  roll.dx = -Math.sin(cam.yaw); roll.dz = -Math.cos(cam.yaw);
  player.rotation.y = Math.atan2(roll.dx, roll.dz);
  roll.t = 0.4; roll.cd = 0.9; atkT = 0; sfx.dash();
}

// ---------- combat ----------
const slash = new THREE.Mesh(new THREE.RingGeometry(0.9, 2.5, 20, 1, Math.PI / 2 - 1.0, 2.0), new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
slash.rotation.x = Math.PI / 2; const slashHolder = new THREE.Group(); slashHolder.add(slash); scene.add(slashHolder);
let slashT = 0;
function tryAttack() {
  if (!alive || cut.active || paused || atkCd > 0 || roll.t > 0) return;
  atkT = ATK.dur; atkCd = ATK.cd; atkHit = false;
  atkYaw = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  player.rotation.y = atkYaw; Pst.attackedAt = npc.time; sfx.swing();
}
function resolveAttack() {
  const hits = npc.meleeHit(Pst, atkYaw, { range: ATK.range, half: 1.0, dmg: ATK.dmg });
  if (world === 'city' && tutorial.hitDummies(Pst, atkYaw, ATK.range, 1.0)) hits.push({});
  if (boss && boss.alive && boss.hitTest(Pst, atkYaw, { range: ATK.range, half: 1.0, dmg: ATK.dmg })) hits.push({});
  slashT = 0.18; slashHolder.position.set(player.position.x, player.position.y + 1.1, player.position.z); slashHolder.rotation.y = atkYaw;
  if (hits.length) { fx.emit(player.position.x + Math.sin(atkYaw) * 1.6, 1.2, player.position.z + Math.cos(atkYaw) * 1.6, 8, 0xfff0c0, 3, 0.25); }
}
function hurtPlayer(dmg, fromX, fromZ) {
  if (!alive || invuln > 0 || roll.t > 0 || cut.active || transitioning) return;
  hp = Math.max(0, hp - dmg); invuln = 0.6; hurtFlash = 0.35; shake = Math.max(shake, 0.45); sfx.hurt();
  const dx = player.position.x - fromX, dz = player.position.z - fromZ, d = Math.hypot(dx, dz) || 1;
  player.position.x += dx / d * 0.5; player.position.z += dz / d * 0.5;
  vignette.classList.add('hurt'); setTimeout(() => vignette.classList.remove('hurt'), 120);
  if (hp <= 0) { alive = false; deathT = 0; atkT = 0; deathEl.classList.add('on'); sfx.ko(); }
}
function respawn() {
  hp = 100; alive = true; invuln = 2; deathEl.classList.remove('on'); vignette.classList.remove('spotted');
  player.rotation.set(0, 0, 0, 'YXZ'); vy = 0;
  if (world === 'tower') { enterFloor(floorIdx, { respawn: true }); return; }
  player.position.set(city.spawn.x, 0, city.spawn.z); player.rotation.y = Math.atan2(-1, -1);
  cam.yaw = Math.PI / 4; cam.pitch = 0.5; npc.reset();
}

// ---------- movement / collision ----------
function collide(pos) {
  for (let pass = 0; pass < 2; pass++) for (const c of colliders) {
    if (pos.y >= c.h - 0.3) continue;
    if (pos.x < c.minX - 2 || pos.x > c.maxX + 2 || pos.z < c.minZ - 2 || pos.z > c.maxZ + 2) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX)), cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < PR * PR) {
      if (d2 < 1e-8) {
        const l = pos.x - c.minX, r = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z, m = Math.min(l, r, t, b);
        if (m === l) pos.x = c.minX - PR; else if (m === r) pos.x = c.maxX + PR; else if (m === t) pos.z = c.minZ - PR; else pos.z = c.maxZ + PR;
      } else { const d = Math.sqrt(d2), k = (PR - d) / d; pos.x += dx * k; pos.z += dz * k; }
    }
  }
}
function groundHeight(pos) {
  let g = 0;
  for (const c of colliders) {
    if (c.h > 1.8 || pos.y < c.h - 0.3) continue;
    if (pos.x > c.minX - PR * 0.6 && pos.x < c.maxX + PR * 0.6 && pos.z > c.minZ - PR * 0.6 && pos.z < c.maxZ + PR * 0.6) g = Math.max(g, c.h);
  }
  return g;
}

let speedNow = 0, sprinting = false, moving = false;
function updatePlayer(dt) {
  if (!alive) {   // collapse
    deathT += dt; player.rotation.x += (-Math.PI / 2 - player.rotation.x) * Math.min(1, dt * 5); mixer?.update(dt * 0.2);
    atkT = 0; speedNow = 0; return;
  }
  const sneak = keys.has('shift');
  sprinting = false; moving = false;
  let speed = 0, dir = null, anim = 'idle', ts = 1;
  if (roll.t > 0) { roll.t -= dt; speed = SPEED.dash; dir = { x: roll.dx, y: roll.dz }; anim = 'run'; ts = 1.7; }
  else {
    const d = inputDir();
    if (d.lengthSq() > 0) {
      dir = d; moving = true;
      if (sneak) { speed = SPEED.sneak; anim = 'walk'; ts = 0.75; }
      else if (keys.has('control')) { speed = SPEED.sprint; anim = 'run'; ts = 1.3; sprinting = true; }
      else { speed = SPEED.run; anim = 'run'; }
    }
  }
  roll.cd -= dt; atkCd -= dt; invuln -= dt;
  if (freezeAtk != null) atkT = ATK.dur * (1 - freezeAtk) + dt;   // debug: hold the swing at one pose
  if (atkT > 0) {
    atkT -= dt; const prog = 1 - atkT / ATK.dur;
    if (!atkHit && prog >= ATK.hitAt) { atkHit = true; resolveAttack(); }
    speed *= 0.35;   // slowed while swinging
  }
  if (dir && speed > 0) {
    player.position.x += dir.x * speed * dt; player.position.z += dir.y * speed * dt;
    collide(player.position);
    if (arenaR) { const r = Math.hypot(player.position.x, player.position.z); if (r > arenaR) { player.position.x *= arenaR / r; player.position.z *= arenaR / r; } }
    if (roll.t <= 0 && atkT <= 0) {
      const targetRot = Math.atan2(dir.x, dir.y);
      let diff = targetRot - player.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      player.rotation.y += diff * Math.min(1, dt * 14);
    }
  }
  speedNow = speed;
  if (jumpQueued && grounded && roll.t <= 0) { vy = JUMP_V; grounded = false; sfx.jump(); }
  jumpQueued = false;
  const gy = groundHeight(player.position);
  vy -= GRAV * dt; player.position.y += vy * dt;
  if (player.position.y <= gy) { player.position.y = gy; vy = 0; grounded = true; } else grounded = false;
  if (freezeJump) { grounded = false; vy = 0; player.position.y = 1.2; }
  airT = grounded ? 0 : airT + dt;
  const airborne = !grounded && roll.t <= 0;
  if (airborne) { anim = 'idle'; ts = 1; }   // no running legs in mid-air: stand pose + procedural jump pose below
  play(anim, 0.12, ts);
  player.scale.y = roll.t > 0 ? 0.82 : 1;
  mixer?.update(dt);
  if (airborne) {
    const k = Math.min(1, airT / 0.12), fall = Math.max(0, Math.min(1, -vy / JUMP_V));
    const B = bones;
    if (B.LeftUpLeg) { B.LeftUpLeg.rotation.x += JP.lUp * k; B.LeftLeg.rotation.x += JP.lKnee * k; B.RightUpLeg.rotation.x += JP.rUp * k; B.RightLeg.rotation.x += JP.rKnee * k; }
    if (B.LeftArm) { B.LeftArm.rotation.z += JP.armZ * k * (1 - 0.5 * fall); B.RightArm.rotation.z -= JP.armZ * k * (1 - 0.5 * fall); B.LeftArm.rotation.x += JP.armX * k; B.RightArm.rotation.x += JP.armX * k; }
  }
  // procedural swing on top of the animation
  if (atkT > 0 && bones.RightArm) {
    const p = 1 - atkT / ATK.dur;
    const a = p < 0.3 ? -p / 0.3 : p < 0.6 ? -1 + 2.4 * (p - 0.3) / 0.3 : 1.4 * (1 - (p - 0.6) / 0.4);
    bones.RightArm.rotation.x += a * 1.3; bones.RightForeArm && (bones.RightForeArm.rotation.x += a * 0.5);
    bones.Spine1 && (bones.Spine1.rotation.y += -a * 0.45);
  }
  // what the NPCs can perceive
  Pst.x = player.position.x; Pst.y = player.position.y; Pst.z = player.position.z; Pst.alive = alive;
  Pst.sneaking = sneak && moving; Pst.sprinting = sprinting; Pst.dashing = roll.t > 0;
  Pst.noise = roll.t > 0 ? 11 : atkT > 0 ? 14 : sprinting ? 13 : moving ? (sneak ? 3 : 7) : 0;
}

// ---------- zones, lights ----------
function updateZone(dt) {
  zoneTimer -= dt;
  const z = world === 'city' ? districtAt(player.position.x, player.position.z) : zoneCur;
  if (z !== zoneCur) { zoneCur = z; zoneName.textContent = ZONES[z].name; zoneSub.textContent = ZONES[z].sub; zoneEl.classList.add('on'); zoneTimer = 3.5; }
  if (zoneTimer <= 0) zoneEl.classList.remove('on');
}
function updateLights() {
  const px = player.position.x, pz = player.position.z, best = [];
  for (const s of lightSources) {
    const dx = s.x - px, dz = s.z - pz, d2 = dx * dx + dz * dz; if (d2 > 1600) continue;
    if (best.length < pool.length) { best.push({ s, d2 }); best.sort((a, b) => a.d2 - b.d2); }
    else if (d2 < best[best.length - 1].d2) { best[best.length - 1] = { s, d2 }; best.sort((a, b) => a.d2 - b.d2); }
  }
  pool.forEach((l, i) => { const b = best[i]; if (!b) { l.intensity = 0; return; } l.position.set(b.s.x, b.s.y, b.s.z); l.color.set(b.s.color); l.intensity = b.s.intensity; l.distance = b.s.dist; });
}

// ---------- camera ----------
function targetDist() {
  if (camOverride.dist != null) return camOverride.dist;
  let d = 4.6 * (world === 'tower' ? (floorIdx >= FLOORS.length ? 1.45 : 0.95) : ZONES[zoneCur || 'prison'].camScale);
  if (keys.has('shift') && speedNow > 0) d -= 0.9;
  if (roll.t > 0) d += 0.6; else if (sprinting) d += 0.8; else if (speedNow > 5) d += 0.4;
  if (npc.chasers > 0) d += 0.5;   // pull back when hunted
  return d;
}
function updateCamera(dt) {
  cam.dist += (targetDist() - cam.dist) * (1 - Math.exp(-dt * 4));
  const fovT = 60 + (sprinting ? 7 : speedNow > 5 ? 3 : 0) + (roll.t > 0 ? 3 : 0);
  cam.fov += (fovT - cam.fov) * (1 - Math.exp(-dt * 5));
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  const pose = camPose(cam.dist);
  camera.position.set(pose.x, pose.y, pose.z);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; shake *= Math.exp(-dt * 9); }
  camera.lookAt(camera.position.x + pose.fx * 50, camera.position.y + pose.fy * 50, camera.position.z + pose.fz * 50);
}

// ---------- hud ----------
function updateHud(dt) {
  hpFill.style.width = hp + '%';
  alarmFill.style.width = npc.alarm + '%';
  alarmTxt.textContent = npc.alarm > 60 ? 'ALARM: HUNTED' : npc.alarm > 5 ? 'ALARM: ALERT' : 'ALARM';
  if (npc.chasers === 0) vignette.classList.remove('spotted');
  if (boss && boss.alive) { bossBar.style.display = 'block'; bossFill.style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%'; bossName.textContent = boss.name; }
  else if (!boss) bossBar.style.display = 'none';
}

// ---------- debug overrides ----------
let freezeAtk = query.has('freezeatk') ? +query.get('freezeatk') : null;
if (query.has('demo')) {
  const px = city.spawn.x, pz = city.spawn.z;
  npc.add('guard', px - 3.6, pz - 3.6, { post: true }); npc.add('robot', px + 2.5, pz - 5.5, { post: true });
  npc.add('citizen', px - 1.5, pz + 3.5, {}); npc.add('drone', px - 2, pz - 7, {});
}
{
  if (query.has('x')) player.position.x = +query.get('x');
  if (query.has('z')) player.position.z = +query.get('z');
  if (query.has('yaw')) cam.yaw = +query.get('yaw');
  if (query.has('pitch')) cam.pitch = THREE.MathUtils.degToRad(+query.get('pitch'));
  if (query.has('dist')) { camOverride.dist = +query.get('dist'); cam.dist = camOverride.dist; }
  if (query.has('face')) player.rotation.y = +query.get('face');
}

// ---------- tower entrance in the city ----------
const doorGroup = new THREE.Group(); scene.add(doorGroup);
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1416, metalness: 0.7, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.6, 1.3), dark); p.position.set(s * 2.7, 2.8, 9.5); p.castShadow = true; doorGroup.add(p);
    cityColliders.push({ minX: s * 2.7 - 0.45, maxX: s * 2.7 + 0.45, minZ: 8.85, maxZ: 10.15, h: 5.6 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.0, 1.3), dark); lintel.position.set(0, 6.1, 9.5); doorGroup.add(lintel);
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 5.6), new THREE.MeshBasicMaterial({ color: 0xff6a1a })); portal.position.set(0, 2.8, 8.95); doorGroup.add(portal);
  const eyeSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false })); eyeSp.scale.set(3.4, 1.7, 1); eyeSp.position.set(0, 7.5, 9.6); doorGroup.add(eyeSp);
  cityLights.push({ x: 0, y: 3, z: 11.2, color: 0xff7a2a, intensity: 95, dist: 22 });
}
const doorInteract = { x: 0, z: 11.4, r: 3.4, type: 'door', text: 'E: ENTER THE TOWER' };
interactables = [doorInteract];

// ---------- world switching: city <-> tower floors <-> boss arena ----------
const promptEl = $('prompt'), holdWrap = $('holdwrap'), holdFill = $('holdfill'), fadeEl = $('fade'), bossBar = $('bossbar'), bossFill = $('bossfill'), bossName = $('bossname'), objEl = $('objective'), endEl = $('endcard');
function fade(on, ms = 450) { if (query.has('floor')) { fadeEl.style.opacity = 0; return Promise.resolve(); } fadeEl.style.transition = `opacity ${ms}ms`; fadeEl.style.opacity = on ? 1 : 0; return new Promise((r) => setTimeout(r, ms)); }
function texturesIdle() {
  return new Promise((resolve) => {
    let done = false; const finish = () => { if (!done) { done = true; manager.onLoad = () => {}; resolve(); } };
    manager.onLoad = finish; setTimeout(finish, 15000);
    manager.itemStart('idle-check'); manager.itemEnd('idle-check');   // fires onLoad right away when nothing is pending
  });
}
function say(text, dur = 3.4, speak = true) {
  ui.caption(text); if (speak) announce(text);
  setTimeout(() => { if (ui.currentCaption === text) ui.caption(''); }, dur * 1000);
}
function elevLocked() { const d = FLOORS[floorIdx]; return !!d && ((d.lock === 'file' && !flags.file) || (d.lock === 'censor' && !flags.censor)); }
function refreshObjective() {
  let t;
  if (world === 'city') t = 'Escape the detention sector, reach the tower and find your file.';
  else if (floorIdx >= FLOORS.length) t = 'Destroy The Iris.';
  else {
    const d = FLOORS[floorIdx];
    if (d.lock === 'file' && !flags.file) t = 'Find and destroy your file (hold E).';
    else if (d.lock === 'censor' && !flags.censor) t = 'Defeat the Chief Censor to unlock the elevator.';
    else if (!flags.file) t = 'Take the elevator up. Your file is in the Records Archive (floor 2).';
    else t = 'Take the elevator up. Reach the Apex.';
  }
  objEl.textContent = 'OBJECTIVE: ' + t;
}
function setCityVisible(v) { tutorial.group.visible = v; city.root.visible = v; towerObj.tower.visible = v; towerObj.eye.visible = v; cityNpc.root.visible = v; doorGroup.visible = v; }
function applyEnv(kind, fogColor = 0x2d0c0c) {
  const isCity = kind === 'city', c = isCity ? FOG_COLOR : fogColor;
  scene.fog.color.setHex(c); scene.background.setHex(c);
  scene.fog.density = isCity ? FOG_DENSITY : kind === 'arena' ? 0.010 : 0.016;
  hemi.intensity = isCity ? 2.0 : kind === 'arena' ? 2.2 : 2.6;
  hemi.color.setHex(isCity ? 0x8a4254 : kind === 'arena' ? 0xd08878 : 0xe0a090); hemi.groundColor.setHex(isCity ? 0x1a0608 : 0x502a2a);
  moon.intensity = isCity ? 1.3 : kind === 'arena' ? 1.0 : 0.6;
  playerLight.intensity = isCity ? 26 : 28;
  moon.castShadow = isCity ? shadowsOn : false;
  sky.visible = kind !== 'floor';
}
function clearFloor() {
  if (floorData) { scene.remove(floorData.group); floorData = null; }
  if (npc !== cityNpc) { npc.destroy(); npc = cityNpc; }
  if (boss) { scene.remove(boss.group); boss = null; }
  arenaR = 0; bossBar.style.display = 'none'; interactables = [];
}
async function enterFloor(i, opts = {}) {
  if (transitioning) return; transitioning = true;
  try {
    await fade(true);
    clearFloor(); world = 'tower'; floorIdx = i; setCityVisible(false);
    if (i < FLOORS.length) { setupFloor(i, opts); setMood('tower', i); } else { await setupBoss(opts); }
    roll.t = 0; atkT = 0; vy = 0; player.position.y = 0; grounded = true; alive = true;
    await texturesIdle();   // new floors bring new textures: wait so nothing pops in black
    if (query.has('dbg') && floorData) floorData.group.traverse((o) => { if (o.isMesh && o.material && o.material.map) console.log('DBG mesh', o.geometry.type, 'map', o.material.map.image ? o.material.map.image.width : 'NOIMG', 'color', o.material.color && o.material.color.getHexString(), 'visible', o.visible); });
  } catch (err) { console.error('enterFloor failed', err && err.stack || err); }
  await fade(false); transitioning = false;
}
function setupFloor(i, opts) {
  const f = buildFloor(i, P0); floorData = f; scene.add(f.group); colliders = f.colliders; lightSources = f.lights;
  npc = new NPCManager(scene, colliders, fx, npcCbs);
  npc.custom = true; npc.nodes = f.nodes; npc.droneH = 2.7; npc.droneLow = 1.9; npc.spawnPoint = f.start; npc.models = cityNpc.models;
  for (const s of f.spawn) npc.add(s.type, s.x, s.z, s.opts);
  player.position.set(f.start.x, 0, f.start.z); player.rotation.set(0, 0, 0, 'YXZ'); cam.yaw = Math.PI; cam.pitch = 0.3;
  applyEnv('floor', f.fog);
  interactables = [
    { x: f.startElev.x, z: f.startElev.z, r: 2.4, type: 'down', text: () => (i === 0 ? 'E: LEAVE THE TOWER' : 'E: ELEVATOR DOWN') },
    { x: f.exitElev.x, z: f.exitElev.z, r: 2.4, type: 'up', text: () => (elevLocked() ? 'ELEVATOR LOCKED' : 'E: ELEVATOR UP') },
  ];
  if (f.file) interactables.push({ x: f.file.x, z: f.file.z, r: 2.4, type: 'file', text: 'HOLD E: DESTROY YOUR FILE' });
  if (!opts.respawn) hp = Math.min(100, hp + 30);
  zoneCur = 'floor'; zoneName.textContent = 'FLOOR ' + String(i + 1).padStart(2, '0'); zoneSub.textContent = f.def.name + ' - ' + f.def.sub; zoneEl.classList.add('on'); zoneTimer = 4;
  refreshObjective();
}
const bossCbs = {
  shake: (v) => { shake = Math.max(shake, v); },
  say: (t) => say(t, 3.4),
  hint: (t) => { if (!bossCbs._h || performance.now() - bossCbs._h > 4000) { bossCbs._h = performance.now(); say(t, 2.5, false); } },
  hitPlayer: (d, x, z) => hurtPlayer(d, x, z),
  onHit: () => { shake = Math.max(shake, 0.18); },
  onPhase: () => { shake = Math.max(shake, 0.5); },
  spawnDrones: (n) => { for (let k = 0; k < Math.min(n, 2); k++) { const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 6, g = npc.add('guard', Math.cos(a) * r, Math.sin(a) * r, {}); g.startChase(Pst); } },   // reinforcements are guards (drones never attack)
  clearEnemies: () => { for (const n of npc.npcs) if (n.state !== 'ko') { n.hp = 0; n.die(Pst); } },
  onDefeated: () => { setTimeout(() => cut.play(victoryDef()), 2600); },
};
async function setupBoss(opts) {
  boss = new Boss(scene, fx, bossCbs); await boss.init();
  colliders = boss.colliders; lightSources = boss.lights; arenaR = ARENA_R - 1.2;
  npc = new NPCManager(scene, colliders, fx, npcCbs); npc.custom = true; npc.nodes = []; npc.droneH = 3; npc.droneLow = 2.2; npc.models = cityNpc.models;
  player.position.set(0, 0, 17); player.rotation.set(0, Math.PI, 0, 'YXZ'); cam.yaw = 0; cam.pitch = 0.3;
  applyEnv('arena', 0x1a0608); bossBar.style.display = 'block';
  if (!opts.respawn) hp = Math.min(100, hp + 30);
  zoneCur = 'floor'; zoneName.textContent = 'THE APEX'; zoneSub.textContent = 'Beneath the Eye'; zoneEl.classList.add('on'); zoneTimer = 4;
  refreshObjective();
  if (opts.respawn) { setMood('boss'); boss.begin(); } else { setMood('intro'); cut.play(bossIntroDef()); }
}
async function enterCity() {
  if (transitioning) return; transitioning = true;
  await fade(true);
  clearFloor(); world = 'city'; floorIdx = -1; npc = cityNpc; colliders = cityColliders; lightSources = cityLights;
  setCityVisible(true); applyEnv('city'); setMood('city'); interactables = [doorInteract];
  player.position.set(0, 0, 12.8); player.rotation.set(0, 0, 0, 'YXZ'); cam.yaw = 0; cam.pitch = 0.5; zoneCur = null;
  refreshObjective(); await fade(false); transitioning = false;
}
function bossIntroDef() {
  const A = pathShot(8, [[-12, 9, 17], [-4, 5.5, 13], [5, 3.4, 7]], [[0, 2, -8], [0, 3, -6], [0, 2.2, -8]], 56, 46);
  return {
    shots: [A],
    captions: [{ t: 0.5, dur: 3, text: 'WELCOME, PRISONER ZERO.' }, { t: 3.8, dur: 4, text: 'EVERY STEP YOU TOOK WAS MINE.' }],
    onStart() { Pst.cutscene = true; }, onEnd() { Pst.cutscene = false; setMood('boss'); if (boss) boss.begin(); },
  };
}
function victoryDef() {
  const dawn = new THREE.Color(0x7a4a3a);
  const A = pathShot(8, [[0, 3, 13], [0, 8, 15], [0, 16, 20]], [[0, 7, 0], [0, 10, 0], [0, 20, 0]], 50, 62, () => { scene.fog.color.lerp(dawn, 0.012); scene.background.copy(scene.fog.color); });
  return {
    shots: [A],
    captions: [{ t: 0.8, dur: 3.2, text: 'THE IRIS IS BLIND.' }, { t: 4.4, dur: 3.2, text: 'THE CITY SEES AGAIN.' }],
    onStart() { Pst.cutscene = true; setMood('victory'); setIntensity(0.2); }, onEnd() { gameEnded = true; endEl.classList.add('on'); try { window.parent !== window && window.parent.postMessage({ type: 'gameOver', score: 1 }, '*'); } catch (e) { /* ignore */ } },
  };
}

// ---------- interaction (E) ----------
function useInteract(it) {
  if (transitioning || !alive || cut.active) return;
  if (it.type === 'door') enterFloor(0);
  else if (it.type === 'down') { if (floorIdx <= 0) enterCity(); else enterFloor(floorIdx - 1); }
  else if (it.type === 'up') {
    if (elevLocked()) say(FLOORS[floorIdx].lock === 'file' ? 'ELEVATOR LOCKED. Find and destroy your file first.' : 'ELEVATOR LOCKED. Defeat the Chief Censor.', 2.8, false);
    else { sfx.alert(0.6); enterFloor(floorIdx + 1); }
  }
}
function completeFile() {
  flags.file = true; holdProg = 0; holdWrap.style.display = 'none'; sfx.ko(1); shake = Math.max(shake, 0.4);
  fx.emit(Pst.x, 1.2, Pst.z + 1, 40, 0xff7a2a, 6, 0.8);
  say('FILE-000: PRISONER ZERO. FIRST ENEMY OF THE STATE.', 4.6);
  setTimeout(() => say('They never stopped hunting me. The whole city lives like this. It ends here.', 4.4, false), 4800);
  refreshObjective();
}
function updateInteract(dt) {
  let near = null, bd = 1e9;
  for (const it of interactables) { const d = Math.hypot(player.position.x - it.x, player.position.z - it.z); if (d < it.r && d < bd) { bd = d; near = it; } }
  nearInteract = near;
  if (!near || !alive || cut.active || transitioning || (near.type === 'file' && flags.file)) { promptEl.style.display = 'none'; holdWrap.style.display = 'none'; holdProg = 0; return; }
  promptEl.textContent = typeof near.text === 'function' ? near.text() : near.text; promptEl.style.display = 'block';
  if (near.type === 'file') {
    if (holdE) holdProg += dt / 1.6; else holdProg = Math.max(0, holdProg - dt * 2);
    holdWrap.style.display = holdProg > 0 ? 'block' : 'none'; holdFill.style.width = Math.min(100, holdProg * 100) + '%';
    if (holdProg >= 1) completeFile();
  } else holdWrap.style.display = 'none';
}

// ---------- start ----------
const idle = new Promise((r) => { manager.onLoad = r; setTimeout(r, 20000); });
manager.itemEnd('boot');
await idle;
barEl.parentElement.style.display = 'none';

function begin() {
  loadEl.style.display = 'none'; initAudio(); startMusic(); setMood(query.has('nointro') ? 'city' : 'intro');
  if (query.has('nointro')) { started = true; camera.fov = 60; camera.updateProjectionMatrix(); }
  else {
    cut.play(introDef());
    if (query.has('cutt')) { const T = +query.get('cutt'); for (let t = 0; t < T; t += 0.05) cut.update(0.05); }
  }
  $('lock').style.display = cut.active ? 'none' : 'block';
  if (query.has('floor')) { flags.file = query.has('hasfile') || +query.get('floor') > 2; flags.censor = +query.get('floor') > 5; enterFloor(+query.get('floor') - 1, { respawn: query.has('noboss') }); }
  console.log('bones:', Object.entries(bones).map(([k, v]) => k + '=' + !!v).join(' '));
}
if (query.has('autostart')) begin();
else {
  startMsg.style.display = 'block';
  const go = () => { window.removeEventListener('keydown', go); window.removeEventListener('pointerdown', go); begin(); };
  window.addEventListener('keydown', go); window.addEventListener('pointerdown', go);
}

let last = performance.now(), fpsAcc = 0, fpsFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  if (!paused) {
    if (cut.active) {
      cut.update(dt); mixer?.update(dt);
      Pst.x = player.position.x; Pst.z = player.position.z; Pst.cutscene = true;
    } else {
      updatePlayer(dt);
      updateZone(dt);
    }
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pv); npc.frustum = _frustum;
    if (world === 'city') { towerObj.update(dt, player.position); tutorial.update(dt); cullTimer -= dt; if (cullTimer <= 0) { cullTimer = 0.25; const px = player.position.x, pz = player.position.z; for (const ch of cityChunks) { const dx = ch.userData.cx - px, dz = ch.userData.cz - pz; ch.visible = dx * dx + dz * dz < 130 * 130; } } }
    npc.update(dt, Pst);
    if (boss && world === 'tower') boss.update(dt, Pst);
    fx.update(dt);
    if (!cut.active) updateInteract(dt); else promptEl.style.display = 'none';
    if (!gameEnded && !(cut.active && boss && boss.phase === 4)) setIntensity(boss && boss.alive ? 0.6 + (boss.phase >= 3 ? 0.35 : 0) : Math.min(1, npc.alarm / 70));
    if (slashT > 0) { slashT -= dt; slash.material.opacity = Math.max(0, slashT / 0.18) * 0.9; slashHolder.position.x = player.position.x; slashHolder.position.z = player.position.z; }
    lightTimer -= dt; if (lightTimer <= 0) { updateLights(); lightTimer = 0.12; }
    moon.position.set(player.position.x - 26, 55, player.position.z + 20);
    moon.target.position.set(player.position.x, 0, player.position.z);
    playerLight.position.set(player.position.x, 2.6, player.position.z);
    if (!cut.active) updateHud(dt);
  }
  if (!cut.active) updateCamera(paused ? 0.0001 : dt);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

if (window.parent !== window) window.parent.postMessage({ type: 'ready' }, '*');
window.__iris = { player, camera, cam, camOverride, scene, renderer, cut, hurtPlayer, tryAttack, startRoll, enterFloor, flags, get npc() { return npc; }, get boss() { return boss; }, get hp() { return hp; }, get floorIdx() { return floorIdx; }, get world() { return world; }, get interactables() { return interactables; }, get gameEnded() { return gameEnded; }, Pst };
