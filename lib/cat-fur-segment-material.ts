import * as THREE from "three";
import {
  catFurDirectLightingGLSL,
  type CatFurMaterialSettings,
} from "./cat-fur-material";

export type CatFurSegmentMaterialSettings = CatFurMaterialSettings & {
  strandSegments?: number;
};

type SegmentUniforms = {
  catSegmentViewport: { value: THREE.Vector2 };
  catSegmentLodScale: { value: number };
  catSegmentFilter: { value: number };
  catSegmentSampling: { value: number };
  catSegmentStrandSegments: { value: number };
  catFurLongCoat: { value: number };
  catSegmentOpaqueDepth: { value: THREE.Texture | null };
  catSegmentHasOpaqueDepth: { value: number };
  catSegmentHasFilterEnds: { value: number };
};

const uniformsFor = new WeakMap<THREE.MeshStandardMaterial, SegmentUniforms>();

const flatParameters = /* glsl */ `
flat varying vec4 vCatSegmentScreen;
flat varying vec4 vCatSegmentClip;
flat varying vec4 vCatSegmentParameters;
flat varying vec4 vCatSegmentOffsets;
flat varying vec3 vCatSegmentViewStart;
flat varying vec3 vCatSegmentViewEnd;
flat varying vec3 vCatSegmentNormalStart;
flat varying vec3 vCatSegmentNormalEnd;
flat varying vec3 vCatSegmentColourStart;
flat varying vec3 vCatSegmentColourEnd;
`;

const vertexParameters = /* glsl */ `
attribute vec3 furStart;
attribute vec3 furEnd;
attribute vec3 furNormalStart;
attribute vec3 furNormalEnd;
attribute vec3 furColourStart;
attribute vec3 furColourEnd;
attribute vec3 furWidthStart;
attribute vec3 furWidthEnd;
attribute vec2 furFilterEnds;
uniform vec2 catSegmentViewport;
uniform float catSegmentLodScale;
uniform float catSegmentFilter;
uniform float catSegmentSampling;
uniform int catSegmentStrandSegments;
uniform float catSegmentHasFilterEnds;
${flatParameters}

float catSegmentPixelRadius( vec3 width, vec3 centreView ) {
  float radius = length( ( modelViewMatrix * vec4( width, 0.0 ) ).xyz );
  float divisor = projectionMatrix[3][3] == 0.0 ? abs( centreView.z ) : 1.0;
  return radius * abs( projectionMatrix[1][1] ) * catSegmentViewport.y
    / max( 2.0 * divisor, 0.000001 ) * catSegmentLodScale;
}
`;

