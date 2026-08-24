// Cinematic globe enhancement. Lifts react-globe.gl's stock Blue Marble sphere
// from "library demo" to "documentary atlas" by injecting a day/night
// terminator with city lights, ocean sun-glint, a fresnel atmosphere limb
// glow, and a color grade into the existing globe material, plus a three-point
// light rig.
//
// Everything runs ONCE on globe-ready and is idempotent. It never touches the
// renderer pipeline (setPixelRatio, texture anisotropy, needsUpdate on the
// loaded textures) because that forced a WebGL context-loss/restore cycle that
// crashes three.js. Adding scene lights and patching a material's shader via
// onBeforeCompile is safe: it only recompiles the program. The whole thing is
// wrapped in try/catch so a bad shader degrades to the stock globe instead of
// black-screening the app.

import * as THREE from 'three';
import type { GlobeMethods } from 'react-globe.gl';

// City-lights and ocean-mask textures, pulled from the same three-globe CDN
// the app already uses for the topology bump and night-sky background, so no
// new bundled assets and no new origins.
const NIGHT_URL = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg';
const WATER_URL = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-water.png';

// CinematicOpts tunes the look. Defaults are chosen for the landing globe;
// callers can override per-surface (e.g. a flatter grade inside a replay).
export interface CinematicOpts {
  // sun is the world-space direction toward the sun. Drives the terminator,
  // the key light, the ocean glint, and the day-side fresnel brightening.
  // A side-on vector keeps a crescent of night (with city lights) on the
  // visible disc rather than flat full-daylight.
  sun: [number, number, number];
  // saturation pulls the cartoon-bright NASA palette toward a graded
  // documentary tone. 1 = untouched, <1 = desaturated.
  saturation: number;
  // contrast shapes the midtones. >1 deepens shadows and lifts highlights.
  contrast: number;
  // brightness is a flat additive lift applied after grading.
  brightness: number;
  // tint multiplies the graded color per channel. Slightly warm by default.
  tint: [number, number, number];
  // nightIntensity scales the city-lights glow on the dark side.
  nightIntensity: number;
  // specIntensity scales the ocean sun-glint specular highlight.
  specIntensity: number;
  // fresnelIntensity scales the atmospheric limb glow on the sphere surface.
  fresnelIntensity: number;
  // fresnelColor is the limb-glow color (a cool sky blue by default).
  fresnelColor: [number, number, number];
  // ambient is the ambient light intensity. Low so the night side reads dark
  // enough for city lights to register, but not pure black.
  ambient: number;
  // key is the sun-side directional light intensity.
  key: number;
  // fill is the cool opposite-side fill light intensity for limb definition.
  fill: number;
}

export const DEFAULT_CINEMATIC: CinematicOpts = {
  sun: [-0.5, 0.3, 0.8],
  // Documentary-atlas grade: pull further off the cartoon-bright NASA palette
  // (lower saturation), keep editorial midtone depth, and dial back the three
  // effects that read as "tech demo" rather than "atlas" — the glossy ocean
  // sun-glint, the sci-fi limb glow, and the blingy city lights.
  saturation: 0.72,
  contrast: 1.15,
  brightness: -0.01,
  tint: [1.02, 1.0, 0.96],
  nightIntensity: 1.25,
  specIntensity: 0.38,
  fresnelIntensity: 0.34,
  fresnelColor: [0.5, 0.62, 0.82],
  ambient: 0.5,
  key: 2.7,
  fill: 0.5,
};

// GlobeLike is the slice of the react-globe.gl imperative handle we touch.
type GlobeLike = GlobeMethods & {
  globeMaterial?: () => THREE.Material | undefined;
  scene?: () => THREE.Scene;
  __bsCinematic?: boolean;
};

