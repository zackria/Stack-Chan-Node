import fs from 'node:fs';
import { StackChanBle } from '../src/ble.js';
import { Coalescer } from './coalescer.js';
import { SANITIZERS } from './validate.js';

function findUsbSerialPort() {
  if (process.env.STACKCHAN_SERIAL_PORT && fs.existsSync(process.env.STACKCHAN_SERIAL_PORT)) {
    return process.env.STACKCHAN_SERIAL_PORT;
  }
  try {
    const devs = fs.readdirSync('/dev').filter((f) => /^cu\.usbmodem/i.test(f) || /^ttyACM/i.test(f));
    if (devs.length) return `/dev/${devs[0]}`;
  } catch { /* ignore */ }
  return null;
}

function createUsbSerialBot(portPath, { onDisconnect, onSensor, onSdCard, onDemo }) {
  const fd = fs.openSync(portPath, fs.constants.O_RDWR | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK);
  let closed = false;
  let rxBuf = '';
  const tagMap = { avatar: 'AVATAR', motion: 'MOTION', rgb: 'RGB' };

  // Poll non-blocking RX for @SC:SENSOR:{...}, @SC:SDCARD:{...}, and @SC:DEMO:{...} telemetry
  const rxTimer = setInterval(() => {
    if (closed) return;
    try {
      const chunk = Buffer.alloc(512);
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n > 0) {
        rxBuf += chunk.subarray(0, n).toString('utf8');
        let nl;
        while ((nl = rxBuf.indexOf('\n')) !== -1) {
          const line = rxBuf.slice(0, nl).trim();
          rxBuf = rxBuf.slice(nl + 1);
          if (line.startsWith('@SC:SENSOR:')) {
            try {
              const data = JSON.parse(line.slice(11));
              onSensor?.(data);
            } catch { /* ignore malformed line */ }
          } else if (line.startsWith('@SC:SDCARD:')) {
            try {
              const data = JSON.parse(line.slice(11));
              onSdCard?.(data);
            } catch { /* ignore malformed line */ }
          } else if (line.startsWith('@SC:DEMO:')) {
            try {
              const data = JSON.parse(line.slice(9));
              onDemo?.(data);
            } catch { /* ignore malformed line */ }
          }
        }
        if (rxBuf.length > 2048) rxBuf = rxBuf.slice(-1024);
      }
    } catch (e) {
      if (e.code !== 'EAGAIN' && e.code !== 'EWOULDBLOCK') {
        closed = true;
        clearInterval(rxTimer);
        try { fs.closeSync(fd); } catch { /* ignore */ }
        onDisconnect?.(e);
      }
    }
  }, 80);

  return {
    async sendRaw(kind, obj) {
      if (closed) throw new Error('USB serial closed');
      const tag = tagMap[kind];
      if (!tag) return;
      const line = `@SC:${tag}:${JSON.stringify(obj)}\n`;
      try {
        fs.writeSync(fd, line);
      } catch (e) {
        closed = true;
        clearInterval(rxTimer);
        try { fs.closeSync(fd); } catch { /* ignore */ }
        onDisconnect?.(e);
        throw e;
      }
    },
    async sendCommand(cmd) {
      if (closed) return false;
      try {
        fs.writeSync(fd, `@SC:${cmd}\n`);
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(rxTimer);
      try { fs.closeSync(fd); } catch { /* ignore */ }
    },
  };
}

/** Owns the robot connection (USB Serial when plugged in, or Bluetooth LE wirelessly) and exposes state to the UI. */
export class BleManager {
  constructor(emit) {
    this.emit = emit;            // (statusObject) => void
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.transport = null;       // 'usb-serial' | 'ble' | null
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

  status() {
    const usbPort = findUsbSerialPort();
    return { t: 'status', state: this.state, transport: this.transport, usbPort, error: this.error };
  }
  _set(state, error = null, transport = null) {
    this.state = state;
    this.error = error;
    this.transport = transport;
    this.emit(this.status());
  }

  async connect() {
    if (this.state !== 'disconnected') return;
    this._set('connecting');

    // 1. Prefer direct USB Serial bridge (/dev/cu.usbmodem*) when plugged in so on-device Voice (AI.AGENT) + PC control work simultaneously!
    const usbPort = findUsbSerialPort();
    if (usbPort) {
      try {
        this.bot = createUsbSerialBot(usbPort, {
          onDisconnect: () => {
            this.bot = null;
            Object.values(this.queues).forEach((q) => q.clear());
            this._set('disconnected', 'USB device unplugged');
          },
          onSensor: (data) => {
            this.emit({ t: 'sensor', data });
          },
          onSdCard: (data) => {
            this.lastSdCard = data;
            this.emit({ t: 'sdcard', data });
          },
          onDemo: (data) => {
            this.lastDemo = data;
            this.emit({ t: 'device_demo', data });
          },
        });
        this._set('connected', null, 'usb-serial');
        setTimeout(() => this.bot?.sendCommand?.('SD_INFO'), 400);
        return;
      } catch {
        // Fall through to BLE if USB port cannot be opened
      }
    }

    // 2. Wireless Bluetooth LE connection (when unplugged from USB and Dance app is open)
    try {
      this.bot = await StackChanBle.connectNode({
        timeoutMs: 10000,
        onDisconnect: () => {
          this.bot = null;
          Object.values(this.queues).forEach((q) => q.clear());
          this._set('disconnected', 'Robot disconnected');
        },
      });
      this._set('connected', null, 'ble');
    } catch (e) {
      this.bot = null;
      this._set('disconnected', e.message);
    }
  }

  async toggleDeviceVoice() {
    if (this.state !== 'connected') await this.connect();
    if (this.bot?.sendCommand) {
      return this.bot.sendCommand('CHAT_TOGGLE');
    }
    return false;
  }

  async startDeviceDemo() {
    if (this.state !== 'connected') await this.connect();
    return this.bot?.sendCommand?.('DEMO_START') ?? false;
  }

  async stopDeviceDemo() {
    if (this.state !== 'connected') await this.connect();
    return this.bot?.sendCommand?.('DEMO_STOP') ?? false;
  }

  async toggleDeviceDemo() {
    if (this.state !== 'connected') await this.connect();
    return this.bot?.sendCommand?.('DEMO_TOGGLE') ?? false;
  }

  async formatSdCard() {
    if (this.state !== 'connected') await this.connect();
    return this.bot?.sendCommand?.('SD_FORMAT') ?? false;
  }

  async refreshSdCard() {
    if (this.state !== 'connected') await this.connect();
    return this.bot?.sendCommand?.('SD_INFO') ?? false;
  }

  async saveSdNote(text) {
    if (this.state !== 'connected' || !this.bot?.sendCommand) return false;
    const clean = String(text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 400);
    if (!clean) return false;
    return this.bot.sendCommand(`SD_NOTE:${clean}`);
  }

  async syncSdBrandConfig(obj) {
    if (this.state !== 'connected' || !this.bot?.sendCommand) return false;
    return this.bot.sendCommand(`SD_BRAND:${JSON.stringify(obj)}`);
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
