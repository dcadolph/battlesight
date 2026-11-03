// Cinematic globe enhancement. Puts back the cues that make a globe read as a
// planet and not a map wrapped on a ball: a day/night terminator with warm
// city lights, a tight sun glint on water, and a fresnel limb glow.
//
// The globe has two looks. The tile look is the normal one: Sentinel-2
// cloudless tiles are already a lit, graded photograph, so the rig only has to
// not ruin it, and no grade pass runs on tiles. three-slippy-map-globe builds
// one MeshLambertMaterial mesh per tile on demand, so the shader patch hooks
// the tile engine's add and patches each tile before its first render. The
// stock look is the rate-limit fallback: the textured Phong sphere with the
// older warm rig and grade.
//
// Nothing here touches the renderer pipeline (setPixelRatio, texture
// anisotropy, needsUpdate on loaded textures), because that forced a WebGL
// context-loss/restore cycle that crashes three.js. Adding scene lights and
// patching a material's shader via onBeforeCompile only recompiles programs.
// Every entry point is wrapped in try/catch so a bad shader degrades to the
// plain globe instead of black-screening the app.

import * as THREE from 'three';
import type { GlobeMethods } from 'react-globe.gl';

import { tileEngineOf } from './imagery';

// City-lights and ocean-mask textures, pulled from the same three-globe CDN
// the app already uses for the night-sky background, so no new bundled
// assets and no new origins. Both are equirectangular.
const NIGHT_URL = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-night.jpg';
const WATER_URL = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-water.png';

// GlobeLook names the two looks: streamed tiles, or the stock sphere fallback.
export type GlobeLook = 'tiles' | 'stock';

// Rig is a three-light setup: ambient, a sun-side key, and a cool fill from
// the far side for limb shape.
interface Rig {
  // ambientColor is the ambient light color.
  ambientColor: number;
  // ambient is the ambient light intensity.
  ambient: number;
  // keyColor is the sun-side directional light color.
  keyColor: number;
  // key is the sun-side directional light intensity.
  key: number;
  // fill is the cool far-side fill light intensity.
  fill: number;
}

// CinematicOpts tunes the stock look. Defaults are chosen for the landing
// globe.
export interface CinematicOpts extends Rig {
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
}

// DEFAULT_CINEMATIC is the stock fallback look, unchanged from before tiles.
export const DEFAULT_CINEMATIC: CinematicOpts = {
  sun: [-0.5, 0.3, 0.8],
  saturation: 0.6,
  contrast: 1.2,
  brightness: -0.05,
  tint: [1.02, 1.0, 0.95],
  nightIntensity: 1.3,
  specIntensity: 0.3,
  fresnelIntensity: 0.3,
  fresnelColor: [0.48, 0.6, 0.8],
  ambientColor: 0x5b6c86,
  ambient: 0.42,
  keyColor: 0xfff3e2,
  key: 2.5,
  fill: 0.45,
};

// TileLookOpts tunes the tile look.
export interface TileLookOpts extends Rig {
  // sun is the world-space direction toward the sun.
  sun: [number, number, number];
  // nightIntensity scales the city-lights glow on the dark side.
  nightIntensity: number;
  // specIntensity scales the sun glint on water.
  specIntensity: number;
  // specExponent sets the glint's tightness. Higher is a smaller highlight.
  specExponent: number;
  // fresnelIntensity scales the limb glow on the sphere surface.
  fresnelIntensity: number;
  // fresnelColor is the limb-glow color.
  fresnelColor: [number, number, number];
}

// DEFAULT_TILE_LOOK is the tile look. Lambert divides by pi, so the key plus
// the ambient lights the sub-solar point at about 70 percent display
// brightness, which keeps bright desert texture out of clipping, and the
// ambient alone leaves the night side near 35 percent. A key of 6 whites the
// Sahara out.
export const DEFAULT_TILE_LOOK: TileLookOpts = {
  sun: [-0.5, 0.3, 0.8],
  ambientColor: 0x8c96a6,
  ambient: 0.95,
  keyColor: 0xffffff,
  key: 1.15,
  fill: 0.25,
  nightIntensity: 1.3,
  specIntensity: 0.18,
  specExponent: 200,
  fresnelIntensity: 0.3,
  fresnelColor: [0.48, 0.6, 0.8],
};

// GlobeLike is the slice of the react-globe.gl imperative handle we touch.
type GlobeLike = GlobeMethods & {
  scene?: () => THREE.Scene;
  __bsLook?: GlobeLook;
};

// maskTextures holds the shared night and water textures, loaded once.
let maskTextures: { night: THREE.Texture; water: THREE.Texture } | undefined;