// findGlobeMaterial locates the globe sphere's MeshPhongMaterial by walking
// the scene. react-globe.gl's globeMaterial() getter only returns a
// caller-supplied override, so the internal default material is invisible to
// it. The globe is the largest SphereGeometry mesh carrying a Phong material;
// the bump map (we pass bumpImageUrl) is a strong secondary signal that
// distinguishes it from the atmosphere shell (a ShaderMaterial).
function findGlobeMaterial(scene: THREE.Scene): THREE.MeshPhongMaterial | undefined {
  let best: THREE.MeshPhongMaterial | undefined;
  let bestRadius = -1;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshPhongMaterial | THREE.MeshPhongMaterial[];
    const m = Array.isArray(mat) ? mat[0] : mat;
    if (!m || !(m as THREE.MeshPhongMaterial).isMeshPhongMaterial) return;
    const geo = mesh.geometry as THREE.SphereGeometry;
    const radius = (geo?.parameters as { radius?: number })?.radius
      ?? (geo?.boundingSphere?.radius ?? 0);
    if (radius > bestRadius) {
      bestRadius = radius;
      best = m as THREE.MeshPhongMaterial;
    }
  });
  return best;
}

// enhanceGlobe applies the cinematic treatment to a globe instance. Safe to
// call repeatedly; the first successful application sets a guard flag. If the
// material is not ready yet it retries a few times before giving up.
export function enhanceGlobe(globe: GlobeMethods | undefined, opts: Partial<CinematicOpts> = {}): void {
  const g = globe as GlobeLike | undefined;
  if (!g || g.__bsCinematic) return;
  const o: CinematicOpts = { ...DEFAULT_CINEMATIC, ...opts };

  let attempts = 0;
  const tryApply = () => {
    attempts++;
    try {
      const scene = g.scene?.();
      const mat = scene ? findGlobeMaterial(scene) : undefined;
      if (!mat || !scene) {
        if (attempts < 40) setTimeout(tryApply, 120);
        return;
      }
      applyLights(scene, o);
      patchMaterial(mat, o);
      g.__bsCinematic = true;
    } catch (err) {
      // Leave the stock globe in place; never let a shader bug black-screen.
      console.warn('cinematic globe enhancement skipped:', err);
    }
  };
  tryApply();
}

// applyLights retunes the scene lighting into a three-point rig aligned with
// the sun direction: a warm key from the sun, a dim cool ambient so the night
// side is not pure black, and a cool fill from the far side for limb shape.
function applyLights(scene: THREE.Scene, o: CinematicOpts): void {
  const sun = new THREE.Vector3(o.sun[0], o.sun[1], o.sun[2]).normalize();
  let sawAmbient = false;
  let sawDirectional = false;
  scene.traverse((obj) => {
    const l = obj as THREE.Light;
    if ((l as THREE.AmbientLight).isAmbientLight) {
      l.intensity = o.ambient;
      l.color.set(0x5b6c86);
      sawAmbient = true;
    } else if ((l as THREE.DirectionalLight).isDirectionalLight) {
      l.intensity = o.key;
      l.color.set(0xfff3e2);
      (l as THREE.DirectionalLight).position.copy(sun).multiplyScalar(500);
      sawDirectional = true;
    }
  });
  if (!sawAmbient) scene.add(new THREE.AmbientLight(0x5b6c86, o.ambient));
  if (!sawDirectional) {
    const key = new THREE.DirectionalLight(0xfff3e2, o.key);
    key.position.copy(sun).multiplyScalar(500);
    scene.add(key);
  }
  // Cool fill from the opposite/upper side so the dark limb keeps form
  // instead of dissolving into the background.
  const fill = new THREE.DirectionalLight(0x9fc0ff, o.fill);
  fill.position.set(-sun.x * 400, Math.abs(sun.y) * 200 + 160, -sun.z * 400);
  fill.userData.bsFill = true;
  scene.add(fill);
}

