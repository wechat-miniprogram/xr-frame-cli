/**
 * index.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:45:38
 */
import * as path from 'path';
import * as fs from 'fs';
import * as yargs from 'yargs';
import * as gltfPipe from 'gltf-pipeline';
import * as tmp from 'tmp';
import * as shell from 'shelljs';
import {
  showError,
  toSnakeCase,
  showInfo,
  isImageFile,
  showWarn,
  getChildrenFromFolder,
  isGLTFFile,
  copyDir,
  readFileBuffer,
  copyFile,
  writeFile,
  removeFile,
  readFileJson
} from '../utils';

interface IEntity {
  iDir: string;
  file: string;
  isGLB: boolean;
  oDir: string;
}

function getTypeByteLenth(type: string) {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
    case 'MAT2':
      return 4;
    case 'MAT3':
      return 9;
    case 'MAT4':
      return 16;
  }
}

function getComponentByteLenthAndClass(type: number): [number, new (...any) => ArrayBufferView] {
  switch (type) {
    case 5120:
      return [1, Int8Array];
    case 5121:
      return [1, Uint8Array];
    case 5122:
      return [2, Int16Array];
    case 5123:
      return [2, Uint16Array];
    case 5125:
      return [4, Uint32Array];
    case 5126:
      return [4, Float32Array];
  }
}

function getEntity(fp: string, o: string, toGLB: boolean): IEntity {
  const iDir = path.dirname(fp);
  const file = path.basename(fp);
  const isGLB = path.extname(fp) === '.glb';
  const oDir = toGLB ? o : path.resolve(o, path.dirname(fp).split('/').pop());

  return {iDir, file, isGLB, oDir};
}

// assets里的是相对于iDir的路径
async function processGlTF(entity: IEntity): Promise<{gltf: Object, assets: string[];}> {
  let gltf: any;
  let separateResources: {[key: string]: Buffer;};
  const assets: string[] = [];
  const buffers: {[path: string]: Buffer;} = {};

  if (!fs.existsSync(entity.oDir)) {
    fs.mkdirSync(entity.oDir);
  }

  if (entity.isGLB) {
    const buffer = await readFileBuffer(path.resolve(entity.iDir, entity.file));
    const res = await gltfPipe.glbToGltf(buffer, {separate: true});
    gltf = res.gltf;
    separateResources = res;
  } else {
    const json = await readFileJson(path.resolve(entity.iDir, entity.file));
    const res = await gltfPipe.processGltf(json, {separate: true});
    gltf = res.gltf;
    separateResources = res;
  }

  for (const relativePath in separateResources) {
    const op = path.resolve(entity.oDir, relativePath);
    await writeFile(op, separateResources[relativePath]);
    if (!/.bin$/.test(op)) {
      assets.push(op);
    } else {
      buffers[relativePath] = separateResources[relativePath];
    }
  }

  processMeshes(gltf, buffers);
  gltf.extensionsUsed = gltf.extensionsUsed || [];
  gltf.extensionsUsed.push('WX_prcessed_model');

  return {gltf, assets};
}

async function processMeshes(gltf: any, buffers: {[path: string]: Buffer;}) {
  if (!gltf.meshes) {
    return;
  }

  const bufferViews = gltf.bufferViews.map(bv => {
    bv.byteOffset = bv.byteOffset || 0;
    bv.buffer = buffers[gltf.buffers[bv.buffer].uri].slice(bv.byteOffset, bv.byteLength);
    delete bv.byteOffset;
    delete bv.byteLength;
    return bv;
  });

  const geometries: {[attr: string]: number;}[] = [];
  gltf.meshes.forEach(mesh => {
    if (!mesh.primitives) {
      return;
    }

    const {primitives} = mesh;

    primitives.forEach(prim => {
      const {attributes, material} = prim;

      let index: number = 0;
      for (const geo of geometries) {
        let skip: boolean = false;
        for (const attrName in attributes) {
          if (geo[attrName] && geo[attrName] !== attributes[attrName]) {
            skip = true;
            break;
          }
        }

        if (skip) {
          index += 1;
          continue;
        }

        for (const attrName in attributes) {
          if (!geo[attrName]) {
            geo[attrName] = attributes[attrName];
          }
        }

        prim.geometry = index;
        index += 1;
        break;
      }

      if (prim.geometries === undefined) {
        const geo: any = {};
        for (const attrName in attributes) {
          geo[attrName] = attributes[attrName];
        }
        geometries.push(geo);
        prim.geometry = geometries.length - 1;
      }
    });
  });

  gltf.meshes.forEach(mesh => {
    processMesh(mesh, gltf.accessors, gltf.materials, bufferViews, geometries);
  });

  const geoBuffers: Buffer[] = geometries.map((geo, index) => {
    let len: number = 0;
    for (const attrKey in geo) {
      const attr = geo[attrKey];
      const accessor = gltf.accessors[attr];
      accessor.geometryIndex = index;
      len += accessor.count * getComponentByteLenthAndClass(accessor.componentType)[0] * getTypeByteLenth(accessor.type);
    }

    return Buffer.alloc(len);
  });

  processBuffers(gltf.accessors, bufferViews, geoBuffers);
}