// masks returns the night and water textures, loading them on first use. Both
// are treated as linear data so the values add predictably to the lit color
// before the output sRGB conversion.
function masks(): { night: THREE.Texture; water: THREE.Texture } {
  if (maskTextures) return maskTextures;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const night = loader.load(NIGHT_URL);
  const water = loader.load(WATER_URL);
  for (const t of [night, water]) {
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  maskTextures = { night, water };
  return maskTextures;
}

// findGlobeMaterial locates the stock sphere's MeshPhongMaterial by walking
// the scene. react-globe.gl's globeMaterial() getter only returns a
// caller-supplied override, so the internal default material is invisible to
// it. The globe is the largest SphereGeometry mesh carrying a Phong material.
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

// enhanceGlobe applies a look to a globe instance. Safe to call repeatedly;
// it does nothing when the look is already applied. The tile look waits for
// the tile engine to join the scene, retrying every frame so it hooks the
// engine before the first tile texture arrives.
export function enhanceGlobe(globe: GlobeMethods | undefined, look: GlobeLook = 'tiles'): void {
  const g = globe as GlobeLike | undefined;
  if (!g || g.__bsLook === look) return;
  g.__bsLook = look;

  let attempts = 0;
  const tryApply = () => {
    attempts++;
    try {
      const scene = g.scene?.();
      if (look === 'tiles') {
        const engine = scene ? tileEngineOf(scene) : undefined;
        if (!scene || !engine) {
          if (attempts < 240) requestAnimationFrame(tryApply);
          return;
        }
        applyRig(scene, DEFAULT_TILE_LOOK, DEFAULT_TILE_LOOK.sun);
        hookTiles(engine, DEFAULT_TILE_LOOK);
        return;
      }
      const mat = scene ? findGlobeMaterial(scene) : undefined;
      if (!scene || !mat) {
        if (attempts < 40) setTimeout(tryApply, 120);
        return;
      }
      applyRig(scene, DEFAULT_CINEMATIC, DEFAULT_CINEMATIC.sun);
      patchStockMaterial(mat, DEFAULT_CINEMATIC);
    } catch (err) {
      // Leave the plain globe in place; never let a shader bug black-screen.
      console.warn('cinematic globe enhancement skipped:', err);
    }
  };
  tryApply();
}

// applyRig sets the scene's ambient and first directional light to the rig,
// with the key aimed along the sun direction, and keeps exactly one cool fill
// light on the far side.
function applyRig(scene: THREE.Scene, rig: Rig, sunDir: [number, number, number]): void {
  const sun = new THREE.Vector3(...sunDir).normalize();
  let ambient: THREE.AmbientLight | undefined;
  let key: THREE.DirectionalLight | undefined;
  let fill: THREE.DirectionalLight | undefined;
  scene.traverse((obj) => {
    const l = obj as THREE.Light;
    if ((l as THREE.AmbientLight).isAmbientLight && !ambient) ambient = l as THREE.AmbientLight;
    if ((l as THREE.DirectionalLight).isDirectionalLight) {
      if (l.userData.bsFill) fill = l as THREE.DirectionalLight;
      else if (!key) key = l as THREE.DirectionalLight;
    }
  });
  if (!ambient) {
    ambient = new THREE.AmbientLight();
    scene.add(ambient);
  }
  ambient.color.set(rig.ambientColor);
  ambient.intensity = rig.ambient;
  if (!key) {
    key = new THREE.DirectionalLight();
    scene.add(key);
  }
  key.color.set(rig.keyColor);
  key.intensity = rig.key;
  key.position.copy(sun).multiplyScalar(500);
  if (!fill) {
    fill = new THREE.DirectionalLight(0x9fc0ff);
    fill.userData.bsFill = true;
    scene.add(fill);
  }
  fill.intensity = rig.fill;
  fill.position.set(-sun.x * 400, Math.abs(sun.y) * 200 + 160, -sun.z * 400);
}

// TILE_PROGRAM_KEY makes every patched tile share one compiled program.
const TILE_PROGRAM_KEY = 'bs-tile-look-v1';

// hookTiles patches every tile mesh the engine holds now and every one it
// adds later. The engine adds a tile only after its texture loads, so the
// patch always lands before the tile's first render.
function hookTiles(engine: THREE.Object3D, o: TileLookOpts): void {
  const { night, water } = masks();
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(...o.sun).normalize() },
    uNightMap: { value: night },
    uWaterMap: { value: water },
    uNightInt: { value: o.nightIntensity },
    uSpecInt: { value: o.specIntensity },
    uSpecExp: { value: o.specExponent },
    uFresInt: { value: o.fresnelIntensity },
    uFresColor: { value: new THREE.Vector3(...o.fresnelColor) },
  };
  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vBsGeo;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvBsGeo = position;',
    );
    shader.fragmentShader = TILE_FRAGMENT_HEADER + shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      TILE_FRAGMENT_LOOK + '\n#include <tonemapping_fragment>',
    );
  };
  const patch = (obj: THREE.Object3D) => {
    const mat = (obj as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (!(obj as THREE.Mesh).isMesh || !mat?.isMeshLambertMaterial || mat.userData.bsTile) return;
    mat.userData.bsTile = true;
    mat.onBeforeCompile = onBeforeCompile;
    mat.customProgramCacheKey = () => TILE_PROGRAM_KEY;
    mat.needsUpdate = true;
  };
  engine.children.forEach(patch);
  const add = engine.add.bind(engine);
  engine.add = (...objs: THREE.Object3D[]) => {
    objs.forEach(patch);
    return add(...objs);
  };
}

