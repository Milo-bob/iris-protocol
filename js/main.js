import './fog.js';
import * as THREE from 'three';
import { manager, loadGLB, loadProp } from './assets.js';
import { buildCity, districtAt, ZONES, eyeTexture, EDGE } from './city.js';
import { Guide } from './guide.js';
import { buildTower } from './tower.js';
import { FX } from './fx.js';
import { NPCManager } from './npc.js';
import { Cutscene, pathShot, smooth } from './cutscene.js';
import { initAudio, sfx, announce, startMusic, setMood, setIntensity, duckMusic, toggleMusic, setDread, tickDread, setMuffle } from './audio.js';
import { Director } from './director.js';
import { Stalker } from './stalker.js';
import { buildFloor, FLOORS, WALL_H } from './interior.js';
import { Boss, ARENA_R } from './boss.js';
import { buildTutorial } from './tutorial.js';

// ---------------------------------------------------------------------------
// The Iris Protocol, prototype M4: night city, prison start, over-the-shoulder camera, stealth (choke from behind,
// hiding places, shadows, noise), pistol + fists, NPCs that hunt and give up, the Dictator's adaptive hunter, intro cutscene.
// ---------------------------------------------------------------------------

const FOG_COLOR = 0x2d0c0c, FOG_DENSITY = 0.034;
const $ = (id) => document.getElementById(id);
const stage = $('stage'), loadEl = $('loading'), barEl = $('bar'), startMsg = $('startmsg');
const fpsEl = $('fps'), shEl = $('sh'), pauseEl = $('pause');
const zoneEl = $('zone'), zoneName = $('zoneName'), zoneSub = $('zoneSub');
const hpFill = $('hpfill'), alarmFill = $('alarmfill'), alarmTxt = $('alarmtxt'), vignette = $('vignette'), deathEl = $('death');
const capEl = $('caption'), titleEl = $('titlecard'), barsEl = $('bars'), skipEl = $('skip');
const ammoEl = $('ammo'), ammoWrap = $('ammowrap'), visFill = $('visfill'), visTxt = $('vistxt'), hideOv = $('hideov'), toastEl = $('toast'), deathTitle = $('deathTitle'), deathSub = $('deathSub');
const query = new URLSearchParams(location.search);

manager.itemStart('boot');
manager.onProgress = (url, loaded, total) => { barEl.style.width = Math.round(loaded / total * 100) + '%'; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const maxPR = Math.min(window.devicePixelRatio || 1, 1.25); let curPR = maxPR;   // lowered automatically when the frame rate drops
renderer.setPixelRatio(curPR);
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
const guide = new Guide(scene, camera, stage);   // objective markers, route line, minimap

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
let bones = {}, gun = null, muzzle = null, flash = null;
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
  for (const n of ['RightArm', 'RightForeArm', 'RightHand', 'Spine1', 'Spine2', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) bones[n] = model.getObjectByName('mixamorig' + n) || null;
  // suppressed pistol in the right hand
  if (bones.RightHand) {
    model.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); bones.RightHand.getWorldScale(ws);
    const s = 1 / (ws.x || 1);
    gun = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.7, roughness: 0.35 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), dark); slide.position.set(0, 0.03, 0.1);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.7 })); grip.position.set(0, -0.04, 0.03); grip.rotation.x = 0.2;
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), dark); sup.rotation.x = Math.PI / 2; sup.position.set(0, 0.035, 0.28);
    muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.035, 0.37);
    flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); flash.position.copy(muzzle.position);
    gun.add(slide, grip, sup, muzzle, flash); gun.rotation.x = -Math.PI / 2; gun.scale.setScalar(s);   // barrel along the fingers bones.RightHand.add(gun);
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
// combat state: fists, pistol, silent choke, hiding
const FIST = { dur: 0.34, hitAt: 0.13, cd: 0.45, dmg: 4, bossDmg: 14, range: 2.4 };   // fists only buy time: stealth and the pistol are the real tools
const GUN = { cd: 0.28, dmg: 24, range: 70, mag: 12, reload: 1.5, noise: 14, reserveMax: 40 };
let hp = 100, alive = true, atkT = 0, atkCd = 0, atkHit = true, atkYaw = 0, atkKind = 'none', punchSide = 1, invuln = 0, deathT = 0, hurtFlash = 0;
let mag = GUN.mag, reserve = 12, reloadT = 0, gunUp = 0, gunNoiseT = 0;
const choke = { n: null, t: 0, dur: 0 };
let hidden = false, hideSpot = null, hideT = 0, hideInteracts = [], tkTarget = null, litT = 0, lit = 1, visNow = 1, visitT = 2;
// what the NPCs know about the player each frame
const Pst = { x: 0, y: 0, z: 0, alive: true, sneaking: false, sprinting: false, dashing: false, moving: false, hidden: false, hideId: null, lit: 1, noise: 0, cutscene: false, attackedAt: -99 };

function setShadows(on) { shadowsOn = on; moon.castShadow = on; shEl.textContent = on ? 'on' : 'off'; }
setShadows(true);

