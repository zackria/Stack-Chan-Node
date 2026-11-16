// Direct Bluetooth LE control of the official StackChan firmware (no server, no token).
// GATT layout from m5stack/StackChan firmware/main/hal/utils/bleprph/bleprph.h.
// Characteristics have no encryption/pairing flags; they accept the same JSON as the server channel:
//   motion  e2e5e5e1-...  {"yawServo":{"angle":300,"speed":150},"pitchServo":{...}}   (angle in 0.1°)
//   avatar  e2e5e5e2-...  {"leftEye":{...},"rightEye":{...},"mouth":{...}}
//   rgb     e2e5e5e4-...  (LED color JSON, see firmware json_helper "leftRgbColor"/"rightRgbColor")
//   config  e2e5e5e3-...  (Wi-Fi/device config — deliberately not exposed here)
// Plain JSON writes (<= MTU-3 bytes) are accepted as-is; larger payloads need the 0xAA55C3 fragment header.

import { EXPRESSIONS } from './expressions.js';
export { EXPRESSIONS };

export const SERVICE = 'e2e5e5e0-1234-5678-1234-56789abcdef0';
export const SERVICE_ALT = 'e2e5e5ff-1234-5678-1234-56789abcdef0';
export const CHR = {
  motion: 'e2e5e5e1-1234-5678-1234-56789abcdef0',
  avatar: 'e2e5e5e2-1234-5678-1234-56789abcdef0',
  rgb: 'e2e5e5e4-1234-5678-1234-56789abcdef0',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const enc = new TextEncoder();
const nodeId = (u) => u.replace(/-/g, '');

export class StackChanBle {
  /** @param {{write(kind:'motion'|'avatar'|'rgb', bytes:Uint8Array):Promise<void>, close():Promise<void>}} link */
  constructor(link) { this.link = link; }

  /** Browser (Web Bluetooth; must be called from a user gesture, Chrome/Edge). */
  static async connectWeb() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { services: [SERVICE_ALT] }],
      optionalServices: [SERVICE, SERVICE_ALT],
    });
    const server = await device.gatt.connect();
    let svc;
    try { svc = await server.getPrimaryService(SERVICE); }
    catch { svc = await server.getPrimaryService(SERVICE_ALT); }
    const chars = {};
    for (const [k, u] of Object.entries(CHR)) chars[k] = await svc.getCharacteristic(u);
    return new StackChanBle({
      // Characteristics only declare WRITE (not WRITE_NO_RSP), so use a write-with-response.
      write: (kind, bytes) => chars[kind].writeValueWithResponse
        ? chars[kind].writeValueWithResponse(bytes) : chars[kind].writeValue(bytes),
      close: async () => device.gatt.disconnect(),
    });
  }

  /** Node (needs @abandonware/noble and Bluetooth permission for your terminal app). */
  static async connectNode({ timeoutMs = 15000, address, onDisconnect } = {}) {
    const noble = (await import('@abandonware/noble')).default;
    if (noble.state !== 'poweredOn') {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`Bluetooth not ready (state=${noble.state})`)), 5000);
        noble.once('stateChange', (s) => { clearTimeout(t); s === 'poweredOn' ? res() : rej(new Error(`Bluetooth ${s}`)); });
        if (noble.state === 'poweredOn') { clearTimeout(t); res(); }
      });
    }
    const peripheral = await new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(t); noble.removeListener('discover', onFound); noble.stopScanning(); fn(v); };
      const t = setTimeout(() => done(reject, new Error('StackChan not found over Bluetooth. Open the Dance app on the robot (it only advertises while Dance is open) and try again.')), timeoutMs);
      const onFound = (p) => {
        const uuids = (p.advertisement.serviceUuids || []).map((u) => u.toLowerCase());
        const hit = uuids.includes(nodeId(SERVICE)) || uuids.includes(nodeId(SERVICE_ALT))
          || (address && p.address?.toLowerCase() === address.toLowerCase());
        if (hit) done(resolve, p);
      };
      noble.on('discover', onFound);
      noble.startScanning([], false);
    });
    await peripheral.connectAsync();
    if (onDisconnect) peripheral.once('disconnect', onDisconnect);
    // The robot exposes either the main or the alternate (setup-mode) service, never both.
    const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
    const byUuid = Object.fromEntries(characteristics.map((c) => [c.uuid, c]));
    return new StackChanBle({
      write: (kind, bytes) => byUuid[nodeId(CHR[kind])].writeAsync(Buffer.from(bytes), false),
      close: () => peripheral.disconnectAsync(),
    });
  }

  /** Send firmware-format JSON as-is to 'motion' | 'avatar' | 'rgb'. */
  sendRaw(kind, obj) { return this._json(kind, obj); }

  async _json(kind, obj) {
    const bytes = enc.encode(JSON.stringify(obj));
    if (bytes.length > 180) throw new Error('payload too large for a single BLE write');
    await this.link.write(kind, bytes);
  }

  /** Degrees. yaw -128..128 (negative = robot's left), pitch 0..90 (docs advise 5..85). */
  moveHead({ yaw, pitch, speed } = {}) {
    const servo = (d, lo, hi) => {
      const o = { angle: Math.round(clamp(d, lo, hi) * 10) };
      if (speed != null) o.speed = Math.round(clamp(speed, 100, 1000));
      return o;
    };
    const msg = {};
    if (yaw != null) msg.yawServo = servo(yaw, -128, 128);
    if (pitch != null) msg.pitchServo = servo(pitch, 0, 90);
    return this._json('motion', msg);
  }

  setFace({ leftEye, rightEye, mouth } = {}) {
    const msg = {};
    if (leftEye) msg.leftEye = leftEye;
    if (rightEye) msg.rightEye = rightEye;
    if (mouth) msg.mouth = mouth;
    return this._json('avatar', msg);
  }

  /**
   * Eyes/mouth. weight 0..100 (eye openness / mouth openness), size -100..100,
   * rotation in 0.1° units (-1800..1800), x/y offsets -100..100.
   */
  setEyes(opts) { return this.setFace({ leftEye: opts, rightEye: opts }); }
  setMouth(opts) { return this.setFace({ mouth: opts }); }
  blink = async (ms = 150) => { await this.setEyes({ weight: 0 }); await sleep(ms); return this.setEyes({ weight: 100 }); };

  /** Named expressions built from eye/mouth parameters (the firmware has no "emotion" JSON). */
  expression(name) {
    const p = EXPRESSIONS[name];
    if (!p) throw new Error(`unknown expression "${name}" (try: ${Object.keys(EXPRESSIONS).join(', ')})`);
    return this.setFace(p);
  }

  /** LED color as "#RRGGBB" for both sides (or {left, right}). duration in seconds (fade). */
  setLed(color, { duration } = {}) {
    const { left, right } = typeof color === 'string' ? { left: color, right: color } : color;
    const msg = {};
    if (left) msg.leftRgbColor = hex(left);
    if (right) msg.rightRgbColor = hex(right);
    if (duration != null) { msg.leftRgbDuration = duration; msg.rightRgbDuration = duration; }
    return this._json('rgb', msg);
  }

  async nod(times = 2, { center = 45, amp = 15, speed = 400 } = {}) {
    for (let i = 0; i < times; i++) {
      await this.moveHead({ pitch: center + amp, speed }); await sleep(300);
      await this.moveHead({ pitch: center - amp, speed }); await sleep(300);
    }
    return this.moveHead({ pitch: center, speed });
  }

  async shake(times = 2, { amp = 25, speed = 500 } = {}) {
    for (let i = 0; i < times; i++) {
      await this.moveHead({ yaw: amp, speed }); await sleep(300);
      await this.moveHead({ yaw: -amp, speed }); await sleep(300);
    }
    return this.moveHead({ yaw: 0, speed });
  }

  center(speed = 200) { return this.moveHead({ yaw: 0, pitch: 45, speed }); }

  close() { return this.link.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (c) => (c.startsWith('#') ? c : `#${c}`);
