// Custom Stack-Chan Firmware for M5Stack CoreS3
// Features:
//  1. Always-on BLE GATT server compatible with Stack-Chan-Node (UUID e2e5e5e0-1234-5678-1234-56789abcdef0)
//  2. Custom Brand & Logo HUD rendered directly on the 320x240 IPS display
//  3. Built-in Expression Mode Simulator (autonomous blinking, breathing & emotion cycling)
//  4. On-screen touch controls: [Logo HUD] [Expr Mode] [Run Demo]
#include <M5Unified.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <ArduinoJson.h>
#include <math.h>

#define SERVICE_UUID     "e2e5e5e0-1234-5678-1234-56789abcdef0"
#define CHR_MOTION_UUID  "e2e5e5e1-1234-5678-1234-56789abcdef0"
#define CHR_AVATAR_UUID  "e2e5e5e2-1234-5678-1234-56789abcdef0"
#define CHR_RGB_UUID     "e2e5e5e4-1234-5678-1234-56789abcdef0"

struct Feature {
  float x = 0, y = 0, rotation = 0, weight = 100, size = 0;
};

static Feature leftEye  = {0, 0, 0, 100, 0};
static Feature rightEye = {0, 0, 0, 100, 0};
static Feature mouth    = {0, 0, 0, 0, 0};
static uint32_t ledColor = 0x38BDF8;
static bool showCustomLogo = true;
static bool exprModeActive = true;
static bool bleConnected = false;
static uint32_t lastExprTick = 0;
static int exprIndex = 0;

static M5Canvas canvas(&M5.Display);

static uint32_t parseHexColor(const char* s) {
  if (!s) return 0x38BDF8;
  if (s[0] == '#') s++;
  return (uint32_t)strtoul(s, nullptr, 16);
}

static void applyAvatarJson(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  auto readFeat = [&](const char* key, Feature& f) {
    if (!doc[key].is<JsonObject>()) return;
    JsonObject o = doc[key];
    if (o["x"].is<float>()) f.x = o["x"];
    if (o["y"].is<float>()) f.y = o["y"];
    if (o["rotation"].is<float>()) f.rotation = o["rotation"];
    if (o["weight"].is<float>()) f.weight = o["weight"];
    if (o["size"].is<float>()) f.size = o["size"];
  };
  readFeat("leftEye", leftEye);
  readFeat("rightEye", rightEye);
  readFeat("mouth", mouth);
}

static void applyRgbJson(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  if (doc["leftRgbColor"].is<const char*>()) {
    ledColor = parseHexColor(doc["leftRgbColor"]);
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override { bleConnected = true; }
  void onDisconnect(BLEServer* s) override {
    bleConnected = false;
    BLEDevice::startAdvertising();
  }
};

class AvatarCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    exprModeActive = false; // yield to PC control when BLE writes arrive
    applyAvatarJson(c->getValue().c_str());
  }
};

class RgbCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    applyRgbJson(c->getValue().c_str());
  }
};

class MotionCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    // Forward motion JSON to serial bus / servo UART if connected
    Serial.printf("[MOTION] %s\n", c->getValue().c_str());
  }
};

static void setPresetExpression(int idx) {
  switch (idx % 6) {
    case 0: // Happy
      leftEye = {0, -5, 0, 70, 10}; rightEye = {0, -5, 0, 70, 10}; mouth = {0, 0, 0, 60, 0}; ledColor = 0x00E676; break;
    case 1: // Excited
      leftEye = {0, -10, -80, 95, 35}; rightEye = {0, -10, 80, 95, 35}; mouth = {0, 5, 0, 85, 0}; ledColor = 0xFFEA00; break;
    case 2: // Curious
      leftEye = {15, 0, 0, 100, 25}; rightEye = {15, 0, -100, 80, -5}; mouth = {6, 0, -60, 20, 0}; ledColor = 0x00E5FF; break;
    case 3: // Thinking
      leftEye = {-20, -20, 0, 65, 0}; rightEye = {-20, -20, 0, 90, 10}; mouth = {-12, 0, 100, 10, 0}; ledColor = 0xAA00FF; break;
    case 4: // Wink
      leftEye = {0, 0, 0, 100, 10}; rightEye = {0, 0, 0, 0, 0}; mouth = {4, 0, -40, 35, 0}; ledColor = 0xF50057; break;
    default: // Neutral
      leftEye = {0, 0, 0, 100, 0}; rightEye = {0, 0, 0, 100, 0}; mouth = {0, 0, 0, 0, 0}; ledColor = 0x38BDF8; break;
  }
}