// ---------- NPCs ----------
const director = new Director((t) => say(t, 3.8, false));   // watches how you play; guards and the hunter adapt
const npcCbs = {
  hitPlayer: (dmg, fx0, fz0) => hurtPlayer(dmg, fx0, fz0),
  onSpotted: (n) => { vignette.classList.add('spotted'); stalker.hearNoise(n.x, n.z, 34); },
  onHit: (n, crit) => { shake = Math.max(shake, crit ? 0.35 : 0.18); if (crit) fx.emit(n.x, 1.7, n.z, 14, 0xffe0a0, 5, 0.5); },
  onKill: (n, quiet) => {
    shake = Math.max(shake, quiet ? 0.1 : 0.3);
    if (quiet) director.onTakedown();
    if (n.type === 'guard' || n.type === 'robot') addAmmo(quiet ? (n.type === 'robot' ? 4 : 3) : 1);
    if (n.censor) { flags.censor = true; say('CHIEF CENSOR DOWN. ELEVATOR UNLOCKED.', 3, false); refreshObjective(); }
  },
  onNoise: (x, z, r) => stalker.hearNoise(x, z, r * 2),
  foundHidden: (spot, who) => pullOut(spot, who, false),
};
const cityNpc = new NPCManager(scene, cityColliders, fx, npcCbs, director);
await cityNpc.init(city.spawn);
let npc = cityNpc;
const cityChunks = []; city.root.traverse((o) => { if (o.userData && o.userData.cx !== undefined) cityChunks.push(o); });
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
const tutorial = buildTutorial(scene, city, P0, cityColliders, fx);   // open tutorial: chalk drawings, barrier, punching bag, a dumpster to hide in
const ammoMat = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.6, metalness: 0.3 }), ammoStrip = new THREE.MeshBasicMaterial({ color: 0xffb040 });
const cityHideList = city.hideSpots.concat(tutorial.hideSpots);
const cityPickups = []; let floorPickups = [], pickups = cityPickups;
const stalkerCbs = {
  hitPlayer: (d, x, z) => hurtPlayer(d, x, z, 'stalker'),
  shake: (v) => { shake = Math.max(shake, v); },
  whisper: (t) => say(t, 3.6, false),
  foundHidden: (spot, who) => pullOut(spot, who, true),
  nearMiss: () => { sfx.heart(1); shake = Math.max(shake, 0.12); },
  spotted: () => { vignette.classList.add('spotted'); },
};
const stalker = new Stalker(scene, fx, director, stalkerCbs);   // created now so the scene's light count never changes later
let stalkerT = 0, cityAlarmT = 0;
function updateStalkerCtl(dt) {   // when the hunter shows up: after a while on the upper floors, or when the whole city is after you
  if (stalker.active || cut.active || transitioning || !alive) { if (!stalker.active) cityAlarmT = 0; if (world === 'city' && stalker.active && stalker.calmT > 70) stalker.despawn(); return; }
  if (world === 'tower' && floorIdx >= 1 && floorIdx < FLOORS.length) { stalkerT += dt; if (stalkerT > 25) { say('SECURITY NOTICE: THE DICTATOR HAS BEEN RELEASED. DO NOT RESIST.', 4.5); stalker.attach(npc); stalker.spawn(Pst); } }
  else if (world === 'city' && started) { if (npc.alarm >= 60) cityAlarmT += dt; else cityAlarmT = Math.max(0, cityAlarmT - dt * 0.5); if (cityAlarmT > 14) { cityAlarmT = 0; say('THE IRIS HAS SEEN ENOUGH. IT SENDS ITSELF.', 4); stalker.attach(npc); stalker.spawn(Pst); } }
}
const tutorialGuard = cityNpc.add('guard', city.spawn.x + 7, city.spawn.z - 6.5, { post: true }); tutorialGuard.yaw = tutorialGuard.postBase = Math.PI / 2; tutorialGuard.scanAmp = 0.4;   // back turned: sneak up on him
const flags = { file: false, censor: false };
setHideSpots(cityHideList); addPickups(city.ammo.concat(tutorial.ammo), cityPickups); stalker.attach(npc);
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
  if (k === 'e') { holdE = true; if (hidden) { if (hideT > 0.45) exitHide(); } else if (nearInteract && nearInteract.type !== 'file' && nearInteract.type !== 'relay') useInteract(nearInteract); }
  if (k === 'backspace' && paused) { try { window.parent !== window && window.parent.postMessage({ type: 'back' }, '*'); } catch (e) { /* ignore */ } location.reload(); return; }
  if (k === 'p') setPaused(!paused);
  else if (k === 'g') { if (world === 'city') setShadows(!shadowsOn); else { shadowsOn = !shadowsOn; shEl.textContent = shadowsOn ? 'on' : 'off'; } }
  else if (k === 'm') toggleMusic();
  else if (k === 'n') guide.toggleMap();
  else if (k === 'r' && !alive) respawn();
  else if (k === 'r' && alive && !paused) startReload();
  else if (k === ' ' && !paused) jumpQueued = true;
  else if (k === 'w' && !paused) {
    const now = performance.now();
    if (now - lastWTap < 300 && roll.cd <= 0 && alive && !hidden) startRoll();
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
  cancelChoke(); roll.t = 0.4; roll.cd = 0.9; atkT = 0; sfx.dash();
}

// ---------- combat ----------
// One attack button (LMB) that depends on the situation:
//  - an unaware enemy within reach and the player behind its back: silent choke (takedown)
//  - an enemy that already hunts the player within fist reach: punch
//  - anything else: pistol shot along the crosshair
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _mz = new THREE.Vector3();
const tracers = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false })); l.frustumCulled = false; scene.add(l); tracers.push({ l, t: 0 });
}
let tracerI = 0, flashT = 0;
function addTracer(a, bx, by, bz) {
  const tr = tracers[tracerI++ % tracers.length], p = tr.l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, bx, by, bz); p.needsUpdate = true; tr.t = 0.09;
}
const facingYaw = () => query.has('fixface') ? Math.atan2(-1, -1) : Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));   // fixface: debug, keeps the player turned while the camera orbits
function toast(t) { toastEl.textContent = t; toastEl.style.opacity = 1; clearTimeout(toast._t); toast._t = setTimeout(() => { toastEl.style.opacity = 0; }, 1500); }
function addAmmo(n) { const before = reserve; reserve = Math.min(GUN.reserveMax, reserve + n); if (reserve > before) toast('+' + (reserve - before) + ' AMMO'); }