const vertexSetup = /* glsl */ `
vec3 segmentView0 = ( modelViewMatrix * vec4( furStart, 1.0 ) ).xyz;
vec3 segmentView1 = ( modelViewMatrix * vec4( furEnd, 1.0 ) ).xyz;
vec4 segmentClip0 = projectionMatrix * vec4( segmentView0, 1.0 );
vec4 segmentClip1 = projectionMatrix * vec4( segmentView1, 1.0 );
vec2 segmentViewport = max( catSegmentViewport, vec2( 1.0 ) );
// Invisible/near-plane-crossing segments are clipped as a whole. The studio
// camera stays outside the cat; avoid infinities when an invalid clip w occurs.
bool segmentValid = segmentClip0.w > 0.000001 && segmentClip1.w > 0.000001;
vec2 segmentPixel0 = ( segmentClip0.xy / max( segmentClip0.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
vec2 segmentPixel1 = ( segmentClip1.xy / max( segmentClip1.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
vec2 segmentDelta = segmentPixel1 - segmentPixel0;
float segmentLength = length( segmentDelta );
vec2 segmentTangent = segmentLength > 0.000001 ? segmentDelta / segmentLength : vec2( 0.0, 1.0 );
vec2 segmentNormal = vec2( -segmentTangent.y, segmentTangent.x );
float segmentRadius0 = catSegmentPixelRadius( furWidthStart, segmentView0 );
float segmentRadius1 = catSegmentPixelRadius( furWidthEnd, segmentView1 );
vec2 segmentOffset0 = segmentNormal * segmentRadius0;
vec2 segmentOffset1 = segmentNormal * segmentRadius1;
vec2 segmentEnds = catSegmentHasFilterEnds > 0.5 ? abs( furFilterEnds ) : vec2( 1.0 );
bool segmentActualSpan = segmentEnds.x < 0.5 || segmentEnds.y < 0.5;
if ( segmentActualSpan ) {
  // Contact strands were physically flattened against the ground by the CPU.
  // Preserve their actual transverse vectors rather than re-inflating circles.
  vec4 minus0 = projectionMatrix * modelViewMatrix * vec4( furStart - furWidthStart * catSegmentLodScale, 1.0 );
  vec4 plus0 = projectionMatrix * modelViewMatrix * vec4( furStart + furWidthStart * catSegmentLodScale, 1.0 );
  vec4 minus1 = projectionMatrix * modelViewMatrix * vec4( furEnd - furWidthEnd * catSegmentLodScale, 1.0 );
  vec4 plus1 = projectionMatrix * modelViewMatrix * vec4( furEnd + furWidthEnd * catSegmentLodScale, 1.0 );
  segmentValid = segmentValid && minus0.w > 0.000001 && plus0.w > 0.000001
    && minus1.w > 0.000001 && plus1.w > 0.000001;
  vec2 pm0 = ( minus0.xy / max( minus0.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
  vec2 pp0 = ( plus0.xy / max( plus0.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
  vec2 pm1 = ( minus1.xy / max( minus1.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
  vec2 pp1 = ( plus1.xy / max( plus1.w, 0.000001 ) * 0.5 + 0.5 ) * segmentViewport;
  segmentPixel0 = ( pm0 + pp0 ) * 0.5;
  segmentPixel1 = ( pm1 + pp1 ) * 0.5;
  segmentOffset0 = ( pp0 - pm0 ) * 0.5;
  segmentOffset1 = ( pp1 - pm1 ) * 0.5;
  segmentDelta = segmentPixel1 - segmentPixel0;
  segmentLength = length( segmentDelta );
  segmentTangent = segmentLength > 0.000001 ? segmentDelta / segmentLength : vec2( 0.0, 1.0 );
  segmentNormal = vec2( -segmentTangent.y, segmentTangent.x );
}
vec2 segmentMinimum = min( min( segmentPixel0 - segmentOffset0, segmentPixel0 + segmentOffset0 ),
  min( segmentPixel1 - segmentOffset1, segmentPixel1 + segmentOffset1 ) );
vec2 segmentMaximum = max( max( segmentPixel0 - segmentOffset0, segmentPixel0 + segmentOffset0 ),
  max( segmentPixel1 - segmentOffset1, segmentPixel1 + segmentOffset1 ) );
// Conservative two-dimensional support includes finite end caps as well as
// transverse edges. The compact kernel shifts the finite polygon along N.
// Hardware raster coordinates use a finite subpixel grid. A tiny epsilon can
// snap an edge onto a pixel centre and lose that whole column to top-left
// ownership, even though the exact clipper would assign it nonzero coverage.
// Extra conservative fragments are rejected by the physical polygon clip.
vec2 segmentPadding = vec2( 0.125 );
if ( catSegmentSampling > 0.5 ) {
  segmentPadding += vec2( 0.5 );
  if ( catSegmentFilter > 1.5 ) segmentPadding += abs( segmentNormal ) * 0.3;
}
vec2 segmentRaster = mix( segmentMinimum - segmentPadding,
  segmentMaximum + segmentPadding, uv );
gl_Position = segmentValid ? vec4( segmentRaster / segmentViewport * 2.0 - 1.0, 0.0, 1.0 )
  : vec4( 2.0, 2.0, 2.0, 1.0 );
vCatSegmentScreen = vec4( segmentPixel0, segmentPixel1 );
vCatSegmentClip = vec4( segmentClip0.z / max( segmentClip0.w, 0.000001 ),
  segmentClip1.z / max( segmentClip1.w, 0.000001 ), segmentClip0.w, segmentClip1.w );
int segmentCount = max( catSegmentStrandSegments, 1 );
float segmentIndex = float( gl_InstanceID % segmentCount );
vCatSegmentParameters = vec4( segmentActualSpan ? 1.0 : 0.0, segmentLength,
  segmentIndex / float( segmentCount ), ( segmentIndex + 1.0 ) / float( segmentCount ) );
vCatSegmentOffsets = vec4( segmentOffset0, segmentOffset1 );
vCatSegmentViewStart = segmentView0;
vCatSegmentViewEnd = segmentView1;
vCatSegmentNormalStart = normalize( normalMatrix * furNormalStart );
vCatSegmentNormalEnd = normalize( normalMatrix * furNormalEnd );
vCatSegmentColourStart = furColourStart;
vCatSegmentColourEnd = furColourEnd;
`;

