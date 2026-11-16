// Wire format of the official StackChan server's /stackChan/ws channel
// (see m5stack/StackChan server/README.MD §11 and firmware hal_ws_avatar.cpp).
// Binary frame: [type:1][payloadLength:4 big-endian][payload]

export const MsgType = Object.freeze({
  Opus: 0x01, Jpeg: 0x02, ControlAvatar: 0x03, ControlMotion: 0x04,
  StartCamera: 0x05, StopCamera: 0x06, TextMessage: 0x07,
  RequestCall: 0x09, DeclineCall: 0x0a, AcceptCall: 0x0b, EndCall: 0x0c,
  SetDeviceName: 0x0d, GetDeviceName: 0x0e,
  Ping: 0x10, Pong: 0x11, VideoModeOn: 0x12, VideoModeOff: 0x13,
  DanceSequence: 0x14, GetAvatarPosture: 0x15,
  DeviceOffline: 0x16, DeviceOnline: 0x17,
  StartAudio: 0x18, StopAudio: 0x19, AimedTakePhoto: 0x1a, AppLanAddress: 0x1b,
});

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(type, payload = new Uint8Array(0)) {
  const body = typeof payload === 'string' ? enc.encode(payload) : payload;
  const out = new Uint8Array(5 + body.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, body.length, false);
  out.set(body, 5);
  return out;
}

export function decodeFrame(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < 5) throw new Error('frame too short');
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(1, false);
  return { type: u8[0], payload: u8.subarray(5, 5 + len) };
}

export const payloadText = (p) => dec.decode(p);
export const encodeJsonFrame = (type, obj) => encodeFrame(type, JSON.stringify(obj));
