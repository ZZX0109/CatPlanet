/* SPDX-License-Identifier: BSD-3-Clause
 * Legacy Hair BSDF evaluation adapted from Blender v3.6.23 bsdf_hair.h.
 * Copyright (c) 2009-2010 Sony Pictures Imageworks Inc., et al.
 * Modifications Copyright 2011-2022 Blender Foundation.
 * Attribution/terms: artifacts/native-groom-capture/optics-source-study/BSD-3-Clause.txt
 * This is the legacy reflection/transmission model, NOT Principled Hair.
 */

export type NativeLegacyHairComponent = "reflection" | "transmission";
export type NativeLegacyHairEvalInput = {
  component: NativeLegacyHairComponent;
  normal: ArrayLike<number>;
  tangent: ArrayLike<number>;
  /** Surface -> eye, matching Cycles wi and Three geometryViewDir. */
  view: ArrayLike<number>;
  /** Surface -> light, matching Cycles wo and Three directLight.direction. */
  light: ArrayLike<number>;
  roughnessU: number;
  roughnessV: number;
  /** UI node Offset in radians. Cycles stores its negative in the closure. */
  offsetRadians: number;
};

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
function unit(input: ArrayLike<number>): V3 | null {
  if (
    input.length !== 3 ||
    ![input[0], input[1], input[2]].every(Number.isFinite)
  )
    throw new Error(
      "Legacy hair directions must contain three finite coordinates.",
    );
  const length = Math.hypot(input[0], input[1], input[2]);
  return length > 1e-12
    ? [input[0] / length, input[1] / length, input[2] / length]
    : null;
}

/**
 * Bare source closure value (including its projected/cosine measure), and the
 * same closure's PDF. Do not multiply evalCos by N.L or 1/pi again. Multiply
 * it by original closure RGB weight and incoming radiance, then add closures.
 * A graph mixture PDF is NOT the sum of these per-closure PDFs.
 * `valid=false` is a guarded degenerate frame, not a fitted brightness change.
 */
export function evalNativeLegacyHair(input: NativeLegacyHairEvalInput): {
  evalCos: number;
  pdf: number;
  valid: boolean;
} {
  if (
    (input.component !== "reflection" && input.component !== "transmission") ||
    ![input.roughnessU, input.roughnessV, input.offsetRadians].every(
      Number.isFinite,
    )
  )
    throw new Error(
      "Legacy hair component and roughness/offset must be valid finite values.",
    );
  const N = unit(input.normal),
    T = unit(input.tangent),
    V = unit(input.view),
    L = unit(input.light);
  if (!N || !T || !V || !L) return { evalCos: 0, pdf: 0, valid: false };
  const reflected = input.component === "reflection";
  if (reflected ? dot(N, L) < 0 : dot(N, L) >= 0)
    return { evalCos: 0, pdf: 0, valid: true };
  const tv = clamp(dot(T, V), -1, 1),
    tl = clamp(dot(T, L), -1, 1);
  const vp = unit([V[0] - T[0] * tv, V[1] - T[1] * tv, V[2] - T[2] * tv]);
  const lp = unit([L[0] - T[0] * tl, L[1] - T[1] * tl, L[2] - T[2] * tl]);
  if (!vp || !lp) return { evalCos: 0, pdf: 0, valid: false };
  const thetaR = Math.PI / 2 - Math.acos(tv),
    thetaI = Math.PI / 2 - Math.acos(tl);
  const azimuthCos = clamp(dot(vp, lp), -1, 1);
  if (Math.PI / 2 - Math.abs(thetaI) < 0.001 || (reflected && azimuthCos < 0))
    return { evalCos: 0, pdf: 0, valid: true };
  const alpha = clamp(input.roughnessU, 0.001, 1),
    beta = clamp(input.roughnessV, 0.001, 1);
  const offset = -input.offsetRadians;
  const a = Math.atan(((Math.PI / 2 + thetaR) / 2 - offset) / alpha);
  const b = Math.atan(((-Math.PI / 2 + thetaR) / 2 - offset) / alpha);
  const h = (thetaI + thetaR) / 2 - offset;
  const longitudinal =
    alpha / (2 * (h * h + alpha * alpha) * (a - b) * Math.cos(thetaI));
  const phi = Math.acos(azimuthCos);
  const azimuthal = reflected
    ? Math.cos(Math.min(phi / beta, Math.PI) / 2) / (4 * beta)
    : beta /
      (2 *
        Math.atan(Math.PI / (2 * beta)) *
        ((Math.PI - phi) ** 2 + beta * beta));
  const value = longitudinal * azimuthal;
  if (!Number.isFinite(value) || value < 0)
    return { evalCos: 0, pdf: 0, valid: false };
  return { evalCos: value, pdf: value, valid: true };
}

