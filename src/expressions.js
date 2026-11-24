// Named faces built from eye/mouth parameters (the firmware has no "emotion" JSON).
// Units: x/y -100..100, rotation 0.1° (-1800..1800), weight 0..100, size -100..100.
// Keep each serialized JSON <= 180 bytes so it fits in a single BLE GATT write.
export const EXPRESSIONS = {
  neutral:   { leftEye: { weight: 100, size: 0, rotation: 0 },       rightEye: { weight: 100, size: 0, rotation: 0 },       mouth: { weight: 0, rotation: 0 } },
  happy:     { leftEye: { weight: 70, size: 10, rotation: 0 },       rightEye: { weight: 70, size: 10, rotation: 0 },       mouth: { weight: 60, rotation: 0 } },
  excited:   { leftEye: { y: -10, weight: 95, size: 35, rotation: -80 }, rightEye: { y: -10, weight: 95, size: 35, rotation: 80 }, mouth: { weight: 85, rotation: 0 } },
  laughing:  { leftEye: { y: -8, weight: 25, size: 15, rotation: 120 },  rightEye: { y: -8, weight: 25, size: 15, rotation: -120 }, mouth: { weight: 95, rotation: 0 } },
  curious:   { leftEye: { x: 15, weight: 100, size: 25, rotation: 0 },   rightEye: { x: 15, weight: 80, size: -5, rotation: -100 }, mouth: { weight: 20, rotation: -60 } },
  thinking:  { leftEye: { x: -20, y: -20, weight: 65, size: 0 },         rightEye: { x: -20, y: -20, weight: 90, size: 10 },        mouth: { x: -12, weight: 10, rotation: 100 } },
  surprised: { leftEye: { weight: 100, size: 40, rotation: 0 },      rightEye: { weight: 100, size: 40, rotation: 0 },      mouth: { weight: 90, rotation: 0 } },
  sleepy:    { leftEye: { y: 10, weight: 20, size: 0, rotation: 0 }, rightEye: { y: 10, weight: 20, size: 0, rotation: 0 }, mouth: { weight: 0, rotation: 0 } },
  sad:       { leftEye: { weight: 60, size: -10, rotation: -150 },   rightEye: { weight: 60, size: -10, rotation: 150 },    mouth: { weight: 0, rotation: 0 } },
  angry:     { leftEye: { weight: 55, size: 10, rotation: 220 },     rightEye: { weight: 55, size: 10, rotation: -220 },    mouth: { weight: 25, rotation: 0 } },
  wink:      { leftEye: { weight: 100, size: 0, rotation: 0 },       rightEye: { weight: 0, size: 0, rotation: 0 },         mouth: { weight: 30, rotation: 0 } },
  love:      { leftEye: { y: -6, weight: 50, size: 30, rotation: -120 }, rightEye: { y: -6, weight: 50, size: 30, rotation: 120 }, mouth: { weight: 50, rotation: 0 } },
  shy:       { leftEye: { x: -18, y: 12, weight: 45, size: -15 },    rightEye: { x: -18, y: 12, weight: 45, size: -15 },    mouth: { weight: 5, rotation: 40 } },
  dizzy:     { leftEye: { y: -12, weight: 85, size: 25, rotation: 300 }, rightEye: { y: 12, weight: 40, size: -20, rotation: -300 }, mouth: { weight: 45, rotation: 150 } },
};

/** Metadata for Expression Mode: synchronized LED mood colors and natural head poses. */
export const EXPRESSION_META = {
  neutral:   { label: 'Neutral',   emoji: '😐', led: '#2b5cff', yaw: 0,   pitch: 45 },
  happy:     { label: 'Happy',     emoji: '😊', led: '#00e676', yaw: 0,   pitch: 52 },
  excited:   { label: 'Excited',   emoji: '🤩', led: '#ffea00', yaw: 8,   pitch: 58 },
  laughing:  { label: 'Laughing',  emoji: '😆', led: '#ff9100', yaw: -6,  pitch: 55 },
  curious:   { label: 'Curious',   emoji: '🧐', led: '#00e5ff', yaw: 22,  pitch: 50 },
  thinking:  { label: 'Thinking',  emoji: '🤔', led: '#aa00ff', yaw: -20, pitch: 58 },
  surprised: { label: 'Surprised', emoji: '😮', led: '#ffffff', yaw: 0,   pitch: 62 },
  sleepy:    { label: 'Sleepy',    emoji: '😴', led: '#ff6d00', yaw: -5,  pitch: 28 },
  sad:       { label: 'Sad',       emoji: '😢', led: '#2979ff', yaw: -12, pitch: 25 },
  angry:     { label: 'Angry',     emoji: '😠', led: '#ff1744', yaw: 0,   pitch: 38 },
  wink:      { label: 'Wink',      emoji: '😉', led: '#f50057', yaw: 14,  pitch: 48 },
  love:      { label: 'Love',      emoji: '😍', led: '#ff4081', yaw: -10, pitch: 52 },
  shy:       { label: 'Shy',       emoji: '😳', led: '#ff80ab', yaw: -25, pitch: 32 },
  dizzy:     { label: 'Dizzy',     emoji: '😵', led: '#76ff03', yaw: 18,  pitch: 40 },
};