function tryAttack() {
  if (!alive || cut.active || paused || hidden || roll.t > 0 || choke.n || atkCd > 0 || transitioning) return;
  const yaw = facingYaw(), tk = npc.takedownTarget(Pst, yaw);
  if (tk) return startChoke(tk);
  if (npc.punchTarget(Pst, yaw, FIST.range) || (world === 'city' && tutorial.bagNear(Pst, yaw, FIST.range)) || (boss && boss.alive && boss.inReach(Pst, yaw, FIST.range))) return startPunch(yaw);
  fire();
}
function startPunch(yaw) {
  atkKind = 'punch'; atkT = FIST.dur; atkCd = FIST.cd; atkHit = false; atkYaw = yaw; punchSide = -punchSide;
  player.rotation.y = yaw; Pst.attackedAt = npc.time; sfx.swing();
}
function resolvePunch() {
  const o = { range: FIST.range, half: 0.95, dmg: FIST.dmg };
  const hits = npc.meleeHit(Pst, atkYaw, { ...o, src: 'fist' });
  if (world === 'city' && tutorial.hitDummies(Pst, atkYaw, FIST.range, 1.0)) hits.push({});
  if (boss && boss.alive && boss.hitTest(Pst, atkYaw, { ...o, dmg: FIST.bossDmg })) hits.push({});
  if (hits.length) { sfx.punch(); fx.emit(player.position.x + Math.sin(atkYaw) * 1.6, 1.3, player.position.z + Math.cos(atkYaw) * 1.6, 8, 0xfff0c0, 3, 0.25); }
}
function startChoke(n) {
  choke.n = n; choke.t = 0; choke.dur = n.cfg.choke * (n.censor ? 1.5 : 1); n.beginChoke();
  atkT = 0; atkKind = 'choke'; Pst.attackedAt = npc.time;
  if (n.type === 'robot') sfx.zap(0.9); else sfx.choke();
  npc.makeNoise(n.x, n.z, 5);   // the struggle is heard by anyone close
}
function cancelChoke() { if (!choke.n) return; const n = choke.n; choke.n = null; n.endChoke(Pst, false); }
function updateChoke(dt) {
  const n = choke.n; choke.t += dt;
  const bx = n.x - Math.sin(n.yaw) * 0.85, bz = n.z - Math.cos(n.yaw) * 0.85, k = Math.min(1, dt * 9);
  player.position.x += (bx - player.position.x) * k; player.position.z += (bz - player.position.z) * k; collide(player.position);
  player.rotation.y = Math.atan2(n.x - player.position.x, n.z - player.position.z);
  if (choke.t >= choke.dur) { choke.n = null; atkCd = 0.3; n.endChoke(Pst, true); }
}
function startReload() { if (reloadT > 0 || mag >= GUN.mag || reserve <= 0 || !alive) return; reloadT = GUN.reload; sfx.reload(); }
function finishReload() { const take = Math.min(GUN.mag - mag, reserve); mag += take; reserve -= take; }
function fire() {
  if (reloadT > 0) return;
  if (mag <= 0) { if (reserve > 0) startReload(); else { sfx.dry(); toast('NO AMMO'); atkCd = 0.3; } return; }
  mag--; atkCd = GUN.cd; gunUp = 1.8; atkKind = 'shoot'; atkT = 0.12; atkYaw = facingYaw(); player.rotation.y = atkYaw; Pst.attackedAt = npc.time; gunNoiseT = 0.35;
  camera.getWorldPosition(_o); camera.getWorldDirection(_d);
  const r = npc.hitscan(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, GUN.range, Math.max(0.6, cam.dist - 0.4));
  let endT = r.t, target = r.n;
  if (world === 'city') { const bt = tutorial.shootDummies(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, endT); if (bt >= 0) { endT = bt; target = null; } }
  if (boss && boss.alive) { const bs = boss.shotTest(_o, _d, endT, GUN.dmg); if (bs >= 0) { endT = bs; target = null; } }
  if (target) {
    target.takeHit(target.censor ? 110 : 9999, _d.x, _d.z, 'gun', Pst, r.head);   // one shot removes anything except the Chief Censor
  } else if (r.wall && endT === r.t) fx.emit(r.x, r.y, r.z, 6, 0xffd9a0, 3, 0.25);
  const mz = muzzle ? muzzle.getWorldPosition(_mz) : _mz.set(player.position.x, 1.3, player.position.z);
  addTracer(mz, _o.x + _d.x * endT, _o.y + _d.y * endT, _o.z + _d.z * endT);
  sfx.shot(); flashT = 0.06; shake = Math.max(shake, 0.12); cam.pitch = Math.min(PITCH_MAX, cam.pitch + 0.012);
  director.onShot(); npc.makeNoise(Pst.x, Pst.z, GUN.noise * (1 + 0.5 * director.gunWise));
}

// ---------- hiding ----------
function enterHide(spot) {
  if (hidden || !alive || roll.t > 0 || choke.n || cut.active) return;
  hidden = true; hideSpot = spot; hideT = 0; atkT = 0; vy = 0; player.visible = false;
  player.position.set(spot.x, 0, spot.z); Pst.hidden = true; Pst.hideId = spot.id; Pst.noise = 0;
  cam.yaw = spot.yaw + Math.PI; cam.pitch = 0.05;
  director.onHide(spot.id); stalker.notifyHide(spot, Pst);
  for (const n of npc.npcs) if (n.hostile() && n.sees && n.state !== 'ko') n.knowsHide = spot;   // anyone who watched you climb in knows where you are
  setMuffle(true); sfx.thud(0.5); hideOv.classList.add('on');
}
function exitHide() {
  if (!hidden) return;
  hidden = false; player.visible = true; const s = hideSpot; hideSpot = null;
  player.position.set(s.x + Math.sin(s.yaw) * 1.5, 0, s.z + Math.cos(s.yaw) * 1.5); collide(player.position);
  player.rotation.y = s.yaw; cam.yaw = s.yaw + Math.PI; Pst.hidden = false; Pst.hideId = null; invuln = Math.max(invuln, 0.3);
  setMuffle(false); sfx.thud(0.5); hideOv.classList.remove('on');
}
function dropHide() {   // world change / death: leave without a trace
  if (!hidden) return;
  hidden = false; hideSpot = null; player.visible = true; Pst.hidden = false; Pst.hideId = null; setMuffle(false); hideOv.classList.remove('on');
}
function pullOut(spot, who, big) {   // somebody opened the hiding place
  if (!hidden) return;
  exitHide();
  hurtPlayer(big ? 40 : 10, who.x, who.z, big ? 'stalker' : 'guard', true);
  shake = Math.max(shake, 0.6);
  if (who.type) who.startChase(Pst);
}

