/**
 * renderer.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 6/30/2022, 5:46:02 PM
 */
import * as GL from 'gl';
import {indexes, vertexes} from './buffers';
import {IImage} from './image';
import {blurFrag, mipmapsFrag, skyboxFrag, vert} from './shaders';

class Renderer {
  private _gl: WebGLRenderingContext;
  private _resizeExt: any;
  private _floatExt: OES_texture_float;
  private _shaders: {[name: string]: {
    program: WebGLProgram,
    aPosition: number,
    aUV: number,
    uTex: WebGLUniformLocation
  }} = {};
  private _ib: WebGLBuffer;
  private _vb: WebGLBuffer;
  private _rtCache: {[width: number]: WebGLFramebuffer} = {};
  private _texCache: {[key: string]: WebGLFramebuffer} = {};
  private _resPixels: {[size: number]: Uint8Array} = {};

  constructor() {
    const gl: WebGLRenderingContext = this._gl = GL(2048, 2048, {preserveDrawingBuffer: true});
    this._resizeExt = this._gl.getExtension('STACKGL_resize_drawingbuffer');
    this._floatExt = this._gl.getExtension('OES_texture_float');

    this._createBuffers();
    this._createProgram('blur', vert, blurFrag);
    this._createProgram('mipmaps', vert, mipmapsFrag);
    this._createProgram('skybox', vert, skyboxFrag);

    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
  }

  // return png, if hdr, use rgbd
  public process(image: IImage, width: number, height: number): {
    specular: Uint8Array,
    skybox: Uint8Array,
    diffuse: number[][]
  } {
    const gl = this._gl;

    const blured = this._blur(image, width, height);
    const specular = this._mipmaps(blured, width);
    const skybox = this._skybox(image, width, height);

    return {specular, skybox, diffuse: this._generateSH()};
  }

  private _skybox(image: IImage, width: number, height: number): Uint8Array {
    const gl = this._gl;
    this._resizeExt.resize(width, height);
    const shader = this._shaders['skybox'];
    const tex = this._getTexture(image.width, image.height, image.rgb, image.hdr, image.premultiplyAlpha, image.buffer);
    const rt = this._getRT(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt);
    gl.viewport(0, 0, width, height);
    gl.useProgram(shader.program);
    this._bindBuffers('skybox');
    gl.uniform1i(shader.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    const len = width * height * 4;
    let pixels = this._resPixels[len];
    if (!pixels) {
      pixels = this._resPixels[len] = new Uint8Array(len);
    }

    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    return pixels;
  }

  private _blur(image: IImage, width: number, height: number): WebGLFramebuffer {
    const gl = this._gl;
    const shader = this._shaders['blur'];
    const tex = this._getTexture(image.width, image.height, image.rgb, image.hdr, image.premultiplyAlpha, image.buffer);
    const rt = this._getRT(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt);
    gl.viewport(0, 0, width, height);
    gl.useProgram(shader.program);
    this._bindBuffers('blur');
    gl.uniform1i(shader.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    return rt;
  }

  private _mipmaps(source: WebGLFramebuffer, size: number): Uint8Array {
    const gl = this._gl;
    this._resizeExt.resize(size, size);
    const shader = this._shaders['mipmaps'];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(shader.program);
    this._bindBuffers('mipmaps');
    gl.uniform1i(shader.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    const len = size * size * 4;
    let pixels = this._resPixels[len];
    if (!pixels) {
      pixels = this._resPixels[len] = new Uint8Array(len);
    }

    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    return pixels;
  }

  private _generateSH() {
    return [];
  }

  private _getTexture(
    width: number, height: number, rgb: boolean, hdr: boolean, premultiplyAlpha: boolean,
    source?: ArrayBufferView, useCache: boolean = true
  ): WebGLTexture {
    const gl = this._gl;
    const key = `${width}_${height}_${hdr}`;
    let tex = this._texCache[key];
    const format = rgb ? gl.RGB : gl.RGBA;
    const type = hdr ? gl.FLOAT : gl.UNSIGNED_BYTE;

    if (useCache && tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplyAlpha);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, source);
      return tex;
    }

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplyAlpha);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, source);

    if (useCache) {
      this._texCache[key] = tex;
    }

    return tex;
  }

  private _getRT(width: number, height: number) {
    if (this._rtCache[width]) {
      return this._rtCache[width];
    }

    const gl = this._gl;

    const tex = this._getTexture(width, height, false, true, false, null, false);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    this._rtCache[width] = fb;

    return fb;
  }

  private _createProgram(name: string, vs: string, fs: string) {
    if (this._shaders[name]) {
      return this._shaders[name];
    }

    const gl = this._gl;
    const program = gl.createProgram();

    const v = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(v, vs);
    gl.compileShader(v);
    const f = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(f, fs);
    gl.compileShader(f);

    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);

    const shader = this._shaders[name] = {program, aPosition: undefined, aUV: undefined, uTex: undefined};

    for (let i = 0; i < 2; i += 1) {
      const {name} = gl.getActiveAttrib(program, i);
      const location = gl.getAttribLocation(program, name);
      if (name === 'a_position') {
        shader.aPosition = location;
      } else if (name === 'a_uv') {
        shader.aUV = location;
      }
    }

    const num = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < num; i += 1) {
      let {name} = gl.getActiveUniform(program, i);
      if (name === 'u_texture') {
        shader.uTex = gl.getUniformLocation(program, name);
      }
    }

    return program;
  }

  private _createBuffers() {
    const gl = this._gl;

    const ib = this._ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexes, gl.STATIC_DRAW);

    const vb = this._vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, vertexes, gl.STATIC_DRAW);

  }

  private _bindBuffers(shaderName: string) {
    const gl = this._gl;
    const shader = this._shaders[shaderName];

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ib);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vb);
    gl.vertexAttribPointer(shader.aPosition, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(shader.aPosition);
    gl.vertexAttribPointer(shader.aUV, 2, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(shader.aUV);
  }
}

const renderer = new Renderer();
export default renderer;
