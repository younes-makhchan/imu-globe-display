# imu-globe-display

A browser-based interactive 3D Earth globe controlled by an ESP32 + MPU6050
over Web Bluetooth. Animated GIF decals are positioned on the Earth's surface.

## Project layout

- `web/` — Three.js globe app and browser controls.
- `web/assets/gifs/` — Animated surface decal assets.
- `firmware/src/` — ESP32 firmware that reads the MPU6050 and broadcasts raw
  sensor values over BLE.
- `tools/` — Optional local helpers, including the Gerber download utility.

## Run the web app

Serve the `web/` directory through a local web server, then open it in a
Web Bluetooth-capable browser such as Chrome.

```sh
cd web
python3 -m http.server 5500
```

Open `http://127.0.0.1:5500` and choose **Connect Sensor**.

## Firmware

The firmware entry point is `firmware/src/main.cpp`. It is written for an
ESP32 with an MPU6050 connected through I2C on SDA 21 and SCL 22.

The included `platformio.ini` targets a standard ESP32 development board
(`esp32dev`) with the Arduino framework. From the repository root:

```sh
pio run
pio run --target upload
pio device monitor
```

If your board is not a standard ESP32 development board, change `board` in
`platformio.ini` to its PlatformIO board identifier. The firmware advertises
as `Globe MPU6050` at 115200 baud.

## Gerber helper

`tools/download_gerber.py` accepts optional environment variables:

- `PCBWAY_GERBER_URL`
- `PCBWAY_GERBER_OUTPUT`
- `PCBWAY_COOKIE` — keep this local; never commit it.
