// "Latest wins" sender: BLE writes take ~30-100 ms, so UI events (sliders, joystick, face tracking)
// are merged into one pending patch and written as fast as the link allows, never queued up.

function merge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      dst[k] = merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v);
    } else dst[k] = v;
  }
  return dst;
}

export class Coalescer {
  constructor(send, onError = () => {}) {
    this.send = send; this.onError = onError; this.pending = null; this.running = false;
  }

  push(patch) {
    if (!this.pending) this.pending = {};
    // A servo is either positioned (angle/speed) or spinning (rotate), never both.
    for (const [servo, s] of Object.entries(patch)) {
      const p = this.pending[servo];
      if (!p || typeof s !== 'object') continue;
      if ('rotate' in s) { delete p.angle; delete p.speed; }
      if ('angle' in s) delete p.rotate;
    }
    merge(this.pending, patch);
    this._pump();
  }

  clear() { this.pending = null; }

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const batch = this.pending; this.pending = null;
        try { await this.send(batch); } catch (e) { this.onError(e); }
      }
    } finally { this.running = false; }
  }
}
