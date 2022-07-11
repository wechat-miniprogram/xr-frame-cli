/**
 * decodeImage.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 6/30/2022, 5:23:49 PM
 */
import * as path from 'path';
import * as fs from 'fs';
import * as sharp from 'sharp';
import * as hdr from 'hdr';
import * as exr from './tinyexr.js';
import {showError} from '../utils.js';

// XYZtoRGB Mat
const XYZtoRGB = [
	3.2405, -1.5371, -0.4985,
	-0.9693, 1.8760, 0.0416,
	0.0556, -0.2040, 1.0572
];

function MatrixDstVectorMultiply(mat, dstVec, offset) {
  const x = dstVec[offset + 0];
  const y = dstVec[offset + 1];
  const z = dstVec[offset + 2];
	dstVec[offset + 0] = mat[0] * x + mat[1] * y + mat[2] * z;
	dstVec[offset + 1] = mat[3] * x + mat[4] * y + mat[5] * z;
	dstVec[offset + 2] = mat[6] * x + mat[7] * y + mat[8] * z;
}

function srgb2Rgb(v: number): number {
  v = v / 255;
  const v1 = Math.pow(v *  0.9478672986 + 0.0521327014, 2.4);
  const v2 = v * 0.0773993808;

  return Math.floor((v < 0.04045 ? v2 : v1) * 255);
}

export interface IImage {
  width: number;
  height: number;
  hdr: boolean;
  rgb: boolean;
  premultiplyAlpha: boolean;
  buffer: ArrayBufferView;
}

export async function decodeImage(src: string): Promise<IImage> {
  const ext = path.extname(src);

  if (ext === '.exr') {
    const data = new Uint8Array(fs.readFileSync(src));
    const instance = new exr.EXRLoader(data);

    if (!instance.ok()) {
      throw new Error(`EXR加载错误 ${instance.error()}`);
    }

    return {
      width: instance.width(), height: instance.height(), premultiplyAlpha: false,
      hdr: true, rgb: false, buffer: instance.getBytes()
    }
  }

  if (ext === '.hdr') {
    return new Promise((resolve, reject) => {
      const file = fs.createReadStream(src);
      const hdrloader = new hdr.loader();

      hdrloader.on('load', function() {
        // console.log(this.headers);
        // XYZ
        const colorFloat32 = this.data as Float32Array;

        // XYZ 2 RGB
        for(let i = 0; i < colorFloat32.length / 3; i++) {
          MatrixDstVectorMultiply(XYZtoRGB, colorFloat32, i * 3);
        }

        resolve({
          width: this.width, height: this.height, premultiplyAlpha: false,
          hdr: true, rgb: true, buffer: colorFloat32
        });
      });

      hdrloader.on('error', () => reject(new Error('HDR加载错误')));

      file.pipe(hdrloader);
    });
  }

  const instance = await sharp(src);
  const info = await instance.metadata();
  const {data} = await instance.raw().toBuffer({resolveWithObject: true});

  if (info.space === 'srgb') {
    const view = data;
    for (let i = 0; i < view.length; i += info.channels) {
      view[i] = srgb2Rgb(view[i]);
      view[i + 1] = srgb2Rgb(view[i + 1]);
      view[i + 2] = srgb2Rgb(view[i + 2]);
    }
  } else if (info.space !== 'rgb') {
    showError(`图片色彩空间为'${info.space}'，不支持，仅支持'rgb'和'srgb'！`);
  }
  
  return {
    width: info.width, height: info.height, premultiplyAlpha: info.premultiplied,
    hdr: false, rgb: info.channels === 3, buffer: new Uint8Array(data)
  };
}

export async function encodeImage(
  colorBuffer: ArrayBufferView,
  width: number, height: number,
  png: boolean, palette: boolean = false
): Promise<ArrayBuffer> {
  const img = sharp(colorBuffer, {
    raw: {width, height, channels: 4, premultiplied: false}
  })
  
  if (png) {
    return img.png({palette}).toBuffer();
  }
  
  return img.jpeg().toBuffer();
}
