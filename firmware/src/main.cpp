#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <MPU6050_light.h>
#include <Wire.h>

namespace {
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint32_t I2C_CLOCK_HZ = 400000;
constexpr float ACCEL_RAW_SCALE = 16384.0F;  // ±2 g, matching the old BLE payload.
constexpr float GYRO_RAW_SCALE = 131.0F;     // ±250°/s, matching the old BLE payload.

constexpr char DEVICE_NAME[] = "Globe MPU6050";
constexpr char SERVICE_UUID[] = "7f2a0001-5c8d-4b5f-8d71-12a56f5b9c10";
constexpr char RAW_CHARACTERISTIC_UUID[] = "7f2a0002-5c8d-4b5f-8d71-12a56f5b9c10";

BLECharacteristic *rawCharacteristic = nullptr;
volatile bool deviceConnected = false;
MPU6050 mpu(Wire);
bool mpuReady = false;

struct RawMpuData {
  int16_t ax;
  int16_t ay;
  int16_t az;
  int16_t gx;
  int16_t gy;
  int16_t gz;
};

class GlobeServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    server->startAdvertising();
  }
};

int16_t clampToInt16(float value) {
  if (value > 32767.0F) {
    return 32767;
  }

  if (value < -32768.0F) {
    return -32768;
  }

  return static_cast<int16_t>(value);
}

bool readMpu6050(RawMpuData &data) {
  mpu.update();
  data.ax = clampToInt16(mpu.getAccX() * ACCEL_RAW_SCALE);
  data.ay = clampToInt16(mpu.getAccY() * ACCEL_RAW_SCALE);
  data.az = clampToInt16(mpu.getAccZ() * ACCEL_RAW_SCALE);
  data.gx = clampToInt16(mpu.getGyroX() * GYRO_RAW_SCALE);
  data.gy = clampToInt16(mpu.getGyroY() * GYRO_RAW_SCALE);
  data.gz = clampToInt16(mpu.getGyroZ() * GYRO_RAW_SCALE);

  return true;
}

void writeInt16LittleEndian(uint8_t *payload, size_t offset, int16_t value) {
  payload[offset] = static_cast<uint8_t>(value & 0xFF);
  payload[offset + 1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

void notifyRawMpuData(const RawMpuData &data) {
  uint8_t payload[12];

  writeInt16LittleEndian(payload, 0, data.ax);
  writeInt16LittleEndian(payload, 2, data.ay);
  writeInt16LittleEndian(payload, 4, data.az);
  writeInt16LittleEndian(payload, 6, data.gx);
  writeInt16LittleEndian(payload, 8, data.gy);
  writeInt16LittleEndian(payload, 10, data.gz);

  rawCharacteristic->setValue(payload, sizeof(payload));
  rawCharacteristic->notify();
}

bool initializeMpu6050() {
  const byte status = mpu.begin();

  if (status != 0) {
    Serial.print("MPU6050 initialization failed, status: ");
    Serial.println(status);
    return false;
  }

  Serial.println("Keep MPU6050 flat and still. Calibration starts in 2 seconds...");
  delay(2000);
  mpu.calcOffsets(true, true);
  Serial.println("MPU6050 calibration complete");
  return true;
}

void setupBle() {
  BLEDevice::init(DEVICE_NAME);

  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new GlobeServerCallbacks());

  BLEService *service = server->createService(SERVICE_UUID);
  rawCharacteristic = service->createCharacteristic(
      RAW_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  rawCharacteristic->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_CLOCK_HZ);
  mpuReady = initializeMpu6050();

  if (!mpuReady) {
    Serial.println("Check MPU6050 power and I2C wiring, then restart the ESP32");
  }

  setupBle();
  Serial.println("Globe MPU6050 BLE transmitter started");
}

void loop() {
  RawMpuData data;

  if (mpuReady && deviceConnected && rawCharacteristic != nullptr && readMpu6050(data)) {
    notifyRawMpuData(data);
  }

  delay(20);
}
