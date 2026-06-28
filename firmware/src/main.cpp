#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>

namespace {
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint8_t MPU6050_PWR_MGMT_1 = 0x6B;
constexpr uint8_t MPU6050_ACCEL_XOUT_H = 0x3B;
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

constexpr char DEVICE_NAME[] = "Globe MPU6050";
constexpr char SERVICE_UUID[] = "7f2a0001-5c8d-4b5f-8d71-12a56f5b9c10";
constexpr char RAW_CHARACTERISTIC_UUID[] = "7f2a0002-5c8d-4b5f-8d71-12a56f5b9c10";

BLECharacteristic *rawCharacteristic = nullptr;
volatile bool deviceConnected = false;

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

int16_t readInt16() {
  const uint8_t highByte = Wire.read();
  const uint8_t lowByte = Wire.read();
  return static_cast<int16_t>((highByte << 8) | lowByte);
}

bool readMpu6050(RawMpuData &data) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(MPU6050_ACCEL_XOUT_H);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(MPU6050_ADDRESS, static_cast<uint8_t>(14), true) != 14) {
    return false;
  }

  data.ax = readInt16();
  data.ay = readInt16();
  data.az = readInt16();
  Wire.read();
  Wire.read();
  data.gx = readInt16();
  data.gy = readInt16();
  data.gz = readInt16();

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

bool wakeMpu6050() {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(MPU6050_PWR_MGMT_1);
  Wire.write(0);
  return Wire.endTransmission(true) == 0;
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
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!wakeMpu6050()) {
    Serial.println("MPU6050 not detected; check power and I2C wiring");
  }

  setupBle();
  Serial.println("Globe MPU6050 BLE transmitter started");
}

void loop() {
  RawMpuData data;

  if (deviceConnected && rawCharacteristic != nullptr && readMpu6050(data)) {
    notifyRawMpuData(data);
  }

  delay(20);
}