/**
 * Same bare evaluator for private direct-light integration. component 0=R,1=T.
 * vec2 return = (evalCos,pdf). Uses a range-reduced atan polynomial to avoid
 * implementation-dependent acos/atan error amplified by the narrow U lobe.
 * This is equation-equivalent, not a bitwise copy of Cycles fast-math.
 * Round source N / billboard N, indirect light, visibility and multiple
 * scattering remain the caller's responsibility; this does not implement them.
 */
export const NATIVE_LEGACY_HAIR_GLSL = /* glsl */ `
// Range reduction: |u| <= sqrt(2)-1. Eight alternating terms have a real-
// arithmetic next-term bound <3.7e-8 rad; Float32 rounding is separate.
float catNativeHairAtan( float x ) {
  const float nlHalfPi = 1.5707963267948966;
  float a = abs( x );
  bool invert = a > 1.0;
  float r = invert ? 1.0 / a : a;
  float u = r / ( 1.0 + sqrt( 1.0 + r * r ) );
  float u2 = u * u;
  float polynomial = 1.0 + u2 * ( -1.0 / 3.0 + u2 * ( 1.0 / 5.0
    + u2 * ( -1.0 / 7.0 + u2 * ( 1.0 / 9.0 + u2 * ( -1.0 / 11.0
    + u2 * ( 1.0 / 13.0 - u2 / 15.0 ) ) ) ) ) );
  float angle = 2.0 * u * polynomial;
  return sign( x ) * ( invert ? nlHalfPi - angle : angle );
}

float catNativeHairAtan2( float y, float x ) {
  const float nlPi = 3.141592653589793;
  if ( abs( x ) + abs( y ) <= 1e-20 ) return 0.0;
  if ( abs( x ) >= abs( y ) ) {
    float angle = catNativeHairAtan( y / x );
    return x < 0.0 ? angle + ( y >= 0.0 ? nlPi : -nlPi ) : angle;
  }
  return sign( y ) * nlPi * 0.5 - catNativeHairAtan( x / y );
}

vec2 catNativeLegacyHairEval( int component, vec3 N, vec3 T, vec3 V, vec3 L,
  vec2 roughnessUV, float offsetRadians ) {
  const float nlPi = 3.141592653589793;
  float nn = length( N ), tn = length( T ), vn = length( V ), ln = length( L );
  if ( min( min( nn, tn ), min( vn, ln ) ) <= 1e-12 ) return vec2( 0.0 );
  N /= nn; T /= tn; V /= vn; L /= ln;
  if ( component == 0 ? dot( N, L ) < 0.0 : dot( N, L ) >= 0.0 ) return vec2( 0.0 );
  float tv = clamp( dot( T, V ), -1.0, 1.0 );
  float tl = clamp( dot( T, L ), -1.0, 1.0 );
  vec3 vp = V - T * tv, lp = L - T * tl;
  float vpLength = length( vp ), lpLength = length( lp );
  if ( min( vpLength, lpLength ) <= 1e-12 ) return vec2( 0.0 );
  float thetaR = catNativeHairAtan2( tv, vpLength );
  float thetaI = catNativeHairAtan2( tl, lpLength );
  vec3 vpUnit = vp / vpLength, lpUnit = lp / lpLength;
  float azimuthCos = clamp( dot( vpUnit, lpUnit ), -1.0, 1.0 );
  if ( nlPi * 0.5 - abs( thetaI ) < 0.001 || ( component == 0 && azimuthCos < 0.0 ) ) return vec2( 0.0 );
  float alpha = clamp( roughnessUV.x, 0.001, 1.0 );
  float beta = clamp( roughnessUV.y, 0.001, 1.0 );
  float offset = -offsetRadians;
  float a = catNativeHairAtan( ( ( nlPi * 0.5 + thetaR ) * 0.5 - offset ) / alpha );
  float b = catNativeHairAtan( ( ( -nlPi * 0.5 + thetaR ) * 0.5 - offset ) / alpha );
  float h = ( thetaI + thetaR ) * 0.5 - offset;
  float denominator = 2.0 * ( h * h + alpha * alpha ) * ( a - b ) * cos( thetaI );
  if ( denominator <= 0.0 ) return vec2( 0.0 );
  float phi = catNativeHairAtan2( length( cross( vpUnit, lpUnit ) ), azimuthCos );
  float azimuthal;
  if ( component == 0 ) {
    azimuthal = cos( min( phi / beta, nlPi ) * 0.5 ) / ( 4.0 * beta );
  } else {
    float q = nlPi - phi;
    azimuthal = beta / ( ( 2.0 * catNativeHairAtan( nlPi / ( 2.0 * beta ) ) ) * ( q * q + beta * beta ) );
  }
  float value = max( alpha * azimuthal / denominator, 0.0 );
  return vec2( value );
}
`;
