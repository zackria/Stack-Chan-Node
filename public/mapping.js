// Pure functions: MediaPipe face result -> StackChan avatar/head values. No DOM, unit-testable in Node.

export const DEFAULTS = {
  mirror: true,        // robot behaves like a mirror (turns toward the same side of the room as you)
  head: true, eyes: true, mouth: true, gaze: true,
  invertYaw: false, invertPitch: false,
  gain: 1.2,           // head-turn amplification
  smooth: 0.5,         // 0 = raw, 1 = very smooth
  speed: 400,          // servo speed sent with head moves
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

/** Normalise a MediaPipe FaceLandmarkerResult into {blend, yaw, pitch} (degrees, image frame) or null. */
export function readFace(result) {
  const shapes = result?.faceBlendshapes?.[0]?.categories;
  if (!shapes) return null;
  const blend = {};
  for (const c of shapes) blend[c.categoryName] = c.score;
  let yaw = 0, pitch = 0;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m) {
    // column-major 4x4; third column is the direction the face points
    const fx = m[8], fy = m[9], fz = m[10];
    const len = Math.hypot(fx, fy, fz) || 1;
    yaw = Math.atan2(fx / len, fz / len) * DEG;
    pitch = Math.atan2(fy / len, Math.hypot(fx / len, fz / len)) * DEG;
  }
  return { blend, yaw, pitch };
}

const eyeWeight = (blink) => Math.round(100 * (1 - clamp((blink - 0.15) / 0.5, 0, 1)));

/** Raw (unsmoothed) targets for one frame. */
export function mapFace(face, cfg, calib = { yaw: 0, pitch: 0 }) {
  const b = face.blend;
  const g = (k) => b[k] ?? 0;
  const out = {};

  if (cfg.eyes) {
    // In a mirror, the robot's left (screen-left) eye shows the user's right eye.
    const [l, r] = cfg.mirror ? [g('eyeBlinkRight'), g('eyeBlinkLeft')] : [g('eyeBlinkLeft'), g('eyeBlinkRight')];
    out.leftEye = { weight: eyeWeight(l) };
    out.rightEye = { weight: eyeWeight(r) };
  }

  if (cfg.gaze) {
    const toLeft = (g('eyeLookOutLeft') + g('eyeLookInRight')) / 2;   // user's left
    const toRight = (g('eyeLookInLeft') + g('eyeLookOutRight')) / 2;  // user's right
    const h = toRight - toLeft;
    const up = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2;
    const down = (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2;
    const x = Math.round(clamp(h * 45 * (cfg.mirror ? 1 : -1), -100, 100));
    const y = Math.round(clamp((down - up) * 40, -100, 100));
    out.leftEye = { ...out.leftEye, x, y };
    out.rightEye = { ...out.rightEye, x, y };
  }

  if (cfg.mouth) out.mouth = { weight: Math.round(clamp(g('jawOpen') * 1.6, 0, 1) * 100) };

  if (cfg.head) {
    let dyaw = (face.yaw - calib.yaw) * cfg.gain * (cfg.mirror ? 1 : -1) * (cfg.invertYaw ? -1 : 1);
    let dpitch = (face.pitch - calib.pitch) * cfg.gain * (cfg.invertPitch ? -1 : 1);
    out.head = {
      yaw: clamp(dyaw, -90, 90),
      pitch: clamp(45 + dpitch, 5, 85),
    };
  }
  return out;
}

/** Exponential smoothing over the flat set of numeric targets; returns changes worth sending. */
export class Smoother {
  constructor() { this.state = {}; this.sent = {}; }
  reset() { this.state = {}; this.sent = {}; }

  step(targets, smooth) {
    const alpha = 1 - clamp(smooth, 0, 0.95) * 0.9;
    const flat = {};
    for (const [group, obj] of Object.entries(targets)) for (const [k, v] of Object.entries(obj)) flat[`${group}.${k}`] = v;
    const changed = {};
    for (const [key, target] of Object.entries(flat)) {
      const prev = this.state[key] ?? target;
      const v = prev + alpha * (target - prev);
      this.state[key] = v;
      const threshold = key.startsWith('head.') ? 0.8 : 2;
      if (this.sent[key] === undefined || Math.abs(v - this.sent[key]) >= threshold) {
        this.sent[key] = v;
        const [group, k] = key.split('.');
        (changed[group] ??= {})[k] = group === 'head' ? v : Math.round(v);
      }
    }
    return changed;
  }
}
