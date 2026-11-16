import { StackChanClient } from '../src/index.js';

if (!process.env.STACKCHAN_SERVER || !process.env.STACKCHAN_TOKEN) {
  console.error('This example uses the StackChan cloud/server channel and needs STACKCHAN_SERVER and STACKCHAN_TOKEN.\n' +
    'For direct Bluetooth control (no token) run: npm start');
  process.exit(1);
}

const bot = new StackChanClient({
  server: process.env.STACKCHAN_SERVER,          // e.g. ws://192.168.1.10:12800
  appId: 'my-js-app',
  authorization: process.env.STACKCHAN_TOKEN,
});
await bot.connect();
bot.moveHead({ yaw: 30, pitch: 45, speed: 200 });
await new Promise((r) => setTimeout(r, 1500));
bot.moveHead({ yaw: 0, pitch: 45 });
bot.close();