function hurtPlayer(dmg, fromX, fromZ, cause = 'guard', force = false) {
  if (!alive || (!force && (invuln > 0 || roll.t > 0)) || cut.active || transitioning) return;
  if (hidden && !force) return;
  if (choke.n) cancelChoke();
  hp = Math.max(0, hp - dmg); invuln = 0.6; hurtFlash = 0.35; shake = Math.max(shake, 0.45); sfx.hurt();
  const dx = player.position.x - fromX, dz = player.position.z - fromZ, d = Math.hypot(dx, dz) || 1;
  player.position.x += dx / d * 0.5; player.position.z += dz / d * 0.5;
  vignette.classList.add('hurt'); setTimeout(() => vignette.classList.remove('hurt'), 120);
  if (hp <= 0) {
    alive = false; deathT = 0; atkT = 0; reloadT = 0; deathEl.classList.add('on'); sfx.ko();
    deathTitle.textContent = cause === 'stalker' ? 'CONSUMED' : 'ARRESTED';
    deathSub.textContent = cause === 'stalker' ? 'The Dictator found Prisoner_0.' : 'Prisoner_0 has been recaptured.';
  }
}
function respawn() {
  hp = 100; alive = true; invuln = 2; deathEl.classList.remove('on'); vignette.classList.remove('spotted');
  player.rotation.set(0, 0, 0, 'YXZ'); vy = 0; choke.n = null; atkT = 0; reloadT = 0; gunUp = 0; dropHide(); player.scale.set(1, 1, 1);
  mag = GUN.mag; reserve = Math.max(reserve, 12);
  if (world === 'tower') { enterFloor(floorIdx, { respawn: true }); return; }
  player.position.set(city.spawn.x, 0, city.spawn.z); player.rotation.y = Math.atan2(-1, -1);
  cam.yaw = Math.PI / 4; cam.pitch = 0.5; npc.reset(); stalker.despawn(); cityAlarmT = 0;
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
const AP = {   // procedural arm poses (radians) on top of the animation
  gun: { rx: 0, rz: 0, lx: 0, lz: 0, fx: 0.12 },
  choke: { rx: 0, rz: 0, lx: 0, lz: 0 },
};
function updatePlayer(dt) {
  if (!alive) {   // collapse
    deathT += dt; player.rotation.x += (-Math.PI / 2 - player.rotation.x) * Math.min(1, dt * 5); mixer?.update(dt * 0.2);
    atkT = 0; speedNow = 0; return;
  }
  const sneak = keys.has('shift');
  roll.cd -= dt; atkCd -= dt; invuln -= dt; gunUp -= dt; gunNoiseT -= dt;
  if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) finishReload(); }
  if (hidden) { updateHidden(dt); return; }
  sprinting = false; moving = false;
  let speed = 0, dir = null, anim = 'idle', ts = 1;
  const chokeOn = !!choke.n;
  if (roll.t > 0) { roll.t -= dt; speed = SPEED.dash; dir = { x: roll.dx, y: roll.dz }; anim = 'run'; ts = 1.7; }
  else if (!chokeOn) {
    const d = inputDir();
    if (d.lengthSq() > 0) {
      dir = d; moving = true;
      if (sneak) { speed = SPEED.sneak; anim = 'walk'; ts = 0.75; }
      else if (keys.has('control')) { speed = SPEED.sprint; anim = 'run'; ts = 1.3; sprinting = true; }
      else { speed = SPEED.run; anim = 'run'; }
    }
  }
  if (freezeAtk != null) { atkKind = freezeKind; atkT = FIST.dur * (1 - freezeAtk) + dt; gunUp = freezeKind === 'shoot' ? 1 : 0; }
  if (chokeOn) updateChoke(dt);
  if (atkT > 0) {
    atkT -= dt;
    if (atkKind === 'punch') {
      const prog = 1 - atkT / FIST.dur;
      if (!atkHit && prog >= FIST.hitAt) { atkHit = true; resolvePunch(); }
      speed *= 0.4;   // slowed while swinging
    } else if (atkKind === 'shoot') speed *= 0.6;
  }
  if (dir && speed > 0) {
    player.position.x += dir.x * speed * dt; player.position.z += dir.y * speed * dt;
    collide(player.position);
    if (arenaR) { const r = Math.hypot(player.position.x, player.position.z); if (r > arenaR) { player.position.x *= arenaR / r; player.position.z *= arenaR / r; } }
    if (roll.t <= 0 && !(atkT > 0 && atkKind === 'punch')) {
      const targetRot = gunUp > 0 ? facingYaw() : Math.atan2(dir.x, dir.y);   // after a shot the player keeps facing where the crosshair points
      let diff = targetRot - player.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      player.rotation.y += diff * Math.min(1, dt * 14);
    }
  } else if (gunUp > 0 && !chokeOn) {
    let diff = facingYaw() - player.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); player.rotation.y += diff * Math.min(1, dt * 14);
  }
  speedNow = speed;
  if (jumpQueued && grounded && roll.t <= 0 && !chokeOn) { vy = JUMP_V; grounded = false; sfx.jump(); }
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
  poseArms(dt);
  // what the NPCs can perceive
  Pst.x = player.position.x; Pst.y = player.position.y; Pst.z = player.position.z; Pst.alive = alive;
  Pst.sneaking = sneak && moving; Pst.sprinting = sprinting; Pst.dashing = roll.t > 0; Pst.moving = moving; Pst.hidden = false;
  let noise = roll.t > 0 ? 12 : sprinting ? 15 : moving ? (sneak ? 3.5 : 9) : 0;
  if (chokeOn) noise = Math.max(noise, 3);
  if (atkT > 0 && atkKind === 'punch') noise = Math.max(noise, 9);
  if (gunNoiseT > 0) noise = Math.max(noise, 16);
  Pst.noise = noise;
}
function updateHidden(dt) {
  hideT += dt; speedNow = 0; mixer?.update(0); jumpQueued = false;
  if (hideT > 0.55 && (keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') || keys.has('arrowup') || keys.has('arrowdown') || keys.has('arrowleft') || keys.has('arrowright'))) { exitHide(); return; }
  Pst.x = player.position.x; Pst.y = 0; Pst.z = player.position.z; Pst.alive = alive; Pst.hidden = true; Pst.sneaking = false; Pst.sprinting = false; Pst.dashing = false; Pst.moving = false; Pst.noise = 0;
}
// arms: pistol raised after a shot, punch, choke. Axis-independent: each arm bone is turned in WORLD space so that
// it points where we want, whatever the rig's local axes are.
const _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vt = new THREE.Vector3();
function aimBone(bone, child, tx, ty, tz, k = 1, isPoint = false) {
  if (!bone || !child || k <= 0) return;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_va); child.getWorldPosition(_vb); _vb.sub(_va).normalize();
  _vt.set(tx, ty, tz); if (isPoint) _vt.sub(_va); _vt.normalize();
  _qa.setFromUnitVectors(_vb, _vt); if (k < 1) _qa.slerp(_qi.identity(), 1 - k);
  bone.parent.getWorldQuaternion(_qp); bone.getWorldQuaternion(_qw).premultiply(_qa);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateWorldMatrix(false, true);
}
function poseArms(dt) {
  const B = bones; if (!B.RightArm || !B.LeftArm) return;
  const ry = player.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry), lx = Math.cos(ry), lz = -Math.sin(ry);   // forward and the character's LEFT
  if (choke.n) {
    const n = choke.n, k = Math.min(1, choke.t / 0.2);
    // hands on both sides of the victim's neck, forearms pulled in
    aimBone(B.RightArm, B.RightForeArm, n.x - lx * 0.22, 1.5, n.z - lz * 0.22, k, true); aimBone(B.RightForeArm, B.RightHand, n.x - lx * 0.12, 1.55, n.z - lz * 0.12, k, true);
    aimBone(B.LeftArm, B.LeftForeArm, n.x + lx * 0.22, 1.5, n.z + lz * 0.22, k, true); aimBone(B.LeftForeArm, B.LeftHand, n.x + lx * 0.1, 1.55, n.z + lz * 0.1, k, true);
    B.Spine1 && (B.Spine1.rotation.x += 0.15 * k);
  } else if (atkT > 0 && atkKind === 'punch') {
    const p = 1 - atkT / FIST.dur, a = p < 0.25 ? -p / 0.25 : p < 0.5 ? -1 + 2.4 * (p - 0.25) / 0.25 : 1.4 * (1 - (p - 0.5) / 0.5);
    const w = Math.max(0, Math.min(1, (a + 1) / 2.4)), side = punchSide > 0 ? -1 : 1;   // right fist: side -1 (away from the character's left)
    const dx = (-0.5 + 1.5 * w) * fx + side * lx * 0.1, dy = -0.5 + 0.6 * w, dz = (-0.5 + 1.5 * w) * fz + side * lz * 0.1;
    const arm = punchSide > 0 ? B.RightArm : B.LeftArm, fore = punchSide > 0 ? B.RightForeArm : B.LeftForeArm, hand = punchSide > 0 ? B.RightHand : B.LeftHand;
    aimBone(arm, fore, dx, dy, dz); aimBone(fore, hand, dx, dy * 0.5, dz);
    B.Spine1 && (B.Spine1.rotation.y += -a * 0.3 * punchSide);
  } else if (gunUp > 0 || reloadT > 0) {
    const k = reloadT > 0 ? 0.7 : Math.min(1, gunUp / 0.25), up = reloadT > 0 ? -0.35 : 0.04;
    aimBone(B.RightArm, B.RightForeArm, fx, up, fz, k); aimBone(B.RightForeArm, B.RightHand, fx, up, fz, k);   // arm and forearm stretched toward the target
    aimBone(B.LeftArm, B.LeftForeArm, fx - lx * 0.4, up - 0.05, fz - lz * 0.4, k); aimBone(B.LeftForeArm, B.LeftHand, fx - lx * 0.55, up - 0.05, fz - lz * 0.55, k);   // support hand
  }
  if (flashT > 0 && flash) { flashT -= dt; flash.material.opacity = Math.max(0, flashT / 0.06); } else if (flash) flash.material.opacity = 0;
}
// how brightly the player is lit by the world's lights (shadows hide you)
function computeLit() {
  let sum = 0; const px = player.position.x, pz = player.position.z;
  for (const s of lightSources) {
    const dx = s.x - px, dz = s.z - pz, dy = (s.y ?? 3) - 1.2, d = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (d >= s.dist) continue; const f = 1 - d / s.dist; sum += f * f * s.intensity / 45;
  }
  return Math.min(1, 0.3 + sum);   // the player's own light always shows a little
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
  if (gunUp > 0) d -= 0.5;
  if (roll.t > 0) d += 0.6; else if (sprinting) d += 0.8; else if (speedNow > 5) d += 0.4;
  if (npc.chasers > 0 || (stalker.active && stalker.state === 'hunt')) d += 0.5;   // pull back when hunted
  return d;
}
function updateCamera(dt) {
  if (hidden && hideSpot) {   // looking out through the gap of the hiding place
    const base = hideSpot.yaw + Math.PI;
    let diff = Math.atan2(Math.sin(cam.yaw - base), Math.cos(cam.yaw - base)); diff = Math.max(-1.0, Math.min(1.0, diff)); cam.yaw = base + diff;
    cam.pitch = Math.max(-0.35, Math.min(0.45, cam.pitch));
    const cp = Math.cos(cam.pitch);
    camera.position.set(hideSpot.x + Math.sin(hideSpot.yaw) * 0.3, 1.45, hideSpot.z + Math.cos(hideSpot.yaw) * 0.3);
    if (Math.abs(camera.fov - 52) > 0.01) { camera.fov = 52; camera.updateProjectionMatrix(); cam.fov = 52; }
    if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake * 0.3; camera.position.y += (Math.random() - 0.5) * shake * 0.3; shake *= Math.exp(-dt * 9); }
    camera.lookAt(camera.position.x - Math.sin(cam.yaw) * cp * 50, camera.position.y + Math.sin(cam.pitch) * 50, camera.position.z - Math.cos(cam.yaw) * cp * 50);
    return;
  }
  cam.dist += (targetDist() - cam.dist) * (1 - Math.exp(-dt * 4));
  const fovT = 60 + (sprinting ? 7 : speedNow > 5 ? 3 : 0) + (roll.t > 0 ? 3 : 0) - (gunUp > 0 ? 4 : 0);
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
  vignette.classList.toggle('dread', stalker.active && stalker.dread > 0.55);
  if (boss && boss.alive) { bossBar.style.display = 'block'; bossFill.style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%'; bossName.textContent = boss.name; }
  else if (!boss) bossBar.style.display = 'none';
  ammoEl.textContent = reloadT > 0 ? 'RELOADING' : mag + ' / ' + reserve; ammoWrap.classList.toggle('low', reloadT <= 0 && mag + reserve <= 4);
  // how visible the player is right now: sneaking, standing still and shadows lower it
  visNow = hidden ? 0 : Math.min(1, (Pst.sneaking ? 0.45 : Pst.sprinting ? 1.2 : 1) * (moving || sprinting || roll.t > 0 ? 1 : 0.75) * (0.55 + 0.45 * lit) / 1.2);
  visFill.style.width = Math.max(4, visNow * 100) + '%';
  visTxt.textContent = hidden ? 'HIDDEN' : visNow < 0.3 ? 'IN SHADOW' : visNow < 0.6 ? 'CONCEALED' : visNow < 0.85 ? 'VISIBLE' : 'EXPOSED';
}

