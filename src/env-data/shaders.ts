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

vec3 acesToneMapping(vec3 color) {
  return (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
}


vec3 SRGBtoLINEAR(vec3 linearIn)
{
  vec3 linOut = pow(linearIn.xyz,vec3(2.2));

  return linOut;
}
vec3 LINEARtoSRGB(vec3 linearIn)
{
  vec3 linOut = pow(linearIn.xyz,vec3(1.0 / 2.2));

  return linOut;
}

void main()
{
  vec4 color = texture2D(u_texture, v_uv);

  gl_FragColor = vec4(acesToneMapping(color.rgb), 1.0);
}
`;

export const blurFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;

void main()
{
  gl_FragColor = texture2D(u_texture, v_uv);
}
`;

export const mipmapsVert = `
attribute vec3 a_position;
attribute highp vec2 a_uv;
varying highp vec2 v_uv;
varying highp vec3 v_localPos;


void main()
{
    v_uv = a_uv;
    v_localPos = a_position;
    gl_Position = vec4(a_position, 1.0);
}
`;


export const mipmapsFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;

#define GOLDEN_ANGLE 2.40 //(3.0-sqrt(5))*PI
#define BLUR_NUMBER 1024

mat2 rotate2D = mat2(cos(GOLDEN_ANGLE),sin(GOLDEN_ANGLE),-sin(GOLDEN_ANGLE),cos(GOLDEN_ANGLE));


void main()
{
  vec2 uv = v_uv;
  float logv = log2(1. - uv.y);
  float lod = floor(-logv);

  // MINMAPS
  float scale = pow(2., lod);
  uv.x *= scale;
  uv.y = 2. * (uv.y * scale - scale + 1.);

  if (uv.x > 1.) {
    gl_FragColor = vec4(1., 1., 1., 1.);
  } else {
    // HDR
    vec4 color = vec4(0.0, 0.0, 0.0, 1.0);

    float logBlurLevel = lod;

    // default resolution
    vec2 resolution = vec2(2048.0, 1024.0);

    // Bokeh Blur
    vec3 colBokeh = vec3(0.);
    vec3 tot = colBokeh;
    float radius = 1.0 * logBlurLevel;
    vec2 angle = vec2(radius / (float(BLUR_NUMBER) * resolution.x));
    float r = 0.0;
    for(int i = 0; i< BLUR_NUMBER; ++i){
      r += 1.;
      angle = rotate2D * angle;
      vec3 c = texture2D(u_texture, uv + r * angle).rgb;
    	c = c * c * 1.5;
      vec3 bokeh = pow(c, vec3(4.0));
      colBokeh += c * bokeh;
      tot += bokeh;
    }
    colBokeh /= tot;

    // Gaussian Blur
    vec3 colGaussian = vec3(0.);

    float stepValue = 0.01 * logBlurLevel;

    vec3 sum = vec3(0.0);
    // 3x3
    // [6 7 8]
    // [3 4 5]
    // [0 1 2]
    sum += 1.0 * texture2D(u_texture, uv + vec2(-stepValue, -stepValue)).rgb;
    sum += 2.0 * texture2D(u_texture, uv + vec2(0.0, -stepValue)).rgb;
    sum += 1.0 * texture2D(u_texture, uv + vec2(stepValue, -stepValue)).rgb;
    sum += 2.0 * texture2D(u_texture, uv + vec2(-stepValue, 0.0)).rgb;
    sum += 4.0 * texture2D(u_texture, uv + vec2(0.0, 0.0)).rgb;
    sum += 2.0 * texture2D(u_texture, uv + vec2(stepValue, 0.0)).rgb;
    sum += 1.0 * texture2D(u_texture, uv + vec2(-stepValue, stepValue)).rgb;
    sum += 2.0 * texture2D(u_texture, uv + vec2(0.0, stepValue)).rgb;
    sum += 1.0 * texture2D(u_texture, uv + vec2(stepValue, stepValue)).rgb;

    colGaussian = sum / 16.0;

    vec3 colResult = mix(colBokeh, colGaussian, 0.5);

    color = vec4(colResult, 1.0);
    
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
}
`;