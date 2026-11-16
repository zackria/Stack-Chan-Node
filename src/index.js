import { MsgType, encodeFrame, encodeJsonFrame, decodeFrame, payloadText } from './protocol.js';
export { MsgType, encodeFrame, decodeFrame };
export { StackChanBle, EXPRESSIONS } from './ble.js';

// Servo angles on the wire are in 0.1° units (firmware MCP tool multiplies degrees by 10).
// Yaw: -128..128° (negative = robot's left). Pitch: 0..90° (90 = up).
// Official docs recommend keeping pitch within 5..85°.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function resolveWebSocket(impl) {
  if (impl) return impl;
  if (typeof globalThis.WebSocket !== 'undefined' && typeof process === 'undefined') return globalThis.WebSocket;
  try { return (await import('ws')).default; } // Node: supports custom headers
  catch { return globalThis.WebSocket; }
}

/**
 * Client for the StackChan server's WebSocket relay, connecting as an "App".
 *
 * @param {object} opts
 * @param {string} opts.server        e.g. "ws://host:12800" (your self-hosted or official server)
 * @param {string} opts.appId         arbitrary id identifying this client (deviceId param)
 * @param {string} opts.authorization value of the Authorization header (RSA MAC token)
 * @param {Function} [opts.WebSocket] custom WebSocket constructor
 */
export class StackChanClient extends EventTarget {
  constructor({ server, appId = 'js-client', authorization, WebSocket: WS } = {}) {
    super();
    if (!server) throw new Error('server is required');
    this.url = `${server.replace(/\/$/, '')}/stackChan/ws?deviceType=App&deviceId=${encodeURIComponent(appId)}`;
    this.authorization = authorization;
    this._WS = WS;
    this.ws = null;
  }

  async connect() {
    const WS = await resolveWebSocket(this._WS);
    await new Promise((resolve, reject) => {
      // `ws` accepts (url, protocols, {headers}); browsers cannot set headers.
      const ws = this.authorization && WS !== globalThis.WebSocket
        ? new WS(this.url, { headers: { Authorization: this.authorization } })
        : new WS(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = (e) => reject(e.error ?? new Error('WebSocket error'));
      ws.onclose = () => this.dispatchEvent(new Event('close'));
      ws.onmessage = (ev) => this._onMessage(ev.data);
    });
    return this;
  }

  close() { this.ws?.close(); }

  _onMessage(data) {
    if (typeof data === 'string') return;
    const { type, payload } = decodeFrame(data);
    if (type === MsgType.Ping) return this._send(MsgType.Pong);
    const ev = new Event('message');
    ev.msgType = type; ev.payload = payload;
    this.dispatchEvent(ev);
    if (type === MsgType.DeviceOnline) this.dispatchEvent(new Event('deviceonline'));
    if (type === MsgType.DeviceOffline) this.dispatchEvent(new Event('deviceoffline'));
    if (type === MsgType.Jpeg) {
      const f = new Event('frame'); f.jpeg = payload; this.dispatchEvent(f);
    }
  }

  _send(type, payload) {
    if (this.ws?.readyState !== 1) throw new Error('not connected');
    this.ws.send(encodeFrame(type, payload));
  }
  _sendJson(type, obj) {
    if (this.ws?.readyState !== 1) throw new Error('not connected');
    this.ws.send(encodeJsonFrame(type, obj));
  }

  /** Move the head. Degrees; omit an axis to leave it alone. speed ~100-1000 (150 natural). */
  moveHead({ yaw, pitch, speed } = {}) {
    const servo = (deg, lo, hi) => {
      const o = { angle: Math.round(clamp(deg, lo, hi) * 10) };
      if (speed != null) o.speed = Math.round(clamp(speed, 100, 1000));
      return o;
    };
    const msg = {};
    if (yaw != null) msg.yawServo = servo(yaw, -128, 128);
    if (pitch != null) msg.pitchServo = servo(pitch, 0, 90);
    this._sendJson(MsgType.ControlMotion, msg);
  }

  /** Continuous rotation mode for a servo (raw firmware value). */
  rotateServo(axis, rotate) {
    this._sendJson(MsgType.ControlMotion, { [axis === 'yaw' ? 'yawServo' : 'pitchServo']: { rotate } });
  }

  /**
   * Face control. Each feature accepts {x, y, rotation, weight, size} (ints).
   * e.g. setFace({ mouth: { weight: 80 }, leftEye: { weight: 0 } })
   */
  setFace({ leftEye, rightEye, mouth } = {}) {
    const msg = {};
    if (leftEye) msg.leftEye = leftEye;
    if (rightEye) msg.rightEye = rightEye;
    if (mouth) msg.mouth = mouth;
    this._sendJson(MsgType.ControlAvatar, msg);
  }

  /** Play a keyframe dance: raw JSON as used by the app (see firmware animation / json_helper). */
  dance(sequence) { this._send(MsgType.DanceSequence, JSON.stringify(sequence)); }

  sendText(text) { this._send(MsgType.TextMessage, text); }
  startCamera() { this._send(MsgType.StartCamera); }
  stopCamera() { this._send(MsgType.StopCamera); }
  async getDeviceName(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.removeEventListener('message', h); reject(new Error('timeout')); }, timeoutMs);
      const h = (e) => {
        if (e.msgType !== MsgType.GetDeviceName) return;
        clearTimeout(t); this.removeEventListener('message', h); resolve(payloadText(e.payload));
      };
      this.addEventListener('message', h);
      this._send(MsgType.GetDeviceName);
    });
  }
}