// ---------- debug overrides ----------
let freezeAtk = query.has('freezeatk') ? +query.get('freezeatk') : null;
const freezeKind = query.get('pose') || 'punch';
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
let doorPortal = null;
const doorGroup = new THREE.Group(); scene.add(doorGroup);
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1416, metalness: 0.7, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.6, 1.3), dark); p.position.set(s * 2.7, 2.8, 9.5); p.castShadow = true; doorGroup.add(p);
    cityColliders.push({ minX: s * 2.7 - 0.45, maxX: s * 2.7 + 0.45, minZ: 8.85, maxZ: 10.15, h: 5.6 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.0, 1.3), dark); lintel.position.set(0, 6.1, 9.5); doorGroup.add(lintel);
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 5.6), new THREE.MeshBasicMaterial({ color: 0xff6a1a })); portal.position.set(0, 2.8, 8.95); doorGroup.add(portal); doorPortal = portal; portal.material.color.setHex(0x3a1010);   // dark while the tower is sealed
  const eyeSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false })); eyeSp.scale.set(3.4, 1.7, 1); eyeSp.position.set(0, 7.5, 9.6); doorGroup.add(eyeSp);
  cityLights.push({ x: 0, y: 3, z: 11.2, color: 0xff7a2a, intensity: 95, dist: 22 });
}
const doorInteract = { x: 0, z: 11.4, r: 3.4, type: 'door', text: () => (relaysDone() < 3 ? `TOWER SEALED (${relaysDone()}/3 RELAYS)` : 'E: ENTER THE TOWER') };

