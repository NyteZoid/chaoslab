// Synthesised impact sounds, one voice per material. No audio files needed (works offline).
const PROFILES = {
  // tones: [frequency Hz, relative gain]; decay in seconds; noise: [filter type, Hz, gain]
  rubber: { tones: [[110, 1]], decay: 0.12, noise: ['lowpass', 500, 0.5], drop: 0.5 },
  wood: { tones: [[320, 0.8], [740, 0.3]], decay: 0.09, noise: ['bandpass', 1400, 0.6] },
  steel: { tones: [[523, 0.6], [1347, 0.4], [2417, 0.25], [3610, 0.12]], decay: 0.7, noise: ['highpass', 3000, 0.2] },
  ice: { tones: [[1760, 0.5], [2640, 0.3]], decay: 0.16, noise: ['highpass', 4000, 0.4] },
  stone: { tones: [[90, 0.7]], decay: 0.1, noise: ['lowpass', 900, 0.9], drop: 0.6 },
  foam: { tones: [], decay: 0.06, noise: ['lowpass', 350, 0.5] },
};

const MIN_SPEED = 0.6;     // m/s; softer touches stay silent
const MAX_PER_SECOND = 14;

export class ImpactSound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.recent = [];
  }

  // Browsers only allow audio after a user gesture; call this from one.
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(material, speed) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || speed < MIN_SPEED) return;
    const now = this.ctx.currentTime;
    this.recent = this.recent.filter((t) => now - t < 1);
    if (this.recent.length >= MAX_PER_SECOND) return;
    this.recent.push(now);

    const p = PROFILES[material] || PROFILES.rubber;
    const level = Math.min(1, speed / 9) ** 1.3;
    const out = this.ctx.createGain();
    out.connect(this.master);

    for (const [freq, gain] of p.tones) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * (0.97 + Math.random() * 0.06), now);
      if (p.drop) osc.frequency.exponentialRampToValueAtTime(freq * p.drop, now + p.decay);
      g.gain.setValueAtTime(gain * level, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }

    if (p.noise) {
      const [type, freq, gain] = p.noise;
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      src.buffer = this.noiseBuffer;
      filter.type = type;
      filter.frequency.value = freq;
      g.gain.setValueAtTime(gain * level, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(p.decay, 0.12));
      src.connect(filter).connect(g).connect(out);
      src.start(now, Math.random() * 0.5);
      src.stop(now + 0.15);
    }
  }

  // Something shattering: a sharp crack followed by a short crumble.
  playBreak(material) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const bright = material === 'ice' || material === 'steel';
    for (const [delay, freq, gain, len] of [[0, bright ? 3500 : 1800, 0.9, 0.06], [0.03, bright ? 2200 : 700, 0.6, 0.25]]) {
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      src.buffer = this.noiseBuffer;
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 0.8;
      g.gain.setValueAtTime(gain, now + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + len);
      src.connect(filter).connect(g).connect(this.master);
      src.start(now + delay, Math.random() * 0.5);
      src.stop(now + delay + len + 0.02);
    }
  }

  _makeNoise() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
