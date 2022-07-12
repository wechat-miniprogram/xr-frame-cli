export const vert = `
attribute vec3 a_position;
attribute highp vec2 a_uv;
varying highp vec2 v_uv;

void main()
{
    v_uv = a_uv;
    gl_Position = vec4(a_position, 1.0);
}
`;

export const skyboxFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;
uniform float u_isHDR;

vec3 acesToneMapping(vec3 color) {
  return (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
}


vec3 LINEARtoSRGB(vec3 linearIn)
{
  vec3 linOut = pow(linearIn.xyz,vec3(1.0 / 2.2));

  return linOut;
}

void main()
{
  vec4 color = texture2D(u_texture, v_uv);

  if (u_isHDR == 0.) {
    gl_FragColor = vec4(LINEARtoSRGB(color.rgb), 1.0);
  } else {
    gl_FragColor = vec4(LINEARtoSRGB(acesToneMapping(color.rgb)), 1.0);
  }
}
`;

export const simpleFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;

void main()
{
  gl_FragColor = texture2D(u_texture, v_uv);
}
`;

export const blurFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;
uniform vec4 u_blurOffset;

#define GOLDEN_ANGLE 2.40 //(3.0-sqrt(5))*PI
#define BLUR_NUMBER 1024

mat2 rotate2D = mat2(cos(GOLDEN_ANGLE),sin(GOLDEN_ANGLE),-sin(GOLDEN_ANGLE),cos(GOLDEN_ANGLE));

vec3 linearMix(vec3 a, vec3 b, float factor) {
  return vec3(a * (1.0 - factor) + b * factor);
}

vec3 GaussianBlur(sampler2D map, vec2 uv, vec4 blurOffset) {
  vec4 uv01 = vec4(uv.x, uv.y, uv.x, uv.y) + blurOffset * vec4(1.0, 1.0, -1.0, -1.0);
  vec4 uv23 = vec4(uv.x, uv.y, uv.x, uv.y) + blurOffset * vec4(1.0, 1.0, -1.0, -1.0) * 2.0;
  vec4 uv45 = vec4(uv.x, uv.y, uv.x, uv.y) + blurOffset * vec4(1.0, 1.0, -1.0, -1.0) * 6.0;
  vec3 col = vec3(0.0);
  col += 0.40 * texture2D(map, uv).rgb;
  col += 0.15 * texture2D(map, uv01.xy).rgb;
  col += 0.15 * texture2D(map, uv01.zw).rgb;
  col += 0.10 * texture2D(map, uv23.xy).rgb;
  col += 0.10 * texture2D(map, uv23.zw).rgb;
  col += 0.05 * texture2D(map, uv45.xy).rgb;
  col += 0.05 * texture2D(map, uv45.zw).rgb;
  return col;
}

void main()
{
  vec2 uv = v_uv;
  // Gaussian Blur
  vec3 colGaussian = GaussianBlur(u_texture, uv, u_blurOffset);

  vec4 color = vec4(colGaussian, 1.0);

  gl_FragColor = color;
}
`;

export const mipmapsVert = `
attribute vec3 a_position;
attribute highp vec2 a_uv;
varying highp vec2 v_uv;

void main()
{
    v_uv = a_uv;
    gl_Position = vec4(a_position, 1.0);
}
`;

export const mipmapsFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;
uniform int u_lodIndex;

void main()
{
  vec2 uv = v_uv;
  // HDR
  vec4 color = texture2D(u_texture, uv);

  // RGBD
  float d = 1.;
  float m = max(color.r, max(color.g, color.b));
  if (m > 1.) {
    d = 1. / m;
  }

  color.r = color.r * d;
  color.g = color.g * d;
  color.b = color.b * d;
  color.a = d;

  gl_FragColor = color;
}
`;