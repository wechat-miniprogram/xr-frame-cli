/**
 * utils.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:59:41
 */
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'ncp';

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
  const res: string[] = [];

  function walk(dirPath: string, currentDepth: number) {
    if (currentDepth <= 0) {
      return;
    }

    const children = fs.readdirSync(dirPath);
    for (const child of children) {
      if (fs.statSync(child).isDirectory()) {
        walk(path.join(dirPath, child), currentDepth - 1);
        continue;
      }

      const fp = path.resolve(dirPath, child);
      if (filter(fp)) {
        res.push(fp);
      }
    }
  }

  walk(dp, depth);

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

export async function copyFile(from: string, to: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.copyFile(from, to, err => {
      if (err) {
        return reject(err);
      }

      resolve(to);
    })
  });
};

export async function readFileJson(filePath: string): Promise<Object> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, { encoding: 'utf8' }, (err, content: string) => {
      if (err) {
        reject(err)
      } else {
        resolve(JSON.parse(content));
      }
    })
  })
};

export async function readFileBuffer(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, content: Buffer) => {
      if (err) {
        reject(err)
      } else {
        resolve(content);
      }
    })
  })
};

export async function writeFile(filePath: string, buffer: Buffer | string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, buffer, typeof buffer === 'string' ? {encoding: 'utf8'} : {}, err => {
      if (err) {
        reject(err);
      } else {
        resolve(filePath);
      }
    })
  });
};

export async function removeFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};


cp.limit = 16;
cp.stopOnErr = true;
export async function copyDir(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cp(src, dest, err => {
      if (err) {
        console.error(err);
        return reject(err);
      }

      resolve();
    });
  });
}
