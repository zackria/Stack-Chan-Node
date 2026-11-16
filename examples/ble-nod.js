import { StackChanBle } from '../src/index.js';
const bot = await StackChanBle.connectNode();
console.log('connected');
await bot.moveHead({ yaw: 30, pitch: 45, speed: 200 });
await new Promise((r) => setTimeout(r, 1500));
await bot.moveHead({ yaw: 0, pitch: 45, speed: 200 });
await bot.close();
process.exit(0);
