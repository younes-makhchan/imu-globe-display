import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { decompressFrames, parseGIF } from "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm";

const canvas = document.getElementById("globeCanvas");
const globeSizeInput = document.getElementById("globeSize");
const auraThicknessInput = document.getElementById("auraThickness");
const auraGapInput = document.getElementById("auraGap");
const auraShineInput = document.getElementById("auraShine");
const americaGemLatInput = document.getElementById("americaGemLat");
const americaGemLonInput = document.getElementById("americaGemLon");
const americaGemSizeInput = document.getElementById("americaGemSize");
const chinaGemLatInput = document.getElementById("chinaGemLat");
const chinaGemLonInput = document.getElementById("chinaGemLon");
const chinaGemSizeInput = document.getElementById("chinaGemSize");
const connectSensorButton = document.getElementById("connectSensor");
const centerSensorButton = document.getElementById("centerSensor");
const saveSettingsButton = document.getElementById("saveSettings");
const saveStatus = document.getElementById("saveStatus");
const SETTINGS_STORAGE_KEY = "globeSliderSettings";
const MPU_SERVICE_UUID = "7f2a0001-5c8d-4b5f-8d71-12a56f5b9c10";
const MPU_RAW_CHARACTERISTIC_UUID = "7f2a0002-5c8d-4b5f-8d71-12a56f5b9c10";
const SENSOR_ROTATION_LIMIT = THREE.MathUtils.degToRad(25);
const SENSOR_SMOOTHING = 0.12;
const sliderInputs = [
  globeSizeInput,
  auraThicknessInput,
  auraGapInput,
  auraShineInput,
  americaGemLatInput,
  americaGemLonInput,
  americaGemSizeInput,
  chinaGemLatInput,
  chinaGemLonInput,
  chinaGemSizeInput,
];
const sliderOutputs = new Map(
  sliderInputs.map((input) => [
    input,
    document.getElementById(`${input.id}Value`),
  ])
);
const scene = new THREE.Scene();
const sensorRotation = {
  targetPitch: 0,
  targetYaw: 0,
  pitch: 0,
  yaw: 0,
  pitchCenter: 0,
  yawCenter: 0,
};
const manualRotation = {
  x: -0.16,
  y: 0,
  z: -0.045,
  isDragging: false,
  lastX: 0,
  lastY: 0,
};
let sensorDevice = null;

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 7.35);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

function loadTexture(url, colorSpace = THREE.SRGBColorSpace) {
  const texture = textureLoader.load(url);
  texture.colorSpace = colorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createStarField() {
  const starGeometry = new THREE.BufferGeometry();
  const vertices = [];
  const colors = [];
  const color = new THREE.Color();

  for (let i = 0; i < 1900; i += 1) {
    const radius = 24 + Math.random() * 44;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const warmth = 0.76 + Math.random() * 0.24;

    vertices.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );

    color.setRGB(warmth, warmth, 1);
    colors.push(color.r, color.g, color.b);
  }

  starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  starGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  return new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: 0.045,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      vertexColors: true,
    })
  );
}

