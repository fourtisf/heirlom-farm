/**
 * HEIRLOM — audio.
 *
 * Every sound is synthesised through WebAudio. There are no audio assets and
 * there should not be: the whole game ships as procedural output.
 */

const Audio_ = {

  ctx: null, on: true,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } },
  tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
    if (!this.on) return; this.init(); if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), this.ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, this.ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  },
  plant() { this.tone(220, 0.16, 'triangle', 0.09, 60); },
  harvest() { this.tone(523, 0.13, 'sine', 0.1); setTimeout(() => this.tone(784, 0.16, 'sine', 0.08), 70); },
  coin() { this.tone(880, 0.09, 'square', 0.05); setTimeout(() => this.tone(1180, 0.12, 'square', 0.04), 60); },
  breed() { [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.34, 'sine', 0.075), i * 110)); },
  rare() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.09), i * 95)); },
  err() { this.tone(180, 0.16, 'sawtooth', 0.05, -60); },
  ui() { this.tone(660, 0.05, 'sine', 0.045); },
};

export { Audio_ };
