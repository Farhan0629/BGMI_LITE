/**
 * GLSL ES 3.00 shader library (WebGL2).
 *
 * Everything is instanced and shares one lighting model:
 *  - directional sun with 3x3 PCF shadow mapping
 *  - hemispheric ambient (sky colour above, bounced ground colour below)
 *  - up to 8 dynamic point lights (street lamps, muzzle flashes, fires)
 *  - exponential height fog for atmospheric perspective
 *  - ACES-ish tone mapping + bloom + vignette in the post pass
 */

export const LIGHTING_CHUNK = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 uCamPos;
uniform mat4 uShadowMatrix;
uniform sampler2D uShadowMap;
uniform float uShadowEnabled;
uniform int uLightCount;
uniform vec4 uLightPos[8];
uniform vec3 uLightColor[8];

float shadowFactor(vec3 world, float ndl) {
  if (uShadowEnabled < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(world, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x < 0.001 || p.x > 0.999 || p.y < 0.001 || p.y > 0.999 || p.z > 0.999) return 1.0;
  float bias = mix(0.0016, 0.0005, ndl);
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float d = texture(uShadowMap, p.xy + vec2(float(x), float(y)) * texel).r;
      sum += p.z - bias > d ? 0.0 : 1.0;
    }
  }
  return sum / 9.0;
}

vec3 shadeSurface(vec3 world, vec3 normal, vec3 albedo, float roughness, float ao) {
  vec3 n = normalize(normal);
  vec3 viewDir = normalize(uCamPos - world);
  float ndl = max(dot(n, uSunDir), 0.0);
  float shadow = shadowFactor(world, ndl);

  vec3 color = albedo * uSunColor * ndl * shadow;

  // Hemispheric ambient term with baked AO.
  float up = n.y * 0.5 + 0.5;
  vec3 ambient = mix(uAmbientGround, uAmbientSky, up) * albedo * ao;
  color += ambient;

  // Sun specular.
  vec3 h = normalize(uSunDir + viewDir);
  float gloss = mix(96.0, 6.0, roughness);
  float spec = pow(max(dot(n, h), 0.0), gloss) * (1.0 - roughness) * 0.55;
  color += uSunColor * spec * shadow;

  // Dynamic point lights.
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec3 toLight = uLightPos[i].xyz - world;
    float dist = length(toLight);
    float range = uLightPos[i].w;
    if (dist > range) continue;
    vec3 ldir = toLight / max(dist, 0.0001);
    float atten = pow(1.0 - dist / range, 2.0);
    float lambert = max(dot(n, ldir), 0.0);
    color += albedo * uLightColor[i] * lambert * atten;
    vec3 lh = normalize(ldir + viewDir);
    color += uLightColor[i] * pow(max(dot(n, lh), 0.0), gloss) * (1.0 - roughness) * atten * 0.4;
  }

  return color;
}

vec3 applyFog(vec3 color, vec3 world) {
  float dist = length(world - uCamPos);
  float heightFalloff = exp(-max(world.y - uFogHeight, 0.0) * 0.02);
  float amount = 1.0 - exp(-dist * uFogDensity * heightFalloff);
  return mix(color, uFogColor, clamp(amount, 0.0, 1.0));
}
`

export const MESH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aModel0;
layout(location = 3) in vec4 aModel1;
layout(location = 4) in vec4 aModel2;
layout(location = 5) in vec4 aModel3;
layout(location = 6) in vec4 aColorRough;
layout(location = 7) in vec4 aExtra;

uniform mat4 uViewProj;
uniform float uTime;
uniform float uWindStrength;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vAlbedo;
out float vRough;
out float vEmissive;
out float vAo;

void main() {
  mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
  vec4 world = model * vec4(aPos, 1.0);

  // Vegetation sway: strength stored per instance in aExtra.y.
  float wind = aExtra.y * uWindStrength;
  if (wind > 0.0) {
    float phase = uTime * 1.7 + world.x * 0.35 + world.z * 0.27;
    float h = max(aPos.y, 0.0);
    world.x += sin(phase) * wind * h * 0.12;
    world.z += cos(phase * 0.83) * wind * h * 0.09;
  }

  vWorld = world.xyz;
  vNormal = mat3(model) * aNormal;
  vAlbedo = aColorRough.rgb;
  vRough = aColorRough.a;
  vEmissive = aExtra.x;
  vAo = aExtra.z;
  gl_Position = uViewProj * world;
}
`

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 vWorld;
in vec3 vNormal;
in vec3 vAlbedo;
in float vRough;
in float vEmissive;
in float vAo;
out vec4 fragColor;

