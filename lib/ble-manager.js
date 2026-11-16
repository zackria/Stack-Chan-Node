import { StackChanBle } from '../src/ble.js';
import { Coalescer } from './coalescer.js';
import { SANITIZERS } from './validate.js';

/** Owns the single BLE connection and exposes a small state machine to the web UI. */
export class BleManager {
  constructor(emit) {
    this.emit = emit;           // (statusObject) => void
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.error = null;
    this.bot = null;
    this.queues = {};
    for (const kind of Object.keys(SANITIZERS)) {
      this.queues[kind] = new Coalescer(
        (batch) => this.bot.sendRaw(kind, batch),
        (e) => this._fail(`write failed: ${e.message}`),
      );
    }
  }

  status() { return { t: 'status', state: this.state, error: this.error }; }
  _set(state, error = null) { this.state = state; this.error = error; this.emit(this.status()); }

  async connect() {
    if (this.state !== 'disconnected') return;
    this._set('connecting');
    try {
      this.bot = await StackChanBle.connectNode({
        onDisconnect: () => { this.bot = null; Object.values(this.queues).forEach((q) => q.clear()); this._set('disconnected', 'Robot disconnected (is Dance still open?)'); },
      });
      this._set('connected');
    } catch (e) {
      this.bot = null;
      this._set('disconnected', e.message);
    }
  }

  async disconnect() {
    const bot = this.bot;
    this.bot = null;
    Object.values(this.queues).forEach((q) => q.clear());
    try { await bot?.close(); } catch { /* already gone */ }
    this._set('disconnected');
  }

  /** @returns {boolean} whether the message was accepted */
  send(kind, data) {
    if (this.state !== 'connected' || !this.bot) return false;
    const clean = SANITIZERS[kind]?.(data);
    if (!clean) return false;
    this.queues[kind].push(clean);
    return true;
  }

  _fail(msg) { this.error = msg; this.emit(this.status()); }
}
