import { EXPRESSIONS, EXPRESSION_META, EMOTION_SEQUENCES } from '../src/expressions.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Robot behaviours the AI can trigger. Everything goes through BleManager.send, which validates and clamps.
 * `emit` tells the web UI what was applied so its preview stays in sync (even when simulating offline).
 */
export function createRobotActions(ble, emit = () => {}) {
  const apply = (kind, data) => {
    if (ble.state === 'connected') {
      const ok = ble.send(kind, data);
      if (ok) emit({ t: 'applied', kind, data });
      return ok;
    }
    emit({ t: 'applied', kind, data });
    return true;
  };
  const head = (yaw, pitch, speed = 350) => apply('motion', {
    yawServo: { angle: Math.round(yaw * 10), speed }, pitchServo: { angle: Math.round(pitch * 10), speed },
  });
  let pose = { yaw: 0, pitch: 45 };
  const moveTo = (yaw, pitch, speed) => { pose = { yaw, pitch }; return head(yaw, pitch, speed); };

  const gestures = {
    async nod() { const p = pose.pitch; for (let i = 0; i < 2; i++) { moveTo(pose.yaw, p + 15, 500); await sleep(350); moveTo(pose.yaw, p - 15, 500); await sleep(350); } moveTo(pose.yaw, p, 400); },
    async shake() { const y = pose.yaw; for (let i = 0; i < 2; i++) { moveTo(y + 25, pose.pitch, 500); await sleep(350); moveTo(y - 25, pose.pitch, 500); await sleep(350); } moveTo(y, pose.pitch, 400); },
    async center() { moveTo(0, 45, 300); },
    async blink() { apply('avatar', { leftEye: { weight: 0 }, rightEye: { weight: 0 } }); await sleep(150); apply('avatar', { leftEye: { weight: 100 }, rightEye: { weight: 100 } }); },
  };

  async function runSequence(seqId) {
    const seq = EMOTION_SEQUENCES[seqId];
    if (!seq) return false;
    for (const step of seq.steps) {
      const face = EXPRESSIONS[step.expression];
      if (face) apply('avatar', face);
      if (step.led) apply('rgb', { leftRgbColor: step.led, rightRgbColor: step.led, leftRgbDuration: 0.3, rightRgbDuration: 0.3 });
      if (step.yaw !== undefined || step.pitch !== undefined) {
        moveTo(clamp(num(step.yaw, pose.yaw), -90, 90), clamp(num(step.pitch, pose.pitch), 5, 85), 400);
      }
      await sleep(step.durationMs || 650);
    }
    return true;
  }

  return {
    runSequence,
    async run(name, args = {}) {
      const connected = ble.state === 'connected';
      switch (name) {
        case 'set_expression': {
          const face = EXPRESSIONS[args.name];
          if (!face) return `unknown expression; use one of ${Object.keys(EXPRESSIONS).join(', ')}`;
          apply('avatar', face);
          return connected ? 'ok' : 'robot not connected (the user can still hear you)';
        }
        case 'move_head':
          moveTo(clamp(num(args.yaw, pose.yaw), -90, 90), clamp(num(args.pitch, pose.pitch), 5, 85));
          return connected ? 'ok' : 'robot not connected (the user can still hear you)';
        case 'gesture': {
          const g = gestures[args.name];
          if (!g) return 'unknown gesture; use nod, shake, center or blink';
          g().catch(() => {}); // runs in the background so the reply is not delayed
          return connected ? 'started' : 'robot not connected (the user can still hear you)';
        }
        case 'set_led': {
          const c = args.color === 'off' ? '#000000' : args.color;
          const ok = apply('rgb', { leftRgbColor: c, rightRgbColor: c, leftRgbDuration: 0.4, rightRgbDuration: 0.4 });
          if (!connected) return 'robot not connected (the user can still hear you)';
          return ok ? 'ok' : 'invalid color, use #rrggbb or "off"';
        }
        case 'simulate_sequence': {
          const seq = EMOTION_SEQUENCES[args.name];
          if (!seq) return `unknown sequence; use one of ${Object.keys(EMOTION_SEQUENCES).join(', ')}`;
          runSequence(args.name).catch(() => {});
          return connected ? 'started' : 'robot not connected (the user can still hear you)';
        }
        default: return `unknown tool ${name}`;
      }
    },
  };
}
