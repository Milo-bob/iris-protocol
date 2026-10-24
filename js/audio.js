// Tiny synthesized audio (no files): ambient drone, combat sfx, PA voice via speechSynthesis.
let ac = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ambient: two detuned low sines + filtered noise wind
    const amb = ac.createGain(); amb.gain.value = 0.05; amb.connect(master);
    for (const f of [55, 57.3, 82.4]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(amb); o.start(); }
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const ng = ac.createGain(); ng.gain.value = 0.07;
    n.connect(lp); lp.connect(ng); ng.connect(master); n.start();
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lg = ac.createGain(); lg.gain.value = 200; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  } catch (e) { ac = null; }
}

function noise({ dur = 0.15, f = 1000, q = 1, type = 'bandpass', gain = 0.3, sweep = 0, v = 1 }) {
  if (!ac) return;
  const t = ac.currentTime, src = ac.createBufferSource(); src.buffer = noiseBuf;
  const flt = ac.createBiquadFilter(); flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t);
  if (sweep) flt.frequency.linearRampToValueAtTime(Math.max(40, f + sweep), t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(master); src.start(t, Math.random() * 0.5, dur + 0.05);
}
function tone({ f = 440, f2 = null, dur = 0.2, type = 'sine', gain = 0.2, v = 1 }) {
  if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  swing: () => noise({ dur: 0.2, f: 1600, q: 0.8, gain: 0.22, sweep: -1100 }),
  hit: (v = 1) => { noise({ dur: 0.12, f: 260, type: 'lowpass', gain: 0.55, v }); tone({ f: 140, f2: 45, dur: 0.18, gain: 0.45, v }); },
  metal: (v = 1) => { tone({ f: 1900, f2: 900, dur: 0.18, type: 'square', gain: 0.07, v }); noise({ dur: 0.09, f: 3500, q: 2, gain: 0.25, v }); },
  hurt: () => { tone({ f: 200, f2: 70, dur: 0.3, type: 'sawtooth', gain: 0.2 }); noise({ dur: 0.15, f: 400, type: 'lowpass', gain: 0.4 }); },
  alert: (v = 1) => { tone({ f: 880, f2: 520, dur: 0.4, type: 'square', gain: 0.07, v }); },
  zap: (v = 1) => { tone({ f: 1200, f2: 300, dur: 0.22, type: 'sawtooth', gain: 0.08, v }); },
  ko: (v = 1) => { tone({ f: 120, f2: 40, dur: 0.5, gain: 0.35, v }); },
  jump: () => noise({ dur: 0.12, f: 600, q: 0.5, gain: 0.08, sweep: 400 }),
  dash: () => noise({ dur: 0.3, f: 900, q: 0.5, gain: 0.2, sweep: -600 }),
};

// Propaganda voice from the loudspeakers (browser speech synthesis, deep and slow)
export function announce(text) {
  try {
    const s = window.speechSynthesis; if (!s) return;
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = 0.1; u.rate = 0.82; u.volume = 0.9; u.lang = 'en-US';
    const voices = s.getVoices().filter((v) => /en/i.test(v.lang)); if (voices.length) u.voice = voices[0];
    s.cancel(); s.speak(u);
  } catch (e) { /* no speech available */ }
}

// ---------------------------------------------------------------------------
// Generative music (no files): pads, bass pulse, plucks with echo, and drums that fade in with intensity.
// ---------------------------------------------------------------------------
const MOODS = {
  intro:   { bpm: 58,  root: 45, scale: [0, 3, 5, 7, 10], prog: [[0, 7, 12, 15], [-2, 5, 10, 14], [-4, 3, 8, 12], [-5, 2, 7, 10]], pad: 0.9, bass: 0.0, arp: 0.0,  drums: 0.0, boom: true },
  city:    { bpm: 68,  root: 41, scale: [0, 3, 5, 7, 10], prog: [[0, 7, 12, 15], [-4, 3, 8, 12], [-2, 5, 10, 14], [-5, 2, 7, 10]], pad: 0.7, bass: 0.35, arp: 0.18, drums: 0.4 },
  tower:   { bpm: 84,  root: 43, scale: [0, 3, 5, 6, 7, 10], prog: [[0, 7, 12, 15], [1, 8, 13, 16], [-2, 5, 10, 14], [-4, 3, 8, 12]], pad: 0.55, bass: 0.6, arp: 0.3, drums: 0.3 },
  boss:    { bpm: 118, root: 37, scale: [0, 1, 3, 5, 7, 8, 10], prog: [[0, 7, 12, 15], [1, 8, 13, 17], [-2, 5, 10, 13], [-4, 3, 8, 11]], pad: 0.75, bass: 0.9, arp: 0.5, drums: 0.0, always: true },
  victory: { bpm: 64,  root: 48, scale: [0, 2, 4, 7, 9], prog: [[0, 7, 12, 16], [-3, 4, 9, 12], [-5, 2, 7, 11], [-7, 0, 5, 9]], pad: 0.9, bass: 0.0, arp: 0.2, drums: 0.0 },
};
const M = { mood: 'city', variant: 0, intensity: 0, cur: 0, step: 0, next: 0, timer: null, gain: null, delay: null, on: true, duck: 1 };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function startMusic() {
  if (!ac || M.timer) return;
  M.gain = ac.createGain(); M.gain.gain.value = 0.5; M.gain.connect(master);
  M.delay = ac.createDelay(1.0); M.delay.delayTime.value = 0.375; const fb = ac.createGain(); fb.gain.value = 0.38; const wet = ac.createGain(); wet.gain.value = 0.5;
  M.delay.connect(fb); fb.connect(M.delay); M.delay.connect(wet); wet.connect(M.gain);
  M.next = ac.currentTime + 0.15;
  M.timer = setInterval(musicTick, 100);
}
export function setMood(name, variant = 0) { if (M.mood !== name || M.variant !== variant) { M.mood = name; M.variant = variant; M.step = 0; } }
export function setIntensity(v) { M.intensity = Math.max(0, Math.min(1, v)); }
export function duckMusic(on) { M.duck = on ? 0.18 : 1; if (M.gain) M.gain.gain.setTargetAtTime((M.on ? 0.5 : 0) * M.duck, ac.currentTime, 0.15); }
export function toggleMusic() { M.on = !M.on; if (M.gain) M.gain.gain.setTargetAtTime((M.on ? 0.5 : 0) * M.duck, ac.currentTime, 0.2); return M.on; }

