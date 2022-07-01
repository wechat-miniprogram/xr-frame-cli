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
        resolve({
          width: this.width, height: this.height, premultiplyAlpha: false,
          hdr: true, rgb: true, buffer: this.data
        });
      });

      hdrloader.on('error', () => reject(new Error('HDR加载错误')));

      file.pipe(hdrloader);
    });
  }

  const {data, info} = await sharp(src).raw().toBuffer({resolveWithObject: true});
  
  return {
    width: info.width, height: info.height, premultiplyAlpha: info.premultiplied,
    hdr: false, rgb: info.channels === 3, buffer: new Uint8Array(data)
  };
}

export async function encodeImage(
  colorBuffer: ArrayBufferView,
  width: number, height: number, png: boolean
): Promise<ArrayBuffer> {
  const img = sharp(colorBuffer, {
    raw: {width, height, channels: 4, premultiplied: false}
  })
  
  if (png) {
    return img.png().toBuffer();
  }
  
  return img.jpeg().toBuffer();
}
