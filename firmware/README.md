# Custom Stack-Chan Firmware (M5Stack CoreS3)

This directory contains an optional custom firmware for the M5Stack CoreS3 Stack-Chan that renders the custom brand HUD & logo directly on the robot's 320x240 screen, runs an on-device **Expression Mode** simulator, and advertises the Stack-Chan Bluetooth LE GATT service (`e2e5e5e0-1234-5678-1234-56789abcdef0`) immediately on boot.

## Option A: Using Stock M5Stack Stack-Chan Firmware (Currently Installed)

Your Stack-Chan is currently running the official M5Stack Stack-Chan ESP-IDF firmware over `/dev/cu.usbmodem2101`. To connect it to the PC app without flashing:

1. On Stack-Chan's touch screen, open the **Dance** app (this turns on BLE advertising).
2. In the PC control panel (`http://127.0.0.1:3000`), click **Connect**.

## Option B: Building & Flashing This Custom Firmware

If you want always-on BLE advertising, on-screen custom logo HUD, and standalone touch-screen Expression Mode:

1. Install PlatformIO (`brew install platformio`).
2. *(Recommended)* Back up your factory flash first:
   ```bash
   esptool.py --port /dev/cu.usbmodem2101 read_flash 0x0 0x1000000 stackchan-factory-backup.bin
   ```
3. Build and upload the custom firmware:
   ```bash
   cd firmware
   pio run -t upload
   ```