// TILE_FRAGMENT_HEADER declares the tile look's uniforms and the varying that
// carries each vertex's globe-space position.
const TILE_FRAGMENT_HEADER = `
varying vec3 vBsGeo;
uniform vec3 uSunDir;
uniform sampler2D uNightMap;
uniform sampler2D uWaterMap;
uniform float uNightInt;
uniform float uSpecInt;
uniform float uSpecExp;
uniform float uFresInt;
uniform vec3 uFresColor;
`;

// TILE_FRAGMENT_LOOK adds city lights, glint, and the limb glow after
// lighting. Tile UVs are per tile, so the equirectangular night and water
// masks are sampled by the longitude and latitude of the globe-space position
// (three-slippy-map-globe puts longitude 0 on +z and 90 E on +x). The
// gradients are taken from whichever of two longitude parameterizations is
// continuous at the pixel, so the antimeridian draws no seam.
const TILE_FRAGMENT_LOOK = `{
  vec3 gp = normalize(vBsGeo);
  vec2 eq = vec2(atan(gp.x, gp.z) * 0.15915494 + 0.5, asin(clamp(gp.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  vec2 eqAlt = vec2(fract(eq.x + 0.5), eq.y);
  vec2 gx = dFdx(eq);
  vec2 gy = dFdy(eq);
  vec2 gxAlt = dFdx(eqAlt);
  vec2 gyAlt = dFdy(eqAlt);
  if (abs(gxAlt.x) < abs(gx.x)) gx.x = gxAlt.x;
  if (abs(gyAlt.x) < abs(gy.x)) gy.x = gyAlt.x;
  vec3 N = normalize(vNormal);
  vec3 Vd = normalize(vViewPosition);
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float sd = dot(N, sunV);
  // City lights ramp up across the terminator onto the night side. Only the
  // bright city pixels are kept, tinted warm.
  float nightMix = smoothstep(0.08, -0.30, sd);
  vec3 nraw = textureGrad(uNightMap, eq, gx, gy).rgb;
  float lights = smoothstep(0.18, 0.55, max(nraw.r, max(nraw.g, nraw.b)));
  gl_FragColor.rgb += vec3(1.0, 0.82, 0.5) * lights * nightMix * uNightInt;
  // Sun glint: a tight white highlight on water facing the sun.
  float water = textureGrad(uWaterMap, eq, gx, gy).r;
  vec3 Rd = reflect(-sunV, N);
  float spec = pow(max(dot(Rd, Vd), 0.0), uSpecExp);
  gl_FragColor.rgb += vec3(1.0) * spec * water * smoothstep(-0.05, 0.25, sd) * uSpecInt;
  // Fresnel limb glow, tight to the limb and brighter on the day side.
  float fres = pow(1.0 - max(dot(N, Vd), 0.0), 4.0);
  float lit = clamp(sd * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor.rgb += uFresColor * fres * (0.18 + 0.82 * lit) * uFresInt;
}`;

// patchStockMaterial injects the day/night, ocean-glint, fresnel, and grade
// passes into the stock sphere's MeshPhong shader via onBeforeCompile,
// keeping three-globe's own map and bump texture binding intact. It runs only
// once the fallback has given the sphere its map, so vMapUv exists.
function patchStockMaterial(mat: THREE.MeshPhongMaterial, o: CinematicOpts): void {
  const { night, water } = masks();
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(...o.sun).normalize() },
    uNightMap: { value: night },
    uWaterMap: { value: water },
    uSat: { value: o.saturation },
    uContrast: { value: o.contrast },
    uBright: { value: o.brightness },
    uTint: { value: new THREE.Vector3(...o.tint) },
    uNightInt: { value: o.nightIntensity },
    uSpecInt: { value: o.specIntensity },
    uFresInt: { value: o.fresnelIntensity },
    uFresColor: { value: new THREE.Vector3(...o.fresnelColor) },
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
  float nightMix = smoothstep(0.08, -0.30, sd);
  vec3 nraw = texture2D(uNightMap, vMapUv).rgb;
  float lights = max(nraw.r, max(nraw.g, nraw.b));
  lights = smoothstep(0.18, 0.55, lights);
  vec3 warm = vec3(1.0, 0.82, 0.5);
  gl_FragColor.rgb += warm * lights * nightMix * uNightInt;
  float water = texture2D(uWaterMap, vMapUv).r;
  vec3 Rd = reflect(-sunV, N);
  float spec = pow(max(dot(Rd, Vd), 0.0), 60.0);
  gl_FragColor.rgb += vec3(0.7, 0.82, 1.0) * spec * water * smoothstep(-0.05, 0.25, sd) * uSpecInt;
  float fres = pow(1.0 - max(dot(N, Vd), 0.0), 4.0);
  float lit = clamp(sd * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor.rgb += uFresColor * fres * (0.18 + 0.82 * lit) * uFresInt;
}
#include <tonemapping_fragment>`,
    );
  };
  mat.needsUpdate = true;
}
