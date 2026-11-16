// Terminal controller. Open the Dance app on the robot first.
import { StackChanBle, EXPRESSIONS } from '../src/index.js';

const bot = await StackChanBle.connectNode();
let yaw = 0, pitch = 45, step = 10, busy = false;
const faces = Object.keys(EXPRESSIONS);
const colors = ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#ff00ff'];
let ci = 0;

console.log(`connected.
  arrows: head   space: center   n: nod   s: shake   b: blink
  1-${faces.length}: ${faces.map((f, i) => `${i + 1}=${f}`).join(' ')}
  c: next LED color   +/-: step size   q: quit`);

const send = (fn) => async () => {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (e) { console.error('write failed:', e.message); }
  busy = false;
};
const move = () => bot.moveHead({ yaw, pitch, speed: 300 });
const clampYaw = (v) => Math.max(-128, Math.min(128, v));
const clampPitch = (v) => Math.max(5, Math.min(85, v));

const keys = {
  '\u001b[A': send(() => { pitch = clampPitch(pitch + step); return move(); }),
  '\u001b[B': send(() => { pitch = clampPitch(pitch - step); return move(); }),
  '\u001b[C': send(() => { yaw = clampYaw(yaw + step); return move(); }),
  '\u001b[D': send(() => { yaw = clampYaw(yaw - step); return move(); }),
  ' ': send(() => { yaw = 0; pitch = 45; return bot.center(); }),
  n: send(() => bot.nod()),
  s: send(() => bot.shake()),
  b: send(() => bot.blink()),
  c: send(() => bot.setLed(colors[ci++ % colors.length], { duration: 0.3 })),
  '+': () => { step = Math.min(30, step + 5); console.log('step', step); },
  '-': () => { step = Math.max(2, step - 5); console.log('step', step); },
};
faces.forEach((f, i) => { keys[String(i + 1)] = send(() => bot.expression(f)); });

const quit = async () => {
  try { await bot.setLed('#000000'); await bot.expression('neutral'); await bot.center(); } catch {}
  await bot.close();
  process.exit(0);
};

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (k) => {
  if (k === 'q' || k === '\u0003') return quit();
  keys[k]?.();
});
