// Validation/clamping for firmware JSON before it is written over BLE.
// Ranges come from the official app (app/lib/view/popup/motion.dart) and firmware json_helper.cpp.

const int = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

function pick(src, spec) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(spec)) {
    if (src && src[k] !== undefined) {
      const v = int(src[k], lo, hi);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

const FEATURE = { x: [-100, 100], y: [-100, 100], rotation: [-1800, 1800], weight: [0, 100], size: [-100, 100] };
const YAW = { angle: [-1280, 1280], speed: [1, 1000], rotate: [-1000, 1000] };
const PITCH = { angle: [0, 900], speed: [1, 1000], rotate: [-1000, 1000] };

const nonEmpty = (o) => (Object.keys(o).length ? o : null);

export function sanitizeMotion(d) {
  const out = {};
  for (const [key, spec] of [['yawServo', YAW], ['pitchServo', PITCH]]) {
    if (d?.[key] && typeof d[key] === 'object') {
      const s = pick(d[key], spec);
      if ('rotate' in s) { delete s.angle; delete s.speed; }
      if (nonEmpty(s)) out[key] = s;
    }
  }
  return nonEmpty(out);
}

export function sanitizeAvatar(d) {
  const out = {};
  for (const key of ['leftEye', 'rightEye', 'mouth']) {
    if (d?.[key] && typeof d[key] === 'object') {
      const f = pick(d[key], FEATURE);
      if (nonEmpty(f)) out[key] = f;
    }
  }
  return nonEmpty(out);
}

const COLOR = /^#[0-9a-f]{6}$/i;
export function sanitizeRgb(d) {
  const out = {};
  for (const k of ['leftRgbColor', 'rightRgbColor']) {
    if (typeof d?.[k] === 'string' && COLOR.test(d[k])) out[k] = d[k].toLowerCase();
  }
  for (const k of ['leftRgbDuration', 'rightRgbDuration']) {
    const n = Number(d?.[k]);
    if (Number.isFinite(n)) out[k] = Math.min(10, Math.max(0, n));
  }
  return nonEmpty(out);
}

export const SANITIZERS = { motion: sanitizeMotion, avatar: sanitizeAvatar, rgb: sanitizeRgb };
