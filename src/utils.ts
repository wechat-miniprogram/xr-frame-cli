/**
 * utils.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:59:41
 */
import * as path from 'path';
import * as fs from 'fs';

export function showError(msg: string) {
  console.error('\x1b[31m%s', `Error: ${msg}`);
  process.exit(0);
}

export function showWarn(msg: string) {
  console.error('\x1b[33m%s', `Warn: ${msg}`);
}

export function showInfo(msg: string) {
  console.info('\x1b[32m%s\x1b[0m', msg);
}

export function toSnakeCase(str: string) {
    const upperChars = str.match(/([A-Z])/g);
    if (! upperChars) {
      return str;
    }

    for (var i = 0, n = upperChars.length; i < n; i += 1) {
      str = str.replace(new RegExp(upperChars[i]), '-' + upperChars[i].toLowerCase());
    }

    if (str.slice(0, 1) === '-') {
      str = str.slice(1);
    }

    return str;
}

export function getChildrenFromFolder(dp: string, filter: (fp: string) => boolean, depth: number = 1): string[] {
  const children = fs.readdirSync(dp);
  const res: string[] = [];

  for (const child of children) {
    if (!fs.statSync(child).isDirectory()) {
      const fp = path.resolve(dp, child);
      if (filter(fp)) {
        res.push(fp);
      }
    }
  }

  return res;
}

const IMAGE_EXT = ['hdr', 'exr', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff'];
export function isImageFile(fp: string) {
  return IMAGE_EXT.indexOf(path.extname(fp).slice(1)) >= 0;
}

const GLTF_EXT = ['gltf', 'glb'];
export function isGLTFFile(fp: string) {
  return GLTF_EXT.indexOf(path.extname(fp).slice(1)) >= 0;
}