const fragmentParameters = /* glsl */ `
${flatParameters}
layout(location = 1) out highp vec4 catSegmentOpticalDepth;
uniform vec2 catSegmentViewport;
uniform float catSegmentFilter;
uniform float catSegmentSampling;
uniform float catFurLongCoat;
uniform sampler2D catSegmentOpaqueDepth;
uniform float catSegmentHasOpaqueDepth;

float catSegmentCross( vec2 a, vec2 b ) { return a.x * b.y - a.y * b.x; }

float catSegmentPixelPlane( vec2 p, int edge ) {
  if ( edge == 0 ) return p.x + 0.5;
  if ( edge == 1 ) return 0.5 - p.x;
  if ( edge == 2 ) return p.y + 0.5;
  return 0.5 - p.y;
}

void catSegmentAppend( inout vec2 polygon[8], inout int count, vec2 p ) {
  if ( count > 0 ) {
    vec2 difference = p - polygon[count - 1];
    if ( dot( difference, difference ) <= 0.000000000001 ) return;
  }
  // A convex quadrilateral intersected with a rectangle has at most 8
  // distinct vertices. Skip a closing duplicate before touching that bound.
  if ( count == 8 ) return;
  polygon[count] = p;
  count++;
}

float catSegmentPolygonArea( vec2 a, vec2 b, vec2 c, vec2 d ) {
  // Work relative to the pixel centre to avoid large-coordinate cancellation.
  vec2 polygon[8];
  vec2 outputPolygon[8];
  polygon[0] = a;
  polygon[1] = b;
  polygon[2] = c;
  polygon[3] = d;
  int count = 4;
  for ( int edge = 0; edge < 4; edge++ ) {
    int outputCount = 0;
    vec2 previous = polygon[count - 1];
    float previousDistance = catSegmentPixelPlane( previous, edge );
    for ( int i = 0; i < 8; i++ ) {
      if ( i >= count ) break;
      vec2 current = polygon[i];
      float currentDistance = catSegmentPixelPlane( current, edge );
      bool previousInside = previousDistance >= 0.0;
      bool currentInside = currentDistance >= 0.0;
      if ( previousInside != currentInside ) {
        float t = previousDistance / ( previousDistance - currentDistance );
        catSegmentAppend( outputPolygon, outputCount, mix( previous, current, t ) );
      }
      if ( currentInside ) catSegmentAppend( outputPolygon, outputCount, current );
      previous = current;
      previousDistance = currentDistance;
    }
    if ( outputCount == 0 ) return 0.0;
    if ( outputCount > 1 ) {
      vec2 closing = outputPolygon[outputCount - 1] - outputPolygon[0];
      if ( dot( closing, closing ) <= 0.000000000001 ) outputCount--;
    }
    count = outputCount;
    for ( int i = 0; i < 8; i++ ) {
      if ( i >= count ) break;
      polygon[i] = outputPolygon[i];
    }
  }
  float doubledArea = 0.0;
  vec2 previous = polygon[count - 1];
  for ( int i = 0; i < 8; i++ ) {
    if ( i >= count ) break;
    doubledArea += catSegmentCross( previous, polygon[i] );
    previous = polygon[i];
  }
  return clamp( abs( doubledArea ) * 0.5, 0.0, 1.0 );
}

float catSegmentFiniteCoverage( vec2 pixel, vec2 normal, float offset ) {
  vec2 start = vCatSegmentScreen.xy - pixel + normal * offset;
  vec2 end = vCatSegmentScreen.zw - pixel + normal * offset;
  vec2 a = start - vCatSegmentOffsets.xy;
  vec2 b = end - vCatSegmentOffsets.zw;
  vec2 c = end + vCatSegmentOffsets.zw;
  vec2 d = start + vCatSegmentOffsets.xy;
  if ( catSegmentSampling < 0.5 ) {
    vec3 triangle0 = vec3( catSegmentCross( b - a, -a ), catSegmentCross( d - b, -b ), catSegmentCross( a - d, -d ) );
    vec3 triangle1 = vec3( catSegmentCross( c - b, -b ), catSegmentCross( d - c, -c ), catSegmentCross( b - d, -d ) );
    bool in0 = abs( catSegmentCross( b - a, d - a ) ) > 0.000000000001
      && ( all( greaterThanEqual( triangle0, vec3( 0.0 ) ) ) || all( lessThanEqual( triangle0, vec3( 0.0 ) ) ) );
    bool in1 = abs( catSegmentCross( c - b, d - b ) ) > 0.000000000001
      && ( all( greaterThanEqual( triangle1, vec3( 0.0 ) ) ) || all( lessThanEqual( triangle1, vec3( 0.0 ) ) ) );
    return in0 || in1 ? 1.0 : 0.0;
  }
  if ( vCatSegmentParameters.x > 0.5 ) {
    // Original contact spans may rotate through a concave/degenerate quad.
    // Retain their physical diagonal rather than exceeding a convex clipper's
    // vertex bound or assigning area to a self-crossed quadrilateral.
    vec4 turns = vec4( catSegmentCross( b - a, c - b ), catSegmentCross( c - b, d - c ),
      catSegmentCross( d - c, a - d ), catSegmentCross( a - d, b - a ) );
    bool convex = all( greaterThanEqual( turns, vec4( 0.0 ) ) ) || all( lessThanEqual( turns, vec4( 0.0 ) ) );
    if ( !convex ) return clamp( catSegmentPolygonArea( a, b, d, d )
      + catSegmentPolygonArea( b, c, d, d ), 0.0, 1.0 );
  }
  return catSegmentPolygonArea( a, b, c, d );
}

vec3 catFurTangent() {
  vec3 delta = vCatSegmentViewEnd - vCatSegmentViewStart;
  float squaredLength = dot( delta, delta );
  return squaredLength > 0.000000000000000001 ? delta * inversesqrt( squaredLength ) : vec3( 0.0, 1.0, 0.0 );
}
`;