static void drawFrame() {
  canvas.fillSprite(0x090D16);

  // Custom Brand & Logo HUD Overlay
  if (showCustomLogo) {
    canvas.drawRoundRect(6, 6, 308, 228, 10, ledColor);
    canvas.fillRoundRect(75, 12, 170, 22, 11, 0x1E1B4B);
    canvas.drawRoundRect(75, 12, 170, 22, 11, ledColor);
    canvas.setTextColor(0xFFFFFF);
    canvas.setTextDatum(middle_center);
    canvas.setTextSize(1);
    canvas.drawString("STACK-CHAN AI · GEMINI", 160, 23);
  }

  // Draw eyes
  auto drawEye = [&](int cx, const Feature& e) {
    float scale = 1.0f + e.size / 200.0f;
    int rx = max(2, (int)(18 * scale));
    int ry = max(2, (int)(18 * scale * (e.weight / 100.0f)));
    canvas.fillEllipse(cx + (int)(e.x * 0.4f), 96 + (int)(e.y * 0.4f), rx, ry, 0xFFFFFF);
  };
  drawEye(105, leftEye);
  drawEye(215, rightEye);

  // Draw mouth
  int mw = 80;
  int mh = max(3, (int)(3 + mouth.weight * 0.32f));
  int mx = 160 + (int)(mouth.x * 0.4f) - mw / 2;
  int my = 168 + (int)(mouth.y * 0.4f) - mh / 2;
  canvas.fillRoundRect(mx, my, mw, mh, min(mh / 2, 12), 0xFFFFFF);

  // Touch status bar
  canvas.setTextSize(1);
  canvas.setTextColor(0x94A3B8);
  canvas.drawString(bleConnected ? "BLE: Connected" : "BLE: Advertising", 58, 218);
  canvas.drawString(exprModeActive ? "[Expr: ON]" : "[Expr: OFF]", 165, 218);
  canvas.drawString(showCustomLogo ? "[Logo: ON]" : "[Logo: OFF]", 262, 218);

  canvas.pushSprite(0, 0);
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);

  canvas.createSprite(320, 240);

  BLEDevice::init("StackChan-Custom");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* chrMotion = service->createCharacteristic(CHR_MOTION_UUID, BLECharacteristic::PROPERTY_WRITE);
  chrMotion->setCallbacks(new MotionCallbacks());

  BLECharacteristic* chrAvatar = service->createCharacteristic(CHR_AVATAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  chrAvatar->setCallbacks(new AvatarCallbacks());

  BLECharacteristic* chrRgb = service->createCharacteristic(CHR_RGB_UUID, BLECharacteristic::PROPERTY_WRITE);
  chrRgb->setCallbacks(new RgbCallbacks());

  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void loop() {
  M5.update();
  auto t = M5.Touch.getDetail();
  if (t.wasPressed()) {
    if (t.x < 110) exprModeActive = !exprModeActive;
    else if (t.x < 215) { exprModeActive = true; setPresetExpression(++exprIndex); }
    else showCustomLogo = !showCustomLogo;
  }

  if (exprModeActive && millis() - lastExprTick > 3000) {
    lastExprTick = millis();
    setPresetExpression(exprIndex++);
  }

  drawFrame();
  delay(33);
}