// patchMaterial injects the day/night, ocean-glint, fresnel, and grade passes
// into the globe's MeshPhong shader via onBeforeCompile, keeping three-globe's
// own map/bump texture binding intact.
function patchMaterial(mat: THREE.MeshPhongMaterial, o: CinematicOpts): void {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const night = loader.load(NIGHT_URL);
  const water = loader.load(WATER_URL);
  // Treat both as linear data so the values add predictably to the lit color
  // before the output sRGB conversion.
  night.colorSpace = THREE.NoColorSpace;
  water.colorSpace = THREE.NoColorSpace;
  night.wrapS = night.wrapT = THREE.ClampToEdgeWrapping;
  water.wrapS = water.wrapT = THREE.ClampToEdgeWrapping;

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(o.sun[0], o.sun[1], o.sun[2]).normalize() },
    uNightMap: { value: night },
    uWaterMap: { value: water },
    uSat: { value: o.saturation },
    uContrast: { value: o.contrast },
    uBright: { value: o.brightness },
    uTint: { value: new THREE.Vector3(o.tint[0], o.tint[1], o.tint[2]) },
    uNightInt: { value: o.nightIntensity },
    uSpecInt: { value: o.specIntensity },
    uFresInt: { value: o.fresnelIntensity },
    uFresColor: { value: new THREE.Vector3(o.fresnelColor[0], o.fresnelColor[1], o.fresnelColor[2]) },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    const header = `
uniform vec3 uSunDir;
uniform sampler2D uNightMap;
uniform sampler2D uWaterMap;
uniform float uSat;
uniform float uContrast;
uniform float uBright;
uniform vec3 uTint;
uniform float uNightInt;
uniform float uSpecInt;
uniform float uFresInt;
uniform vec3 uFresColor;
`;
    shader.fragmentShader = header + shader.fragmentShader;

    // Grade the albedo right after the day texture is sampled, before lighting.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  vec3 _c = diffuseColor.rgb;
  float _l = dot(_c, vec3(0.2126, 0.7152, 0.0722));
  _c = mix(vec3(_l), _c, uSat);
  _c = (_c - 0.5) * uContrast + 0.5;
  _c *= uTint;
  _c += uBright;
  diffuseColor.rgb = clamp(_c, 0.0, 1.0);
}`,
    );

    // City lights, ocean glint, and fresnel rim, added after lighting but
    // before tone mapping / output color conversion.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      `{
  vec3 N = normalize(vNormal);
  vec3 Vd = normalize(vViewPosition);
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float sd = dot(N, sunV);
  // City lights ramp up across the terminator onto the night side. Extract
  // only the bright city pixels by luminance so the night texture's dark
  // ocean blue does not bleed across the dark side, and tint them warm.
  float nightMix = smoothstep(0.08, -0.30, sd);
  vec3 nraw = texture2D(uNightMap, vMapUv).rgb;
  float lights = max(nraw.r, max(nraw.g, nraw.b));
  lights = smoothstep(0.18, 0.55, lights);
  vec3 warm = vec3(1.0, 0.82, 0.5);
  gl_FragColor.rgb += warm * lights * nightMix * uNightInt;
  // Ocean sun-glint: a tight specular on water facing the sun.
  float water = texture2D(uWaterMap, vMapUv).r;
  vec3 Rd = reflect(-sunV, N);
  float spec = pow(max(dot(Rd, Vd), 0.0), 60.0);
  gl_FragColor.rgb += vec3(0.7, 0.82, 1.0) * spec * water * smoothstep(-0.05, 0.25, sd) * uSpecInt;
  // Fresnel atmosphere rim, tight to the limb and brighter on the day side.
  float fres = pow(1.0 - max(dot(N, Vd), 0.0), 4.0);
  float lit = clamp(sd * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor.rgb += uFresColor * fres * (0.18 + 0.82 * lit) * uFresInt;
}
#include <tonemapping_fragment>`,
    );
  };
  mat.needsUpdate = true;
}