${LIGHTING_CHUNK}

void main() {
  vec3 color = shadeSurface(vWorld, vNormal, vAlbedo, vRough, vAo);
  color += vAlbedo * vEmissive * 2.2;
  color = applyFog(color, vWorld);
  fragColor = vec4(color, 1.0);
}
`

/** Depth-only pass for instanced meshes (shadow map). */
export const DEPTH_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aModel0;
layout(location = 3) in vec4 aModel1;
layout(location = 4) in vec4 aModel2;
layout(location = 5) in vec4 aModel3;
uniform mat4 uViewProj;
void main() {
  mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
  gl_Position = uViewProj * model * vec4(aPos, 1.0);
}
`

/** Depth-only pass for non-instanced geometry (terrain). */
export const DEPTH_PLAIN_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

export const DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
void main() {}
`

export const TERRAIN_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vWorld = aPos;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`

/**
 * Terrain material is fully procedural: sand near the water line, grass on
 * gentle slopes, dirt on medium slopes and rock on cliffs, blended with noise
 * so there is no visible tiling.
 */
export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 vWorld;
in vec3 vNormal;
out vec4 fragColor;

${LIGHTING_CHUNK}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 n = normalize(vNormal);
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  float detail = noise2(vWorld.xz * 0.35) * 0.5 + noise2(vWorld.xz * 1.7) * 0.3;

  vec3 sand = vec3(0.62, 0.57, 0.44);
  vec3 grass = vec3(0.21, 0.28, 0.15);
  vec3 dirt = vec3(0.31, 0.26, 0.19);
  vec3 rock = vec3(0.29, 0.29, 0.3);

  float beach = 1.0 - smoothstep(0.4, 3.4, vWorld.y);
  float rocky = smoothstep(0.34, 0.62, slope + detail * 0.12);
  float dirtMix = smoothstep(0.12, 0.34, slope) * (1.0 - rocky);

  vec3 albedo = mix(grass, dirt, dirtMix);
  albedo = mix(albedo, rock, rocky);
  albedo = mix(albedo, sand, beach);
  albedo *= 0.85 + detail * 0.3;

  float rough = mix(0.95, 0.75, rocky);
  vec3 color = shadeSurface(vWorld, n, albedo, rough, 1.0);
  color = applyFog(color, vWorld);
  fragColor = vec4(color, 1.0);
}
`

/** Cheap but convincing ocean: three crossing gerstner-ish waves + fresnel. */
export const WATER_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aXZ;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uTime;
uniform float uWaterLevel;
out vec3 vWorld;
out vec3 vNormal;

void main() {
  vec2 xz = aXZ + uCenter.xz;
  float t = uTime;
  float h = sin(xz.x * 0.11 + t * 1.1) * 0.18
          + sin(xz.y * 0.09 - t * 0.85) * 0.15
          + sin((xz.x + xz.y) * 0.17 + t * 1.6) * 0.08;
  float dx = cos(xz.x * 0.11 + t * 1.1) * 0.11 * 0.18 + cos((xz.x + xz.y) * 0.17 + t * 1.6) * 0.17 * 0.08;
  float dz = cos(xz.y * 0.09 - t * 0.85) * 0.09 * 0.15 + cos((xz.x + xz.y) * 0.17 + t * 1.6) * 0.17 * 0.08;
  vWorld = vec3(xz.x, uWaterLevel + h, xz.y);
  vNormal = normalize(vec3(-dx, 1.0, -dz));
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 vWorld;
in vec3 vNormal;
out vec4 fragColor;

uniform vec3 uSkyColor;

${LIGHTING_CHUNK}

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uCamPos - vWorld);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

  vec3 deep = vec3(0.024, 0.062, 0.082);
  vec3 shallow = vec3(0.07, 0.16, 0.18);
  vec3 albedo = mix(deep, shallow, clamp(fresnel * 1.5, 0.0, 1.0));

  vec3 color = albedo * (uAmbientSky * 0.8 + uSunColor * max(dot(n, uSunDir), 0.0) * 0.25);
  color = mix(color, uSkyColor, fresnel * 0.7);

  // Specular sun glint on the wave crests.
  vec3 h = normalize(uSunDir + viewDir);
  color += uSunColor * pow(max(dot(n, h), 0.0), 220.0) * 1.6;

  color = applyFog(color, vWorld);
  fragColor = vec4(color, 1.0);
}
`

