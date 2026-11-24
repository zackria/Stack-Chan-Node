import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StackChanBle, EXPRESSIONS } from '../src/index.js';
import { EXPRESSION_META, EMOTION_SEQUENCES } from '../src/expressions.js';
import { createAdapter, listProviders } from '../lib/llm/providers.js';
import { runTurn } from '../lib/agent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const eq = t.indexOf('=');
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forceSim = process.argv.includes('--simulate');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║       STACK-CHAN CUSTOM CAPABILITY SHOWCASE DEMO         ║');
console.log('╚══════════════════════════════════════════════════════════╝');

let bot = null;
if (!forceSim) {
  try {
    console.log('→ Searching for StackChan over Bluetooth LE (open Dance app on robot)…');
    bot = await StackChanBle.connectNode({ timeoutMs: 5000 });
    console.log('✓ Connected to physical StackChan over Bluetooth LE!');
  } catch (e) {
    console.log(`ℹ BLE hardware not in Dance mode (${e.message})`);
    console.log('→ Continuing in simulated telemetry mode (web UI available via `npm run app`)…');
  }
}

if (!bot) {
  bot = new StackChanBle({
    write: async (kind, bytes) => {
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      console.log(`  [BLE ${kind.padEnd(6)}]`, JSON.stringify(payload));
    },
    close: async () => {},
  });
}

console.log('\n[Stage 1/4] Expression Mode Showcase (14 Emotions + Mood LEDs + Head Pose)');
for (const name of ['happy', 'excited', 'curious', 'thinking', 'surprised', 'wink', 'laughing', 'sleepy']) {
  const meta = EXPRESSION_META[name];
  console.log(`  ${meta.emoji} ${meta.label.padEnd(10)} | LED ${meta.led} | Yaw ${String(meta.yaw).padStart(3)}° Pitch ${meta.pitch}°`);
  await bot.expression(name);
  await bot.setLed(meta.led, { duration: 0.3 });
  await bot.moveHead({ yaw: meta.yaw, pitch: meta.pitch, speed: 350 });
  await sleep(600);
}

console.log('\n[Stage 2/4] Animated Emotion Sequence ("Deep Thought → Eureka!")');
for (const step of EMOTION_SEQUENCES.thinking_eureka.steps) {
  const meta = EXPRESSION_META[step.expression];
  console.log(`  → ${meta.emoji} ${meta.label} (${step.durationMs}ms)`);
  await bot.expression(step.expression);
  await bot.setLed(step.led, { duration: 0.3 });
  await bot.moveHead({ yaw: step.yaw, pitch: step.pitch, speed: 400 });
  await sleep(Math.min(step.durationMs, 600));
}

console.log('\n[Stage 3/4] 3D Servo & Gesture Choreography');
console.log('  → Blink'); await bot.blink();
console.log('  → Nod');   await bot.nod(1);
console.log('  → Shake'); await bot.shake(1);

console.log('\n[Stage 4/4] Google Gemini AI Integration Check');
const geminiInfo = listProviders().find((p) => p.id === 'gemini');
if (geminiInfo?.available) {
  console.log(`  ✓ GEMINI_API_KEY detected (model: ${geminiInfo.defaultModel}). Running live Gemini turn…`);
  try {
    const adapter = createAdapter('gemini');
    const robotProxy = {
      async run(name, args) {
        console.log(`  [Gemini Tool Call] ${name}(${JSON.stringify(args)})`);
        if (name === 'set_expression' && EXPRESSIONS[args.name]) await bot.expression(args.name);
        if (name === 'set_led' && args.color) await bot.setLed(args.color === 'off' ? '#000000' : args.color);
        if (name === 'move_head') await bot.moveHead({ yaw: args.yaw ?? 0, pitch: args.pitch ?? 45, speed: 350 });
        if (name === 'gesture' && args.name === 'nod') await bot.nod(1);
        return 'ok';
      },
    };
    const { text, actions } = await runTurn({
      adapter,
      robot: robotProxy,
      history: [],
      userText: 'Say a short one-sentence greeting for the StackChan capability demo and set a happy or excited expression!',
    });
    console.log(`  💬 Gemini says: "${text}" (${actions.length} robot action(s) triggered)`);
  } catch (e) {
    console.log(`  ⚠ Gemini call error: ${e.message}`);
  }
} else {
  console.log('  ℹ Add GEMINI_API_KEY in .env to enable live Google Gemini responses.');
}

await bot.expression('neutral');
await bot.setLed('#000000');
await bot.center();
await sleep(300);
await bot.close();
console.log('\n✓ Demo complete! Run `npm run app` and open http://127.0.0.1:3000 for the full visual studio.');
process.exit(0);
