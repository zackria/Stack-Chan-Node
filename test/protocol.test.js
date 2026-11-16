import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, decodeFrame, MsgType, StackChanClient } from '../src/index.js';

test('frame round-trip', () => {
  const f = encodeFrame(MsgType.ControlMotion, '{"a":1}');
  assert.deepEqual([...f.slice(0, 5)], [4, 0, 0, 0, 7]);
  const { type, payload } = decodeFrame(f);
  assert.equal(type, 4);
  assert.equal(new TextDecoder().decode(payload), '{"a":1}');
});

test('moveHead sends 0.1° units, clamped', () => {
  const sent = [];
  const c = new StackChanClient({ server: 'ws://x' });
  c.ws = { readyState: 1, send: (d) => sent.push(d) };
  c.moveHead({ yaw: 200, pitch: 45, speed: 150 });
  const { payload } = decodeFrame(sent[0]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(payload)),
    { yawServo: { angle: 1280, speed: 150 }, pitchServo: { angle: 450, speed: 150 } });
});

import { StackChanBle } from '../src/ble.js';

function mockBle() {
  const sent = [];
  const bot = new StackChanBle({ write: async (kind, bytes) => sent.push([kind, JSON.parse(new TextDecoder().decode(bytes))]), close: async () => {} });
  return { bot, sent };
}

test('ble moveHead writes motion characteristic in 0.1° units', async () => {
  const { bot, sent } = mockBle();
  await bot.moveHead({ yaw: -200, pitch: 45, speed: 150 });
  assert.deepEqual(sent[0], ['motion', { yawServo: { angle: -1280, speed: 150 }, pitchServo: { angle: 450, speed: 150 } }]);
});

test('ble setLed normalises hex and targets rgb characteristic', async () => {
  const { bot, sent } = mockBle();
  await bot.setLed('ff0000', { duration: 0.5 });
  assert.deepEqual(sent[0], ['rgb', { leftRgbColor: '#ff0000', rightRgbColor: '#ff0000', leftRgbDuration: 0.5, rightRgbDuration: 0.5 }]);
});

test('ble expression + unknown expression', async () => {
  const { bot, sent } = mockBle();
  await bot.expression('happy');
  assert.equal(sent[0][0], 'avatar');
  assert.throws(() => bot.expression('nope'), /unknown expression/);
});

test('ble payloads stay under the single-write limit', async () => {
  const { bot } = mockBle();
  for (const n of Object.keys((await import('../src/ble.js')).EXPRESSIONS)) await bot.expression(n);
});

import { mapFace, readFace, Smoother, DEFAULTS } from '../public/mapping.js';
import { sanitizeMotion, sanitizeAvatar, sanitizeRgb } from '../lib/validate.js';
import { Coalescer } from '../lib/coalescer.js';

test('mapping: neutral face -> open eyes, closed mouth, centered head', () => {
  const t = mapFace({ blend: {}, yaw: 0, pitch: 0 }, DEFAULTS);
  assert.equal(t.leftEye.weight, 100);
  assert.equal(t.mouth.weight, 0);
  assert.deepEqual(t.head, { yaw: 0, pitch: 45 });
});

test('mapping: mirror swaps winks, jaw opens mouth, calibration offsets head', () => {
  const face = { blend: { eyeBlinkRight: 1, jawOpen: 0.7 }, yaw: 20, pitch: -10 };
  const t = mapFace(face, DEFAULTS, { yaw: 10, pitch: -10 });
  assert.equal(t.leftEye.weight, 0);   // user's right eye closed -> screen-left eye closed
  assert.equal(t.rightEye.weight, 100);
  assert.equal(t.mouth.weight, 100);
  assert.ok(Math.abs(t.head.yaw - 12) < 1e-9 && t.head.pitch === 45);
  const flipped = mapFace(face, { ...DEFAULTS, mirror: false });
  assert.equal(flipped.leftEye.weight, 100);
});

test('readFace derives yaw/pitch from the face direction', () => {
  const m = new Array(16).fill(0); m[8] = Math.sin(0.5); m[10] = Math.cos(0.5); m[0] = m[5] = m[15] = 1;
  const f = readFace({ faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.3 }] }], facialTransformationMatrixes: [{ data: m }] });
  assert.ok(Math.abs(f.yaw - 0.5 * 180 / Math.PI) < 1e-6);
  assert.equal(f.blend.jawOpen, 0.3);
  assert.equal(readFace({}), null);
});

test('smoother only emits meaningful changes', () => {
  const s = new Smoother();
  assert.equal(s.step({ mouth: { weight: 0 } }, 0).mouth.weight, 0);
  assert.deepEqual(s.step({ mouth: { weight: 1 } }, 0), {});
  assert.equal(s.step({ mouth: { weight: 50 } }, 0).mouth.weight, 50);
});

test('validate clamps and drops junk', () => {
  assert.deepEqual(sanitizeMotion({ yawServo: { angle: 99999, speed: 0 }, pitchServo: { angle: -5 }, evil: 1 }),
    { yawServo: { angle: 1280, speed: 1 }, pitchServo: { angle: 0 } });
  assert.deepEqual(sanitizeMotion({ yawServo: { rotate: 50, angle: 10 } }), { yawServo: { rotate: 50 } });
  assert.equal(sanitizeMotion({ yawServo: { angle: 'abc' } }), null);
  assert.deepEqual(sanitizeAvatar({ mouth: { weight: 500, x: -500, bogus: 1 }, other: {} }), { mouth: { weight: 100, x: -100 } });
  assert.deepEqual(sanitizeRgb({ leftRgbColor: '#FF0000', rightRgbColor: 'red', leftRgbDuration: 99 }), { leftRgbColor: '#ff0000', leftRgbDuration: 10 });
});

test('coalescer merges bursts and sends latest only', async () => {
  const sent = [];
  const c = new Coalescer(async (b) => { sent.push(structuredClone(b)); await new Promise((r) => setTimeout(r, 20)); });
  c.push({ yawServo: { angle: 1 } });
  c.push({ yawServo: { angle: 2 } });
  c.push({ pitchServo: { angle: 3 } });
  c.push({ yawServo: { angle: 4, speed: 100 } });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(sent, [{ yawServo: { angle: 1 } }, { yawServo: { angle: 4, speed: 100 }, pitchServo: { angle: 3 } }]);
});