// ---------- the Iris relays: sabotage all three to break the seal on the tower ----------
const relays = [];
const relaysDone = () => relays.filter((r) => r.done).length;
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1416, metalness: 0.7, roughness: 0.4 });
  const names = ['RESIDENTIAL RELAY', 'MARKET RELAY', 'INDUSTRIAL RELAY'];
  [[-58.5, -58.5], [71.5, -58.5], [-58.5, 71.5]].forEach(([x, z], i) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.1, 10), dark); base.position.y = 0.55; g.add(base);
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 5.5, 8), dark); pylon.position.y = 3.6; g.add(pylon);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); top.position.y = 6.6; g.add(top);
    const eyeSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false })); eyeSp.scale.set(1.6, 0.8, 1); eyeSp.position.y = 7.6; g.add(eyeSp);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 120, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 60; g.add(beam);
    cityColliders.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.9, maxZ: z + 0.9, h: 6 });
    const lightSrc = { x, y: 4, z, color: 0xff3a1a, intensity: 70, dist: 18 }; cityLights.push(lightSrc);
    const r = { x, z, i, name: names[i], done: false, g, top, beam, eyeSp, lightSrc };
    r.it = { x, z, r: 2.8, type: 'relay', relay: r, text: 'HOLD E: SABOTAGE THE RELAY' };
    relays.push(r);
    cityNpc.add('guard', x + 1.7, z - 1.7, { post: true }); cityNpc.add('guard', x - 1.7, z + 1.7, { post: true });
    if (i !== 0) cityNpc.add('robot', x + 5.5, z, { post: true });
  });
}
const cityInteractables = [doorInteract, ...relays.map((r) => r.it)];
interactables = cityInteractables;
function completeRelay(r) {
  r.done = true; holdProg = 0; holdWrap.style.display = 'none'; r.beam.visible = false; r.top.material.color.setHex(0x222222); r.eyeSp.visible = false; r.lightSrc.intensity = 0;
  sfx.ko(1); shake = Math.max(shake, 0.5); fx.emit(r.x, 3, r.z, 50, 0xffa040, 8, 0.9); npc.makeNoise(r.x, r.z, 26); addAmmo(4);
  const n = relaysDone(), look = new THREE.Vector3(r.x, 0, r.z); towerObj.setOverride(look); setTimeout(() => towerObj.setOverride(null), 3500);
  if (n === 1) say('RELAY LOST. THE IRIS TURNS ITS GAZE.', 3.6);
  else if (n === 2) say('Something inside the tower answers.', 3.6, false);
  else { say('THE SEAL IS BROKEN. THE IRIS IS AWAKE.', 4); doorPortal && doorPortal.material.color.setHex(0xff6a1a); }
  refreshObjective();
}