/** Pre-choreographed multi-step expression simulation sequences. */
export const EMOTION_SEQUENCES = {
  excited_greeting: {
    label: 'Excited Greeting',
    steps: [
      { expression: 'surprised', led: '#00e5ff', yaw: 0, pitch: 58, durationMs: 600 },
      { expression: 'excited',   led: '#ffea00', yaw: 15, pitch: 55, durationMs: 700 },
      { expression: 'happy',     led: '#00e676', yaw: -15, pitch: 52, durationMs: 700 },
      { expression: 'wink',      led: '#f50057', yaw: 0, pitch: 48, durationMs: 800 },
      { expression: 'happy',     led: '#00e676', yaw: 0, pitch: 45, durationMs: 600 },
    ],
  },
  curious_scan: {
    label: 'Curious Room Scan',
    steps: [
      { expression: 'curious',   led: '#00e5ff', yaw: -35, pitch: 48, durationMs: 900 },
      { expression: 'thinking',  led: '#aa00ff', yaw: 0,   pitch: 58, durationMs: 800 },
      { expression: 'curious',   led: '#00e5ff', yaw: 35,  pitch: 50, durationMs: 900 },
      { expression: 'surprised', led: '#ffffff', yaw: 20,  pitch: 56, durationMs: 600 },
      { expression: 'happy',     led: '#00e676', yaw: 0,   pitch: 45, durationMs: 700 },
    ],
  },
  thinking_eureka: {
    label: 'Deep Thought → Eureka!',
    steps: [
      { expression: 'thinking',  led: '#aa00ff', yaw: -22, pitch: 56, durationMs: 1000 },
      { expression: 'sad',       led: '#2979ff', yaw: -10, pitch: 35, durationMs: 800 },
      { expression: 'thinking',  led: '#aa00ff', yaw: 18,  pitch: 58, durationMs: 900 },
      { expression: 'surprised', led: '#ffffff', yaw: 0,   pitch: 64, durationMs: 550 },
      { expression: 'excited',   led: '#ffea00', yaw: 0,   pitch: 54, durationMs: 900 },
    ],
  },
  laugh_attack: {
    label: 'Laughing Fit',
    steps: [
      { expression: 'happy',     led: '#00e676', yaw: 0,   pitch: 50, durationMs: 450 },
      { expression: 'laughing',  led: '#ff9100', yaw: -8,  pitch: 58, durationMs: 450 },
      { expression: 'excited',   led: '#ffea00', yaw: 8,   pitch: 42, durationMs: 400 },
      { expression: 'laughing',  led: '#ff9100', yaw: -6,  pitch: 58, durationMs: 450 },
      { expression: 'happy',     led: '#00e676', yaw: 0,   pitch: 45, durationMs: 700 },
    ],
  },
  sleepy_nod: {
    label: 'Drifting Off & Waking Up',
    steps: [
      { expression: 'sleepy',    led: '#ff6d00', yaw: -5,  pitch: 34, durationMs: 1100 },
      { expression: 'sleepy',    led: '#331500', yaw: -8,  pitch: 22, durationMs: 1100 },
      { expression: 'surprised', led: '#ffffff', yaw: 0,   pitch: 58, durationMs: 500 },
      { expression: 'shy',       led: '#ff80ab', yaw: 10,  pitch: 42, durationMs: 800 },
      { expression: 'neutral',   led: '#2b5cff', yaw: 0,   pitch: 45, durationMs: 600 },
    ],
  },
};

/** Normalize a partial expression object so every feature has x, y, rotation, weight, size. */
export function fullFace(face) {
  return {
    leftEye:  { x: 0, y: 0, rotation: 0, weight: 100, size: 0, ...face?.leftEye },
    rightEye: { x: 0, y: 0, rotation: 0, weight: 100, size: 0, ...face?.rightEye },
    mouth:    { x: 0, y: 0, rotation: 0, weight: 0, ...face?.mouth },
  };
}

/** Smoothly interpolate between two face objects (t in 0..1), returning a compact BLE-safe patch. */
export function lerpFace(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const fa = fullFace(a), fb = fullFace(b);
  const out = {};
  for (const part of ['leftEye', 'rightEye', 'mouth']) {
    out[part] = {};
    const keys = part === 'mouth' ? ['x', 'y', 'rotation', 'weight'] : ['x', 'y', 'rotation', 'weight', 'size'];
    for (const prop of keys) {
      const v = Math.round(fa[part][prop] + (fb[part][prop] - fa[part][prop]) * ease);
      if ((prop === 'x' || prop === 'y') && v === 0 && fa[part][prop] === 0 && fb[part][prop] === 0) continue;
      out[part][prop] = v;
    }
  }
  return out;
}
