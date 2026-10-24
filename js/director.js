// ---------------------------------------------------------------------------
// The Director watches HOW the player plays and lets the regime adapt (like the alien in Alien: Isolation).
// Guards and the Dictator's hunter read these numbers: every habit you rely on gets answered.
// ---------------------------------------------------------------------------
export class Director {
  constructor(whisper) {
    this.whisper = whisper || (() => {});
    this.hides = 0; this.spots = new Map();            // how often the player hid, and where
    this.takedowns = 0; this.bodiesFound = 0;          // silent kills from behind, bodies the regime found
    this.shots = 0;                                    // gunshots fired
    this.moveT = 0; this.sneakT = 0; this.sprintT = 0; // movement habits
    this.said = new Set(); this.lastWhisper = -99; this.clock = 0;
  }
  get hideWise() { return Math.min(1, this.hides / 4); }
  get vigilance() { return Math.min(1, this.takedowns / 4 + this.bodiesFound * 0.15); }
  get gunWise() { return Math.min(1, this.shots / 8); }
  get ears() { return Math.min(1, this.sprintT / 40 + this.shots * 0.06); }
  get sneakWise() { const r = this.sneakT / Math.max(25, this.moveT); return Math.min(1, Math.max(0, (r - 0.4) / 0.5)); }
  spotCount(id) { return this.spots.get(id) || 0; }

  say(key, text) {
    if (this.said.has(key) || this.clock - this.lastWhisper < 12) return;
    this.said.add(key); this.lastWhisper = this.clock; this.whisper(text);
  }
  onHide(id) {
    this.hides++; this.spots.set(id, this.spotCount(id) + 1);
    if (this.hides === 2) this.say('hide', 'They are checking the places where you hid.');
    if (this.spotCount(id) === 2) this.say('spot', 'It remembers that hiding place.');
  }
  onTakedown() { this.takedowns++; if (this.takedowns === 2) this.say('tk', 'The guards glance over their shoulders more often now.'); }
  onBodyFound() { this.bodiesFound++; this.say('body', 'They found one of the sleepers. The patrols tighten.'); }
  onShot() { this.shots++; if (this.shots === 4) this.say('shot', 'Gunfire carries. They come faster now.'); }
  update(dt, P) {
    this.clock += dt;
    if (P.moving) { this.moveT += dt; if (P.sneaking) this.sneakT += dt; if (P.sprinting) this.sprintT += dt; }
    if (this.sneakT > 40 && this.sneakWise > 0.35) this.say('sneak', 'They look closer into the shadows. Your quiet steps are known.');
    if (this.sprintT > 30) this.say('sprint', 'The walls carry your footsteps.');
  }
}