// ---------- world switching: city <-> tower floors <-> boss arena ----------
const promptEl = $('prompt'), holdWrap = $('holdwrap'), holdFill = $('holdfill'), fadeEl = $('fade'), bossBar = $('bossbar'), bossFill = $('bossfill'), bossName = $('bossname'), objEl = $('objective'), objMainEl = $('objmain'), objSubEl = $('objsub'), objDistEl = $('objdist'), endEl = $('endcard');
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
// the current objective: a headline, a hint, and the places to mark (the primary one also gets the route line)
function objectiveNow() {
  const T = [];
  if (world === 'city') {
    const left = relays.filter((r) => !r.done), n = relaysDone();
    if (left.length) {
      const near = left.reduce((a, b) => (Math.hypot(a.x - Pst.x, a.z - Pst.z) <= Math.hypot(b.x - Pst.x, b.z - Pst.z) ? a : b));
      for (const r of left) T.push({ id: 'relay' + r.i, x: r.x, z: r.z, y: 8.4, label: r.name, primary: r === near });
      if (zoneCur === 'prison') return { main: 'ESCAPE DETENTION SECTOR 7', sub: `Follow the cyan route out through the gate. Then sabotage the 3 Iris relays (${n}/3) to break the tower seal.`, T };
      return { main: `SABOTAGE THE IRIS RELAYS  ${n}/3`, sub: 'Follow the cyan route to the nearest relay and HOLD E there. Each relay is guarded.', T };
    }
    T.push({ id: 'door', x: doorInteract.x, z: doorInteract.z, y: 4.2, label: 'TOWER ENTRANCE', primary: true });
    return { main: 'ENTER THE IRIS TOWER', sub: 'The seal is broken. Go through the gate of the security ring to the tower door and press E.', T };
  }
  if (floorIdx >= FLOORS.length) {
    if (boss && boss.alive) T.push({ id: 'boss', x: 0, z: 0, y: 5, label: 'THE IRIS', primary: false, noBeam: true });
    return { main: 'DESTROY THE IRIS', sub: 'Keep moving, keep shooting. Fists will not be enough.', T };
  }
  const d = FLOORS[floorIdx], f = floorData, tag = `FLOOR ${floorIdx + 1}/${FLOORS.length}`;
  if (d.lock === 'file' && !flags.file && f && f.file) {
    T.push({ id: 'file', x: f.file.x, z: f.file.z, y: 2.4, label: 'YOUR FILE', primary: true });
    return { main: 'FIND AND DESTROY YOUR FILE', sub: `${tag}. Follow the cyan route to the red-lit file cabinet and HOLD E. The elevator stays locked until then.`, T };
  }
  if (d.lock === 'censor' && !flags.censor) {
    const c = npc.npcs.find((n) => n.censor && n.state !== 'ko');
    if (c) { T.push({ id: 'censor', x: c.x, z: c.z, y: 3.4, label: 'CHIEF CENSOR', primary: true }); return { main: 'DEFEAT THE CHIEF CENSOR', sub: `${tag}. He guards the elevator and takes many hits. Shoot from cover, or choke him from behind.`, T }; }
  }
  if (f) T.push({ id: 'up', x: f.exitElev.x, z: f.exitElev.z, y: 2.4, label: 'ELEVATOR UP', primary: true });
  const last = floorIdx === FLOORS.length - 1;
  return { main: last ? 'TAKE THE ELEVATOR TO THE APEX' : 'TAKE THE ELEVATOR UP', sub: `${tag}. ` + (!flags.file ? 'Your file is in the Records Archive (floor 2).' : last ? 'The Iris is waiting at the top.' : 'Keep climbing. Guards patrol the rooms between.'), T };
}
let objKey = '';
function refreshObjective() {
  const o = objectiveNow();
  guide.setTargets(o.T);
  if (o.main !== objKey) {
    const first = objKey === ''; objKey = o.main; objMainEl.textContent = o.main; objSubEl.textContent = o.sub;
    objEl.classList.remove('flash'); void objEl.offsetWidth; objEl.classList.add('flash');
    if (!first && started) sfx.alert(0.35);
  } else if (objSubEl.textContent !== o.sub) objSubEl.textContent = o.sub;
}
function setCityVisible(v) { for (const r of relays) r.g.visible = v; for (const p of cityPickups) p.mesh.visible = v; tutorial.group.visible = v; city.root.visible = v; towerObj.tower.visible = v; towerObj.eye.visible = v; cityNpc.root.visible = v; doorGroup.visible = v; }
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
  dropHide(); stalker.despawn(); stalkerT = 0; cityAlarmT = 0;
  for (const p of floorPickups) scene.remove(p.mesh); floorPickups = []; pickups = cityPickups;
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
  const f = buildFloor(i, P0); floorData = f; scene.add(f.group); colliders = f.colliders; lightSources = f.lights; guide.setWorld('floor' + i, f.colliders, f.bounds.w / 2);
  npc = new NPCManager(scene, colliders, fx, npcCbs, director);
  npc.custom = true; npc.nodes = f.nodes; npc.droneH = 2.7; npc.droneLow = 1.9; npc.spawnPoint = f.start; npc.models = cityNpc.models;
  for (const s of f.spawn) npc.add(s.type, s.x, s.z, s.opts);
  if (i === 1) setTimeout(() => { if (world === 'tower' && floorIdx === 1) say('Black veins crawl through the walls. Something up here is awake.', 4.2, false); }, 1800);
  setHideSpots(f.hideSpots); addPickups(f.ammo, floorPickups); pickups = floorPickups; stalker.attach(npc);
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
  colliders = boss.colliders; lightSources = boss.lights; arenaR = ARENA_R - 1.2; guide.setWorld(null);
  npc = new NPCManager(scene, colliders, fx, npcCbs, director); npc.custom = true; npc.nodes = []; npc.droneH = 3; npc.droneLow = 2.2; npc.models = cityNpc.models;
  setHideSpots([]); stalker.attach(npc); mag = GUN.mag; reserve = Math.max(reserve, 36);
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
  setCityVisible(true); guide.setWorld('city', cityColliders, EDGE + 2); applyEnv('city'); setMood('city'); interactables = cityInteractables; setHideSpots(cityHideList); pickups = cityPickups; stalker.attach(npc);
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
  if (it.type === 'hide') { enterHide(it.spot); return; }
  if (it.type === 'door') { if (relaysDone() < 3) say('THE TOWER IS SEALED. THE IRIS RELAYS MUST FALL FIRST.', 3, false); else enterFloor(0); }
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
function setHideSpots(list) {
  npc.hideSpots = list;
  hideInteracts = list.map((s) => ({ x: s.x, z: s.z, r: s.r || 2.1, type: 'hide', spot: s, text: 'E: HIDE' }));
}
let relayNoiseT = 0;
function updateInteract(dt) {
  let near = null, bd = 1e9;
  const consider = (it) => { const d = Math.hypot(player.position.x - it.x, player.position.z - it.z); if (d < it.r && d < bd) { bd = d; near = it; } };
  if (!hidden) { for (const it of interactables) consider(it); for (const it of hideInteracts) consider(it); }
  nearInteract = near;
  tkTarget = alive && !hidden && !choke.n && atkCd <= 0 && roll.t <= 0 && !cut.active && !transitioning ? npc.takedownTarget(Pst, facingYaw()) : null;
  const tkText = tkTarget ? (tkTarget.type === 'robot' ? 'LMB: SHUT DOWN' : 'LMB: CHOKE') : null;
  let text = null;
  if (hidden) text = 'E: LEAVE HIDING PLACE';
  else if (near && alive && !cut.active && !transitioning && !((near.type === 'file' && flags.file) || (near.type === 'relay' && near.relay.done))) { text = typeof near.text === 'function' ? near.text() : near.text; if (tkText) text += '   |   ' + tkText; }
  else if (tkText) text = tkText;
  if (!text) { promptEl.style.display = 'none'; holdWrap.style.display = 'none'; holdProg = 0; return; }
  promptEl.textContent = text; promptEl.style.display = 'block';
  const hd = hidden || !near ? 0 : near.type === 'file' && !flags.file ? 1.6 : near.type === 'relay' && !near.relay.done ? 2.6 : 0;
  if (hd > 0) {
    if (holdE) holdProg += dt / hd; else holdProg = Math.max(0, holdProg - dt * 2);
    if (holdE && near.type === 'relay') { relayNoiseT -= dt; if (relayNoiseT <= 0) { relayNoiseT = 0.9; npc.makeNoise(near.x, near.z, 9); fx.emit(near.x, 2.2, near.z, 6, 0xffa040, 3, 0.3); sfx.metal(0.5); } }
    holdWrap.style.display = holdProg > 0 ? 'block' : 'none'; holdFill.style.width = Math.min(100, holdProg * 100) + '%';
    if (holdProg >= 1) { if (near.type === 'file') completeFile(); else completeRelay(near.relay); }
  } else { holdWrap.style.display = 'none'; holdProg = 0; }
}

