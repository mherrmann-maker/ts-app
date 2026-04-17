import * as THREE from 'three'

// ─── Shared procedural GLSL (WebGL 1.0 compatible, no extensions needed) ──────
const PROC_GLSL = /* glsl */`
  float _h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  vec2  _h2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}

  float _vn(vec2 p){
    vec2 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(_h1(i),_h1(i+vec2(1,0)),f.x),
               mix(_h1(i+vec2(0,1)),_h1(i+vec2(1,1)),f.x),f.y);
  }

  // 5-octave fBm
  float _fbm(vec2 p){
    float v=0.,a=.5;
    for(int i=0;i<5;i++){v+=a*_vn(p);p*=2.1;a*=.48;}
    return v;
  }

  // Voronoi – returns (dist-to-nearest-center, per-cell random id)
  vec2 _vor(vec2 p){
    vec2 i=floor(p),f=fract(p);
    float md=8.; vec2 mc=vec2(0.);
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec2 nb=vec2(float(x),float(y));
      vec2 pt=_h2(i+nb);
      pt=.5+.5*sin(6.2831853*pt);   // scatter point inside cell
      vec2 d=nb+pt-f; float dl=length(d);
      if(dl<md){md=dl;mc=i+nb+pt;}
    }
    return vec2(md,_h1(mc));
  }
`

// ─── Registry for uTime-driven materials ──────────────────────────────────────
const _timeUniforms: Record<string, { value: number }>[] = []

/** Call every frame with clock.getElapsedTime() */
export function tickArchMaterials(t: number): void {
  for (const u of _timeUniforms) u['uTime'].value = t
}

// ─── Helper: inject GLSL into Three.js standard PBR shader ────────────────────
type CompileShader = Parameters<NonNullable<THREE.MeshStandardMaterial['onBeforeCompile']>>[0]

function injectProc(
  shader: CompileShader,
  mapCode: string,
  roughCode: string,
  needsTime = false,
): void {
  if (needsTime) {
    shader.uniforms['uTime'] = { value: 0 }
    _timeUniforms.push(shader.uniforms as Record<string, { value: number }>)
    shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader
  }
  shader.fragmentShader = PROC_GLSL + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>',       `#include <map_fragment>\n${mapCode}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughCode}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONCRETE
//    Grey, micro-porous with FBM variation and vertical stain streaks
// ─────────────────────────────────────────────────────────────────────────────
export function createConcreteMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 })

  mat.onBeforeCompile = (s) => {
    injectProc(s,
      /* map */ /* glsl */`{
        vec2 uv = vUv * 10.0;
        float macro   = _fbm(uv * 0.35);
        float micro   = _fbm(uv * 3.0) * .5 + _fbm(uv * 7.0) * .25;
        float streak  = _vn(vec2(uv.x * 1.8, uv.y * .05)) * .14;
        float h       = macro * .55 + micro * .45 - streak;
        // base neutral grey with slight warm/cool tint
        diffuseColor.rgb = vec3(.52, .50, .47) + (h - .5) * .22;
        // small-scale speckle
        diffuseColor.rgb += (_vn(uv * 9.) - .5) * .04;
      }`,
      /* rough */ /* glsl */`{
        roughnessFactor = clamp(roughnessFactor + _fbm(vUv * 22.) * .10, 0., 1.);
      }`,
    )
  }
  return mat
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. WOOD
//    Warm oak grain with distorted ring pattern and fine grain lines
// ─────────────────────────────────────────────────────────────────────────────
export function createWoodMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 })

  mat.onBeforeCompile = (s) => {
    injectProc(s,
      /* map */ /* glsl */`{
        vec2 uv = vUv * vec2(6., 2.);            // stretch along plank direction
        float distort = _fbm(uv * .65) * 2.4;   // wavy grain distortion
        float rings   = abs(fract((uv.x + distort) * 1.15) - .5) * 2.;
        float grain   = _fbm(vec2(uv.x * .07, uv.y * 5.)) * .28
                      + _vn(vec2(uv.x * .04, uv.y * 10.)) * .10;
        float h = mix(rings, 1., .22) + grain;
        vec3 dark  = vec3(.50, .28, .11);
        vec3 light = vec3(.84, .65, .39);
        diffuseColor.rgb = mix(dark, light, clamp(h, 0., 1.));
      }`,
      /* rough */ /* glsl */`{
        roughnessFactor = clamp(roughnessFactor + (_vn(vUv * 9.) - .5) * .20, 0., 1.);
      }`,
    )
  }
  return mat
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WET PEBBLE FLOOR
//    Voronoi cells = individual pebbles, dark grooves with animated water shimmer
//    Low roughness (wet look), uTime drives micro-ripples in groove water
// ─────────────────────────────────────────────────────────────────────────────
export function createWetPebbleMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.04 })

  mat.onBeforeCompile = (s) => {
    injectProc(s,
      /* map */ /* glsl */`{
        vec2 uv  = vUv * 5.0;
        vec2 vor = _vor(uv);                       // x=dist, y=cell-id
        float groove = 1. - smoothstep(0., .18, vor.x);

        // each pebble gets a unique grey-brown tone
        float hue = _h1(vec2(vor.y, vor.y * 1.73));
        vec3 pebble = mix(
          vec3(.30, .28, .26),   // dark blue-grey pebble
          vec3(.46, .43, .38),   // warm grey-brown pebble
          hue
        ) * .60;                  // * .60 = wet darkening

        // groove water: nearly black
        vec3 grooveCol = vec3(.04, .04, .05);

        // animated shimmer / micro ripples in groove water
        float shimmer = _vn(uv * 3.5 + uTime * .28) * groove * .07;

        diffuseColor.rgb = mix(pebble, grooveCol, groove) + shimmer;
      }`,
      /* rough */ /* glsl */`{
        vec2 uv  = vUv * 5.0;
        vec2 vor = _vor(uv);
        float groove  = 1. - smoothstep(0., .18, vor.x);
        float ripple  = _vn(uv * 2.5 + uTime * .38) * .06 * groove;
        // grooves (water) even glossier than pebble tops
        roughnessFactor = mix(.10, .02, groove) + ripple;
      }`,
      /* needsTime */ true,
    )
  }
  return mat
}