const fragmentSetup = /* glsl */ `
vec2 catSegmentDelta = vCatSegmentScreen.zw - vCatSegmentScreen.xy;
float catSegmentLengthSquared = dot( catSegmentDelta, catSegmentDelta );
if ( catSegmentLengthSquared < 0.000000000001 ) discard;
float catSegmentLength = vCatSegmentParameters.y;
vec2 catSegmentTangent = catSegmentDelta / catSegmentLength;
vec2 catSegmentNormal = vec2( -catSegmentTangent.y, catSegmentTangent.x );
vec2 catSegmentOffset = gl_FragCoord.xy - vCatSegmentScreen.xy;
float catSegmentAlong = dot( catSegmentOffset, catSegmentTangent );
float catSegmentAcross = dot( catSegmentOffset, catSegmentNormal );
// Cheap conservative rejection saves clipping/lighting outside the expanded
// finite strip, especially for long diagonals inside their screen-space AABB.
float catSegmentPixelNormal = 0.5 * ( abs( catSegmentNormal.x ) + abs( catSegmentNormal.y ) );
float catSegmentPixelAlong = 0.5 * ( abs( catSegmentTangent.x ) + abs( catSegmentTangent.y ) );
float catSegmentExtra = catSegmentFilter > 1.5 ? 0.3 : 0.0;
float catSegmentMaximumOffset = max( length( vCatSegmentOffsets.xy ), length( vCatSegmentOffsets.zw ) );
float catSegmentAlongOffset = max( abs( dot( vCatSegmentOffsets.xy, catSegmentTangent ) ),
  abs( dot( vCatSegmentOffsets.zw, catSegmentTangent ) ) );
if ( abs( catSegmentAcross ) > catSegmentMaximumOffset
  + catSegmentPixelNormal + catSegmentExtra + 0.0001 ) discard;
if ( catSegmentAlong < -catSegmentPixelAlong - catSegmentAlongOffset - 0.0001
  || catSegmentAlong > catSegmentLength + catSegmentPixelAlong + catSegmentAlongOffset + 0.0001 ) discard;
// Hidden segments are rejected before the costly exact polygon clipping.
float catSegmentScreenT = clamp( catSegmentAlong / catSegmentLength, 0.0, 1.0 );
// NDC depth is linear in screen t; attributes use perspective-correct t.
float catSegmentDepth = mix( vCatSegmentClip.x, vCatSegmentClip.y, catSegmentScreenT ) * 0.5 + 0.5;
if ( catSegmentDepth < 0.0 || catSegmentDepth > 1.0 ) discard;
if ( catSegmentHasOpaqueDepth > 0.5 ) {
  float opaque = texture2D( catSegmentOpaqueDepth,
    gl_FragCoord.xy / max( catSegmentViewport, vec2( 1.0 ) ) ).r;
  if ( catSegmentDepth > opaque + 0.000001 ) discard;
}
float catSegmentCoverage = catSegmentFiniteCoverage( gl_FragCoord.xy, catSegmentNormal, 0.0 );
if ( catSegmentFilter > 1.5 && catSegmentSampling > 0.5 ) {
  // Three-point Gauss-Legendre integration of a unit-mass transverse box
  // over [-.3,.3]. Every shifted finite polygon independently preserves area.
  float node = 0.2323790008;
  catSegmentCoverage = catSegmentCoverage * ( 4.0 / 9.0 )
    + ( catSegmentFiniteCoverage( gl_FragCoord.xy, catSegmentNormal, -node )
      + catSegmentFiniteCoverage( gl_FragCoord.xy, catSegmentNormal, node ) ) * ( 5.0 / 18.0 );
}
if ( catSegmentCoverage <= 0.0 ) discard;
gl_FragDepth = catSegmentDepth;
float catSegmentReciprocalW = ( 1.0 - catSegmentScreenT ) / vCatSegmentClip.z
  + catSegmentScreenT / vCatSegmentClip.w;
float catSegmentPerspectiveT = ( catSegmentScreenT / vCatSegmentClip.w )
  / max( catSegmentReciprocalW, 0.00000001 );
vViewPosition = -mix( vCatSegmentViewStart, vCatSegmentViewEnd, catSegmentPerspectiveT );
`;