// ---------- ammo crates ----------
function makeAmmoMesh(x, z) {
  const g = new THREE.Group(), b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.34), ammoMat); b.position.y = 0.2; b.castShadow = true; g.add(b);
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.1), ammoStrip); s.position.y = 0.36; g.add(s);
  g.position.set(x, 0, z); g.rotation.y = Math.random() * 6; scene.add(g); return g;
}
function addPickups(list, bucket) { for (const a of list) bucket.push({ x: a.x, z: a.z, amount: 5, mesh: makeAmmoMesh(a.x, a.z) }); }
function updatePickups(dt, bucket) {
  for (let i = bucket.length - 1; i >= 0; i--) {
    const p = bucket[i]; p.mesh.rotation.y += dt * 0.8;
    if (alive && !hidden && Math.hypot(player.position.x - p.x, player.position.z - p.z) < 1.3 && reserve < GUN.reserveMax) { addAmmo(p.amount); sfx.reload(); scene.remove(p.mesh); bucket.splice(i, 1); }
  }
}

// ---------- start ----------
guide.setWorld('city', cityColliders, EDGE + 2); refreshObjective();
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

let last = performance.now(), fpsAcc = 0, fpsFrames = 0, objT = 0;
let perfT = 0, perfF = 0, perfGood = 0;
function perfTick(dt) {   // keep the game smooth: lower the render resolution (and finally the shadows) when the frame rate drops
  perfT += dt; perfF++;
  if (perfT < 1.5) return;
  const fps = perfF / perfT; perfT = 0; perfF = 0;
  if (fps < 40 && curPR > 0.55) { curPR = Math.max(0.55, curPR - 0.15); renderer.setPixelRatio(curPR); resize(); perfGood = 0; if (curPR < 0.8 && shadowsOn && world === 'city') setShadows(false); }
  else if (fps > 58 && curPR < maxPR && ++perfGood >= 4) { curPR = Math.min(maxPR, curPR + 0.1); renderer.setPixelRatio(curPR); resize(); perfGood = 0; }
  else if (fps <= 58) perfGood = 0;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  if (!paused) {
    perfTick(dt);
    if (cut.active) {
      cut.update(dt); mixer?.update(dt);
      Pst.x = player.position.x; Pst.z = player.position.z; Pst.cutscene = true;
    } else {
      litT -= dt; if (litT <= 0) { litT = 0.2; lit = computeLit(); } Pst.lit = lit;
      updatePlayer(dt);
      updateZone(dt);
      director.update(dt, Pst);
      visitT -= dt; if (visitT <= 0) { visitT = 2.5; if (alive && !hidden) npc.noteVisit(Pst); }
    }
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pv); npc.frustum = _frustum;
    if (world === 'city') { towerObj.update(dt, player.position); tutorial.update(dt); cullTimer -= dt; if (cullTimer <= 0) { cullTimer = 0.25; const px = player.position.x, pz = player.position.z; for (const ch of cityChunks) { const dx = ch.userData.cx - px, dz = ch.userData.cz - pz; ch.visible = dx * dx + dz * dz < 130 * 130; } } }
    npc.update(dt, Pst);
    if (!cut.active) { updateStalkerCtl(dt); stalker.update(dt, Pst); }
    setDread(stalker.active ? Math.min(1, stalker.dread * (hidden ? 1.2 : 1)) : 0); tickDread(dt);
    if (boss && world === 'tower') boss.update(dt, Pst);
    fx.update(dt);
    if (!cut.active) updateInteract(dt); else promptEl.style.display = 'none';
    if (!gameEnded && !(cut.active && boss && boss.phase === 4)) setIntensity(boss && boss.alive ? 0.6 + (boss.phase >= 3 ? 0.35 : 0) : Math.min(1, Math.max(npc.alarm / 70, stalker.active ? stalker.dread : 0)));
    for (const tr of tracers) if (tr.t > 0) { tr.t -= dt; tr.l.material.opacity = Math.max(0, tr.t / 0.09); }
    updatePickups(dt, pickups);
    lightTimer -= dt; if (lightTimer <= 0) { updateLights(); lightTimer = 0.12; }
    moon.position.set(player.position.x - 26, 55, player.position.z + 20);
    moon.target.position.set(player.position.x, 0, player.position.z);
    playerLight.position.set(player.position.x, 2.6, player.position.z);
    if (!cut.active) updateHud(dt);
  }
  if (!cut.active) updateCamera(paused ? 0.0001 : dt);
  if (!paused) {
    guide.setVisible(!cut.active && started && alive);
    objT -= dt; if (objT <= 0) { objT = 0.3; refreshObjective(); }
    if (!cut.active && started) { const dd = guide.update(dt, player.position, cam.yaw, hidden); objDistEl.textContent = dd != null ? Math.round(dd) + ' m' : ''; }
  }
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

if (window.parent !== window) window.parent.postMessage({ type: 'ready' }, '*');
window.__iris = { guide, choke, AP, get gun() { return gun; }, player, camera, cam, camOverride, scene, renderer, cut, hurtPlayer, tryAttack, startRoll, enterFloor, flags, director, stalker, enterHide, exitHide, fire, cityHideList, get npc() { return npc; }, get boss() { return boss; }, get hp() { return hp; }, get floorIdx() { return floorIdx; }, get world() { return world; }, get interactables() { return interactables; }, get gameEnded() { return gameEnded; }, Pst };