function processBuffers(accessors: any, bvs: any, geoBuffers: Buffer[]) {
  const geoBufferUsed = geoBuffers.map(() => false);

  accessors.forEach((accessor, index) => {

  });
}

function processMesh(
  mesh: any, accessors: any, materials: any,
  bvs: any, geometries: {[attrName: string]: number;}[]
) {
  mesh.primitives?.forEach(prim => {
    const {attributes, material} = prim;

    if (!attributes) {
      return;
    }

    const geometry = geometries[attributes.geometry];
    if (materials[material]?.normalTexture) {
      if (!geometry.TEXCOORD_0) {
        showWarn('需要生成法线数据但缺失uv数据，忽略...');
      } else {
        if (!geometry.NORMAL) {
          generateNormal(geometry, bvs, accessors);
        }

        if (!geometry.TANGENT) {
          generateTangent(geometry, bvs, accessors);
        }
      }
    }

    prim.attributes = geometry;
  });
}

function generateNormal(geometry: {[aName: string]: number;}, bvs: any, accessors: any) {
  const positions = bvs[accessors[geometry.POSITION]];
}

function generateTangent(geometry: {[aName: string]: number;}, bvs: any, accessors: any) {

}

async function generateGLB(gltf: Object, dir: string) {
  const {glb} = await gltfPipe.gltfToGlb(gltf, {
    resourceDirectory: dir
  });

  return glb;
}

async function execOne(entity: IEntity, toGLB: boolean) {
  showInfo(`处理开始 ${path.join(entity.iDir, entity.file)}`);

  const {gltf, assets} = await processGlTF(entity);
  const gltfFiles: string[] = assets;
  console.log(gltfFiles);

  gltfFiles.push(await writeFile(path.resolve(entity.oDir, 'index.gltf'), JSON.stringify(gltf)));

  if (toGLB || entity.isGLB) {
    showInfo(`glb生成开始`);
    const glb = await generateGLB(gltf, entity.oDir);
    writeFile(path.resolve(entity.oDir, 'index.glb'), glb);
    showInfo(`glb生成结束`);

    showInfo(`移除临时文件...`);
    for (const fp of gltfFiles) {
      removeFile(fp);
    }

    showInfo(`处理完成 ${path.join(entity.iDir, entity.file)}`);
  }
}

export async function exec(argv: yargs.Arguments) {
  let {input, output, glb} = argv;

  if (!input || !output) {
    showError('必要参数`input`或`output`不存在！');
  }

  if (!fs.existsSync(input)) {
    showError(`路径不存在 ${input}!`);
  }

  if (!fs.existsSync(output)) {
    showError(`路径不存在 ${output}!`);
  }

  const entites: IEntity[] = [];
  if (fs.statSync(input).isDirectory()) {
    showInfo(`处理文件夹 ${input}...`);
    getChildrenFromFolder(input, fp => {
      return isGLTFFile(fp);
    }, 2).forEach(fp => {
      entites.push(getEntity(fp, output, glb));
    });
  } else if (!isGLTFFile(input)) {
    showWarn(`'${input}' 不是gltf文件，忽略...`);
  } else {
    entites.push(getEntity(input, output, glb));
  }

  if (!input.length) {
    showError('有效输入路径为0！');
  }

  for (let index = 0; index < entites.length; index += 1) {
    await execOne(entites[index], glb);
  }
}