/**
 * MRT-only finite-segment preview. Geometry supplies eight instanced vec3
 * attributes and a standard unit quad. Optional raw `furFilterEnds` bytes mark
 * contact/degenerate spans; missing flags mean both endpoints are ordinary.
 * No CPU/export positions are widened.
 * Colour ordering is weighted-OIT approximate; finite pixel area is explicit.
 */
export function createCatFurSegmentMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: "white",
    vertexColors: false,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: false,
    alphaToCoverage: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendEquationAlpha: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  material.name = "CatFur_FiniteSegmentOptics";
  material.userData.catFurSegmentOptics = {
    version: 3,
    coverageFilter: "box",
    coverage: "finite-trapezoid-pixel-intersection",
    export: false,
  };
  const uniforms: SegmentUniforms = {
    catSegmentViewport: { value: new THREE.Vector2(1, 1) },
    catSegmentLodScale: { value: 1 },
    catSegmentFilter: { value: 1 },
    catSegmentSampling: { value: 1 },
    catSegmentStrandSegments: { value: 4 },
    catFurLongCoat: { value: 0 },
    catSegmentOpaqueDepth: { value: null },
    catSegmentHasOpaqueDepth: { value: 0 },
    catSegmentHasFilterEnds: { value: 0 },
  };
  uniformsFor.set(material, uniforms);
  const viewport = new THREE.Vector4();
  material.onBeforeRender = (renderer, _scene, _camera, geometry) => {
    renderer.getCurrentViewport(viewport);
    uniforms.catSegmentViewport.value.set(viewport.z, viewport.w);
    uniforms.catSegmentHasFilterEnds.value = geometry.hasAttribute(
      "furFilterEnds",
    )
      ? 1
      : 0;
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexParameters}`)
      .replace("#include <begin_vertex>", "vec3 transformed = furStart;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${vertexSetup}`,
      );
    shader.fragmentShader = shader.fragmentShader
      // The fragment's actual shaded point belongs to the closest finite
      // segment position, rather than to the AABB's arbitrary quad depth.
      .replace("varying vec3 vViewPosition;", "vec3 vViewPosition;")
      .replace(
        "#include <lights_physical_pars_fragment>",
        `#include <lights_physical_pars_fragment>\n${fragmentParameters}\n${catFurDirectLightingGLSL}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `${fragmentSetup}\n#include <clipping_planes_fragment>`,
      )
      .replace(
        "#include <color_fragment>",
        "diffuseColor.rgb *= mix( vCatSegmentColourStart, vCatSegmentColourEnd, catSegmentPerspectiveT );",
      )
      .replace(
        "#include <alphatest_fragment>",
        "diffuseColor.a *= catSegmentCoverage; if ( diffuseColor.a <= 0.0 ) discard;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize( mix( vCatSegmentNormalStart, vCatSegmentNormalEnd, catSegmentPerspectiveT ) );
        vec3 nonPerturbedNormal = normal;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float furGlobalT = mix( vCatSegmentParameters.z, vCatSegmentParameters.w, catSegmentPerspectiveT );
        outgoingLight *= mix( mix( 0.93, 0.88, catFurLongCoat ), 1.0, smoothstep( 0.0, 0.55, furGlobalT ) );
        #include <opaque_fragment>`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        float furAlpha = clamp( diffuseColor.a, 0.0, 1.0 );
        gl_FragColor = vec4( max( gl_FragColor.rgb, vec3( 0.0 ) ) * furAlpha, furAlpha );
        catSegmentOpticalDepth = vec4( -log( max( 1.0 - furAlpha, 0.0001 ) ), 0.0, 0.0, 0.0 );`,
      );
  };
  material.customProgramCacheKey = () => "cat-fur-finite-segment-optics-v3";
  return material;
}

/** This preview material stays in accumulation mode; the compositor owns it. */
export function configureCatFurSegmentMaterial(
  material: THREE.MeshStandardMaterial,
  settings: CatFurSegmentMaterialSettings,
): void {
  const uniforms = uniformsFor.get(material);
  if (!uniforms) return;
  if (settings.coatType !== undefined)
    uniforms.catFurLongCoat.value = settings.coatType === "long" ? 1 : 0;
  if (settings.detailLevel !== undefined) {
    const detail = THREE.MathUtils.clamp(settings.detailLevel, 0.18, 1);
    uniforms.catSegmentLodScale.value = Math.min(2.4, 1 / Math.sqrt(detail));
  }
  if (settings.sampling !== undefined)
    uniforms.catSegmentSampling.value = settings.sampling ? 1 : 0;
  if (settings.coverageFilter !== undefined) {
    uniforms.catSegmentFilter.value =
      settings.coverageFilter === "compact" ? 2 : 1;
    material.userData.catFurSegmentOptics.coverageFilter =
      settings.coverageFilter;
  }
  if (settings.opaqueDepth !== undefined) {
    uniforms.catSegmentOpaqueDepth.value = settings.opaqueDepth;
    uniforms.catSegmentHasOpaqueDepth.value = settings.opaqueDepth ? 1 : 0;
  }
  if (settings.strandSegments !== undefined)
    uniforms.catSegmentStrandSegments.value = THREE.MathUtils.clamp(
      Math.floor(settings.strandSegments),
      1,
      16,
    );
}
