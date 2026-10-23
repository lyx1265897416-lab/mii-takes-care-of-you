// Two audio buses let a score finish fading as the next scene starts.
export class MusicMixer {
  constructor(createAudio = () => new Audio()) {
    this.buses = [createAudio(), createAudio()].map(audio => {
      audio.loop = true; audio.preload = 'auto'; audio.volume = 0;
      return {audio, gain: 0, target: 0};
    });
    this.current = 0; this.key = null; this.muted = false; this.rate = 1;
    this.running = false; this.last = null;
  }
  select(key, src, {restart = false} = {}) {
    if (!src || !key) { this.key = null; this.buses.forEach(b => b.target = 0); return; }
    if (this.key !== key) {
      this.buses[this.current].target = 0;
      this.current = 1 - this.current;
      const b = this.buses[this.current]; b.audio.pause();
      b.audio.src = src; b.audio.currentTime = 0; b.audio.volume = b.gain = 0;
      b.audio.muted = this.muted; b.audio.playbackRate = this.rate;
      this.key = key;
    } else if (restart) this.buses[this.current].audio.currentTime = 0;
    if (this.running) this.buses[this.current].audio.play().catch(() => {});
  }
  play() { this.running = true; if (this.key) this.buses[this.current].audio.play().catch(() => {}); }
  pause() { this.running = false; this.buses.forEach(b => b.audio.pause()); this.last = null; }
  setMuted(value) { this.muted = value; this.buses.forEach(b => b.audio.muted = value); }
  setRate(value) { this.rate = value; this.buses.forEach(b => b.audio.playbackRate = value); }
  tick(now, target) {
    const dt = this.last === null ? 0 : Math.min(.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.buses.forEach((b, i) => {
      b.target = this.running && this.key && i === this.current ? target : 0;
      // Speech ducks quickly; music changes and recovery ease in over ~half a second.
      const tau = b.target < b.gain && i === this.current ? .07 : .22;
      b.gain += (b.target - b.gain) * (1 - Math.exp(-dt / tau));
      b.audio.volume = Math.max(0, Math.min(1, b.gain));
      if (b.target === 0 && b.gain < .001) b.audio.pause();
      else if (b.target > 0 && b.audio.paused && !b.starting) {
        b.starting = true; b.audio.play().catch(() => {}).finally(() => { b.starting = false; });
      }
    });
  }
}