/** Fullscreen sky: gradient + sun disc + stars at night. */
export const SKY_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos, 1.0, 1.0);
}
`

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uNight;

float starField(vec3 dir) {
  vec3 p = floor(dir * 260.0);
  float h = fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  return smoothstep(0.9985, 1.0, h) * 1.6;
}

void main() {
  vec4 far = uInvViewProj * vec4(vUv, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(uSkyHorizon, uSkyTop, pow(up, 0.65));
  color = mix(uFogColor, color, smoothstep(0.0, 0.22, dir.y + 0.1));

  float sun = max(dot(dir, uSunDir), 0.0);
  color += uSunColor * pow(sun, 900.0) * 14.0;
  color += uSunColor * pow(sun, 16.0) * 0.35;
  color += vec3(starField(dir)) * uNight * max(dir.y, 0.0);

  fragColor = vec4(color, 1.0);
}
`

export const PARTICLE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aPosSize;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
uniform float uViewportHeight;
out vec4 vColor;
void main() {
  vec4 clip = uViewProj * vec4(aPosSize.xyz, 1.0);
  gl_Position = clip;
  float w = max(clip.w, 0.15);
  gl_PointSize = clamp(aPosSize.w * uViewportHeight / w, 1.0, 260.0);
  vColor = aColor;
}
`

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = dot(uv, uv);
  if (r > 1.0) discard;
  float falloff = pow(1.0 - r, 1.6);
  fragColor = vec4(vColor.rgb, vColor.a * falloff);
}
`

export const POST_VS = SKY_VS

/** Tone mapping, bloom, colour grading, vignette and damage tint. */
export const POST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uBloom;
uniform float uVignette;
uniform float uDamage;
uniform float uSaturation;
uniform vec3 uGrade;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 color = texture(uScene, uv).rgb;

  if (uBloom > 0.0) {
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int i = -3; i <= 3; i++) {
      float w = 1.0 - abs(float(i)) / 4.0;
      sum += texture(uScene, uv + vec2(float(i) * uTexel.x * 2.4, 0.0)).rgb * w;
      sum += texture(uScene, uv + vec2(0.0, float(i) * uTexel.y * 2.4)).rgb * w;
      weight += w * 2.0;
    }
    vec3 blur = sum / weight;
    vec3 bright = max(blur - vec3(0.75), vec3(0.0));
    color += bright * uBloom;
  }

  color = aces(color * uExposure);
  color *= uGrade;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uSaturation);

  float d = length(vUv);
  color *= 1.0 - uVignette * smoothstep(0.55, 1.45, d);

  if (uDamage > 0.0) {
    float edge = smoothstep(0.25, 1.2, d);
    color = mix(color, vec3(0.55, 0.03, 0.03), edge * uDamage * 0.85);
  }

  fragColor = vec4(color, 1.0);
}
`
