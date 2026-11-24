# Stack-Chan Custom Studio & Google Gemini Companion

A custom Node.js + Web control application and companion ESP32-S3 firmware for M5Stack **Stack-Chan**, featuring:

- **Custom Brand & Logo System** — Built-in default custom logo ([public/logo.svg](public/logo.svg)) plus instant custom image upload (PNG/JPEG/WebP/SVG) persisted in `localStorage` with 3 display modes (*Behind the face HUD*, *Corner brand badge*, and *Full screen logo*).
- **Google Gemini AI Integration** — Configured via [`.env`](.env) (`GEMINI_API_KEY` with automatic hot-reload on save — no server restart required). Gemini talks aloud with robot lip-flap and autonomously controls expressions, head servos, gestures, and RGB LEDs.
- **Mirror My Face** — Real-time webcam face, eye-blink, gaze, mouth, and head-pose mirroring powered by MediaPipe FaceLandmarker, plus a built-in **Simulate Mirror Test** mode.
- **Expression Mode (Live Emotion Simulator)** — Autonomous emotion simulation across 14 expressions ([src/expressions.js](src/expressions.js)) with smooth keyframe interpolation, mood-synced LED lighting, natural head postures, and 3 simulation modes:
  1. *Emotion Carousel* (auto-cycles all 14 emotions)
  2. *Ambient Companion* (lifelike idle breathing, random single/double blinks, and room glances)
  3. *Story Sequences* (choreographed multi-step emotional arcs)
- **6-Stage Capability Showcase Demo** — One-click interactive showcase in the web UI (`▶ Run Capability Demo`) and CLI (`npm run demo`).
- **Custom Device Firmware** — Optional M5Stack CoreS3 firmware in [`firmware/`](firmware/) with always-on BLE advertising, on-screen custom logo HUD, and standalone Expression Mode.

## Quick Start

1. **Add your Google Gemini API Key** in [`.env`](.env):
   ```env
   GEMINI_API_KEY=your_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```
   *(The server watches `.env` and activates Gemini automatically as soon as you save the file.)*

2. **Start the Custom Control Studio**:
   ```bash
   npm run app
   ```
   Open **http://127.0.0.1:3000** in your browser.

3. **Connect Your Stack-Chan**:
   - On Stack-Chan's screen, open the **Dance** app (or flash the custom firmware in [`firmware/`](firmware/README.md)), then click **Connect** in the top right of the web app.

4. **Run the Capability Demo**:
   - Click **▶ Run Capability Demo** in the top bar of the web app, or run the CLI showcase:
     ```bash
     npm run demo
     ```