function createAuraMaterial(color, intensity, power) {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      intensity: { value: intensity },
      power: { value: power },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewPosition = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      uniform float power;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        float rim = 1.0 - max(dot(vNormal, vViewPosition), 0.0);
        float glow = pow(rim, power) * intensity;
        gl_FragColor = vec4(glowColor, glow);
      }
    `,
    side: THREE.FrontSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

const textureBase = "https://threejs.org/examples/textures/planets/";
const earthMap = loadTexture(`${textureBase}earth_atmos_2048.jpg`);
const bumpMap = loadTexture(`${textureBase}earth_normal_2048.jpg`, THREE.NoColorSpace);
const specularMap = loadTexture(`${textureBase}earth_specular_2048.jpg`, THREE.NoColorSpace);
const cloudMap = loadTexture(`${textureBase}earth_clouds_1024.png`);
const EARTH_RADIUS = 2.36;
const CLOUD_RADIUS = 2.42;
const ATMOSPHERE_RADIUS = 2.68;
const OUTER_AURA_RADIUS = 3.02;
const DEEP_AURA_RADIUS = 3.34;
const GEM_RADIUS = CLOUD_RADIUS + 0.055;
const GEM_SIZE = 0.13;
const animatedGemTextures = [];

const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 160, 160);
const earthMaterial = new THREE.MeshPhongMaterial({
  map: earthMap,
  bumpMap,
  specularMap,
  bumpScale: 0.055,
  specular: new THREE.Color("#4f6f86"),
  shininess: 9,
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
globeGroup.add(earth);

function positionSurfaceMarker(marker, lat, lon) {
  const latitude = THREE.MathUtils.degToRad(lat);
  const longitude = THREE.MathUtils.degToRad(lon);
  const normal = new THREE.Vector3(
    -Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.cos(longitude)
  );

  marker.position.copy(normal).multiplyScalar(GEM_RADIUS);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  marker.rotateZ(marker.userData.rotationOffset || 0);
}

function createGemTexture(url, name) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);

  canvas.width = 1;
  canvas.height = 1;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const gifTexture = {
    name,
    url,
    canvas,
    context,
    texture,
    frames: [],
    frameIndex: -1,
    nextFrameAt: 0,
    previousFrame: null,
    restoreImage: null,
    patchCanvas: document.createElement("canvas"),
    patchContext: null,
  };

  gifTexture.patchContext = gifTexture.patchCanvas.getContext("2d");
  animatedGemTextures.push(gifTexture);
  loadAnimatedGif(gifTexture);

  return texture;
}

async function loadAnimatedGif(gifTexture) {
  const { name, url, canvas, texture } = gifTexture;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const gif = parseGIF(await response.arrayBuffer());
    const frames = decompressFrames(gif, true);

    if (frames.length === 0) {
      throw new Error("GIF has no decodable frames");
    }

    canvas.width = gif.lsd.width;
    canvas.height = gif.lsd.height;
    gifTexture.frames = frames;
    gifTexture.frameIndex = -1;
    gifTexture.nextFrameAt = performance.now();
    texture.dispose();
    texture.needsUpdate = true;

    console.info(`[GIF] ${name} decoded`, {
      source: url,
      width: canvas.width,
      height: canvas.height,
      frames: frames.length,
    });
  } catch (error) {
    console.error(`[GIF] ${name} could not be decoded`, { source: url, error });
  }
}

function createSurfaceMarker({ name, lat, lon, color, textureUrl, rotationOffset = 0 }) {
  const texture = textureUrl ? createGemTexture(textureUrl, name) : null;
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(GEM_SIZE, GEM_SIZE),
    new THREE.MeshBasicMaterial({
      color: texture ? "#ffffff" : color,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
    })
  );

  marker.name = name;
  marker.userData.rotationOffset = rotationOffset;
  positionSurfaceMarker(marker, lat, lon);

  return marker;
}

const americaGem = createSurfaceMarker({
  name: "rick-roll-america",
  lat: 39,
  lon: -98,
  color: "#ff4fb8",
  textureUrl: "assets/gifs/rick.gif",
});
const chinaGem = createSurfaceMarker({
  name: "cat-coco-china",
  lat: 35,
  lon: 103,
  color: "#7cff7a",
  textureUrl: "assets/gifs/coco.gif",
  rotationOffset: -Math.PI / 2,
});
earth.add(americaGem);
earth.add(chinaGem);

const cloudMaterial = new THREE.MeshPhongMaterial({
  map: cloudMap,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  shininess: 7,
});
const clouds = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 128, 128), cloudMaterial);
globeGroup.add(clouds);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 128, 128),
  createAuraMaterial("#8fe4ff", 1.2, 3.3)
);
globeGroup.add(atmosphere);

const outerAura = new THREE.Mesh(
  new THREE.SphereGeometry(OUTER_AURA_RADIUS, 128, 128),
  createAuraMaterial("#43c4ff", 0.8, 4.2)
);
globeGroup.add(outerAura);

const deepAura = new THREE.Mesh(
  new THREE.SphereGeometry(DEEP_AURA_RADIUS, 128, 128),
  createAuraMaterial("#237dff", 0.38, 5.2)
);
globeGroup.add(deepAura);

scene.add(createStarField());
scene.add(new THREE.AmbientLight("#5f7fa8", 0.28));

const sun = new THREE.DirectionalLight("#fff1c7", 3.15);
sun.position.set(4.8, 2.9, 5.1);
scene.add(sun);

const blueFill = new THREE.DirectionalLight("#5aa6ff", 0.9);
blueFill.position.set(-4.6, -0.4, 1.8);
scene.add(blueFill);

const rim = new THREE.DirectionalLight("#8fd4ff", 2.9);
rim.position.set(-5.5, 0.4, -3.6);
scene.add(rim);

function updateControls() {
  sliderOutputs.forEach((output, input) => {
    output.value = input.value;
  });

  const globeScale = Number(globeSizeInput.value) / 100;
  const auraThickness = Number(auraThicknessInput.value) / 100;
  const auraGap = Number(auraGapInput.value) / 100;
  const auraShine = Number(auraShineInput.value) / 100;
  const americaGemLat = Number(americaGemLatInput.value);
  const americaGemLon = Number(americaGemLonInput.value);
  const americaGemSize = Number(americaGemSizeInput.value) / 100;
  const chinaGemLat = Number(chinaGemLatInput.value);
  const chinaGemLon = Number(chinaGemLonInput.value);
  const chinaGemSize = Number(chinaGemSizeInput.value) / 100;
  const auraVisible = auraThickness > 0 && globeScale > 0;
  const visibleEarthRadius = CLOUD_RADIUS * globeScale;
  const auraGapSize = auraGap * 0.55 * globeScale;
  const auraThicknessSize = auraThickness * 0.72 * globeScale;
  const innerAuraRadius = visibleEarthRadius + 0.018 * globeScale + auraGapSize;
  const outerAuraRadius = innerAuraRadius + Math.max(0.06 * globeScale, auraThicknessSize * 0.7);
  const deepAuraRadius = innerAuraRadius + Math.max(0.12 * globeScale, auraThicknessSize * 1.45);

  earth.scale.setScalar(globeScale);
  clouds.scale.setScalar(globeScale);
  atmosphere.scale.setScalar(innerAuraRadius / ATMOSPHERE_RADIUS);
  outerAura.scale.setScalar(outerAuraRadius / OUTER_AURA_RADIUS);
  deepAura.scale.setScalar(deepAuraRadius / DEEP_AURA_RADIUS);

  atmosphere.visible = auraVisible;
  outerAura.visible = auraVisible;
  deepAura.visible = auraVisible;
  atmosphere.material.uniforms.intensity.value = 1.05 * auraShine * Math.max(0.18, auraThickness);
  outerAura.material.uniforms.intensity.value = 0.86 * auraShine * auraThickness;
  deepAura.material.uniforms.intensity.value = 0.48 * auraShine * auraThickness;

  positionSurfaceMarker(americaGem, americaGemLat, americaGemLon);
  positionSurfaceMarker(chinaGem, chinaGemLat, chinaGemLon);
  americaGem.scale.setScalar(americaGemSize);
  chinaGem.scale.setScalar(chinaGemSize);
}

function loadSavedSettings() {
  let savedSettings = {};

  try {
    savedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
  } catch {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  }

  sliderInputs.forEach((input) => {
    if (savedSettings[input.id] === undefined) {
      return;
    }

    const value = Number(savedSettings[input.id]);
    const min = Number(input.min);
    const max = Number(input.max);

    if (Number.isFinite(value)) {
      input.value = Math.min(max, Math.max(min, value));
    }
  });
}

function saveSettings() {
  const settings = Object.fromEntries(sliderInputs.map((input) => [input.id, input.value]));

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    saveStatus.textContent = "Saved";
  } catch {
    saveStatus.textContent = "Could not save";
  }
}

function setSensorStatus(message) {
  saveStatus.textContent = message;
}

function parseRawMpuPayload(value) {
  if (value.byteLength >= 12) {
    return {
      ax: value.getInt16(0, true),
      ay: value.getInt16(2, true),
      az: value.getInt16(4, true),
      gx: value.getInt16(6, true),
      gy: value.getInt16(8, true),
      gz: value.getInt16(10, true),
    };
  }

  const payload = new TextDecoder().decode(value);
  const [ax, ay, az, gx, gy, gz] = payload.split(",").map(Number);

  if ([ax, ay, az, gx, gy, gz].some((rawValue) => !Number.isFinite(rawValue))) {
    return null;
  }

  return { ax, ay, az, gx, gy, gz };
}

function rawMpuToRotation({ ax, ay, az }) {
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));
  const yaw = Math.atan2(ay, az);

  return { pitch, yaw };
}

function clampSensorRotation(value) {
  return THREE.MathUtils.clamp(value, -SENSOR_ROTATION_LIMIT, SENSOR_ROTATION_LIMIT);
}

function handleMpuNotification(event) {
  const rawData = parseRawMpuPayload(event.target.value);

  if (!rawData) {
    return;
  }

  const rotation = rawMpuToRotation(rawData);
  sensorRotation.targetPitch = clampSensorRotation(rotation.pitch - sensorRotation.pitchCenter);
  sensorRotation.targetYaw = clampSensorRotation(rotation.yaw - sensorRotation.yawCenter);
}

function centerSensor() {
  sensorRotation.pitchCenter += sensorRotation.targetPitch;
  sensorRotation.yawCenter += sensorRotation.targetYaw;
  sensorRotation.targetPitch = 0;
  sensorRotation.targetYaw = 0;
  setSensorStatus("Centered");
}

async function connectSensor() {
  if (!navigator.bluetooth) {
    setSensorStatus("Web Bluetooth unavailable");
    return;
  }

  try {
    setSensorStatus("Connecting");
    sensorDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Globe MPU6050" }],
      optionalServices: [MPU_SERVICE_UUID],
    });

    sensorDevice.addEventListener("gattserverdisconnected", () => {
      setSensorStatus("Sensor disconnected");
    });

    const server = await sensorDevice.gatt.connect();
    const service = await server.getPrimaryService(MPU_SERVICE_UUID);
    const rawCharacteristic = await service.getCharacteristic(MPU_RAW_CHARACTERISTIC_UUID);

    rawCharacteristic.addEventListener("characteristicvaluechanged", handleMpuNotification);
    await rawCharacteristic.startNotifications();
    setSensorStatus("Sensor connected");
  } catch (error) {
    setSensorStatus("Sensor not connected");
  }
}

function resizeScene() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.position.z = width < 720 ? 8.7 : 7.35;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function startGlobeDrag(event) {
  if (event.target !== canvas) {
    return;
  }

  manualRotation.isDragging = true;
  manualRotation.lastX = event.clientX;
  manualRotation.lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
}

function dragGlobe(event) {
  if (!manualRotation.isDragging) {
    return;
  }

  const deltaX = event.clientX - manualRotation.lastX;
  const deltaY = event.clientY - manualRotation.lastY;

  manualRotation.y += deltaX * 0.008;
  manualRotation.x = THREE.MathUtils.clamp(
    manualRotation.x + deltaY * 0.006,
    -Math.PI / 2,
    Math.PI / 2
  );
  manualRotation.lastX = event.clientX;
  manualRotation.lastY = event.clientY;
}

function stopGlobeDrag(event) {
  if (!manualRotation.isDragging) {
    return;
  }

  manualRotation.isDragging = false;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function applyPreviousGifDisposal(gifTexture) {
  const { previousFrame, restoreImage, context } = gifTexture;

  if (!previousFrame) {
    return;
  }

  if (previousFrame.disposalType === 2) {
    const { left, top, width, height } = previousFrame.dims;
    context.clearRect(left, top, width, height);
  } else if (previousFrame.disposalType === 3 && restoreImage) {
    context.putImageData(restoreImage, 0, 0);
  }
}

function renderGifFrame(gifTexture, frame) {
  const { canvas, context, patchCanvas, patchContext, texture } = gifTexture;
  const { left, top, width, height } = frame.dims;

  applyPreviousGifDisposal(gifTexture);
  gifTexture.restoreImage =
    frame.disposalType === 3 ? context.getImageData(0, 0, canvas.width, canvas.height) : null;

  patchCanvas.width = width;
  patchCanvas.height = height;
  patchContext.putImageData(new ImageData(frame.patch, width, height), 0, 0);
  context.drawImage(patchCanvas, left, top);
  gifTexture.previousFrame = frame;
  texture.needsUpdate = true;
}

function updateAnimatedGemTextures(time) {
  animatedGemTextures.forEach((gifTexture) => {
    if (gifTexture.frames.length === 0 || time < gifTexture.nextFrameAt) {
      return;
    }

    let framesRendered = 0;

    while (time >= gifTexture.nextFrameAt && framesRendered < gifTexture.frames.length) {
      gifTexture.frameIndex = (gifTexture.frameIndex + 1) % gifTexture.frames.length;
      const frame = gifTexture.frames[gifTexture.frameIndex];
      renderGifFrame(gifTexture, frame);
      gifTexture.nextFrameAt += Math.max(frame.delay || 100, 20);
      framesRendered += 1;
    }

    if (framesRendered === gifTexture.frames.length) {
      gifTexture.nextFrameAt = time;
    }
  });
}

function animate(time) {
  sensorRotation.pitch += (sensorRotation.targetPitch - sensorRotation.pitch) * SENSOR_SMOOTHING;
  sensorRotation.yaw += (sensorRotation.targetYaw - sensorRotation.yaw) * SENSOR_SMOOTHING;

  updateAnimatedGemTextures(time);

  globeGroup.rotation.x = manualRotation.x + sensorRotation.pitch;
  globeGroup.rotation.y = manualRotation.y + sensorRotation.yaw;
  globeGroup.rotation.z = manualRotation.z;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeScene);
canvas.addEventListener("pointerdown", startGlobeDrag);
canvas.addEventListener("pointermove", dragGlobe);
canvas.addEventListener("pointerup", stopGlobeDrag);
canvas.addEventListener("pointercancel", stopGlobeDrag);
sliderInputs.forEach((input) => {
  input.addEventListener("input", updateControls);
});
connectSensorButton.addEventListener("click", connectSensor);
centerSensorButton.addEventListener("click", centerSensor);
saveSettingsButton.addEventListener("click", saveSettings);
loadSavedSettings();
resizeScene();
updateControls();
animate(performance.now());
