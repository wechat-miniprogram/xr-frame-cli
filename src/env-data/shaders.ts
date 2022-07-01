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

export const mipmapsFrag = `
precision mediump float;
precision highp int;
varying highp vec2 v_uv;

uniform sampler2D u_texture;

void main()
{
  vec2 uv = v_uv;
  float logv = log2(1. - uv.y);
  float lod = floor(-logv);

  float scale = pow(2., lod);
  uv.x *= scale;
  uv.y = 2. * (uv.y * scale - scale + 1.);

  if (uv.x > 1.) {
    gl_FragColor = vec4(1., 1., 1., 1.);
  } else {
    vec4 color = texture2D(u_texture, uv);
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