function env(g, t, a, hold, r, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r); }
function padVoice(t, notes, dur, level) {
  for (const n of notes) for (const det of [-6, 6]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
    const g = ac.createGain(); env(g, t, dur * 0.35, dur * 0.3, dur * 0.5, level * 0.06);
    o.connect(lp); lp.connect(g); g.connect(M.gain); o.start(t); o.stop(t + dur * 1.2 + 0.2);
  }
}
function bassVoice(t, note, dur, level) {
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(note);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
  const g = ac.createGain(); env(g, t, 0.02, dur * 0.4, dur * 0.6, level * 0.32);
  o.connect(lp); lp.connect(g); g.connect(M.gain); o.start(t); o.stop(t + dur + 0.3);
}
function pluckVoice(t, note, level) {
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(note);
  const g = ac.createGain(); env(g, t, 0.005, 0.02, 0.45, level * 0.14);
  o.connect(g); g.connect(M.gain); g.connect(M.delay); o.start(t); o.stop(t + 0.6);
}
function kickVoice(t, level) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  const g = ac.createGain(); env(g, t, 0.003, 0.02, 0.22, level * 0.55);
  o.connect(g); g.connect(M.gain); o.start(t); o.stop(t + 0.35);
}
function noiseVoice(t, f, type, dur, level) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; const flt = ac.createBiquadFilter(); flt.type = type; flt.frequency.value = f;
  const g = ac.createGain(); env(g, t, 0.002, 0.005, dur, level);
  s.connect(flt); flt.connect(g); g.connect(M.gain); s.start(t, Math.random() * 0.4, dur + 0.1);
}
function boomVoice(t, level) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(30, t + 2.5);
  const g = ac.createGain(); env(g, t, 0.02, 0.1, 2.8, level * 0.5);
  o.connect(g); g.connect(M.gain); o.start(t); o.stop(t + 3.2);
  noiseVoice(t, 180, 'lowpass', 2.2, level * 0.25);
}

function musicStep(t, s) {
  const mood = MOODS[M.mood] || MOODS.city, I = Math.max(M.cur, mood.always ? 0.55 : 0);
  const root = mood.root + (M.mood === 'tower' ? [0, 2, -2, 3, 1][M.variant % 5] : 0);
  const eighth = 60 / mood.bpm / 2, bar = s % 16, chord = mood.prog[Math.floor(s / 16) % mood.prog.length];
  if (bar === 0) padVoice(t, chord.map((n) => root + 12 + n), eighth * 16, mood.pad * (0.7 + 0.5 * I));
  if (mood.boom && bar === 0 && s % 32 === 0) boomVoice(t, 0.9);
  // bass: pulse on beats, 8ths with intensity
  const bn = root + chord[0] - 12 + 12;
  if (mood.bass > 0 && (s % 2 === 0 || (I > 0.5 && Math.random() < 0.7))) bassVoice(t, bn + (bar % 8 === 6 ? 7 : 0), eighth * 1.6, mood.bass * (0.5 + I));
  // arp / plucks
  const arpP = mood.arp * (0.4 + I * 1.4);
  if (arpP > 0 && Math.random() < arpP * (s % 2 === 0 ? 1 : 0.6)) { const sc = mood.scale, n = root + 24 + sc[Math.floor(Math.random() * sc.length)] + (Math.random() < 0.3 ? 12 : 0); pluckVoice(t, n, 0.5 + I); }
  // drums fade in with intensity
  const dr = mood.always ? 1 : I > (1 - mood.drums - 0.2) ? Math.min(1, I * 1.2) : 0;
  if (dr > 0) {
    if (s % 4 === 0) kickVoice(t, dr);
    if (bar % 8 === 4) { noiseVoice(t, 1800, 'bandpass', 0.16, 0.2 * dr); }
    if (I > 0.35 || mood.always) noiseVoice(t, 7000, 'highpass', 0.05, 0.07 * dr);
  }
}
function musicTick() {
  if (!ac || !M.gain) return;
  M.cur += (M.intensity - M.cur) * 0.12;
  const mood = MOODS[M.mood] || MOODS.city, eighth = 60 / mood.bpm / 2;
  while (M.next < ac.currentTime + 0.35) { musicStep(M.next, M.step); M.step++; M.next += eighth; }
}
