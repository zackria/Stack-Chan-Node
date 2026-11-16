import { StackChanBle, EXPRESSIONS } from '../src/index.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bot = await StackChanBle.connectNode();
console.log('connected');
for (const [name, color] of [['happy', '#00ff00'], ['surprised', '#ffffff'], ['sad', '#0000ff'], ['wink', '#ff00ff'], ['sleepy', '#ff8000']]) {
  console.log('expression', name, color);
  await bot.expression(name);
  await bot.setLed(color, { duration: 0.3 });
  await sleep(1500);
}
console.log('nod'); await bot.nod();
console.log('shake'); await bot.shake();
await bot.expression('neutral'); await bot.setLed('#000000'); await bot.center();
await sleep(500);
await bot.close();
console.log('done');
process.exit(0);
