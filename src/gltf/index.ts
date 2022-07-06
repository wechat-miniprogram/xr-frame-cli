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

function getTypeLenth(type: string) {
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

function getEntity(fp: string, o: string): IEntity {
  const iDir = path.dirname(fp);
  const file = path.basename(fp);
  const isGLB = path.extname(fp) === '.glb';
  const oDir = path.resolve(o, isGLB ? file.replace('.glb', '') : path.dirname(fp).split('/').pop());

  return {iDir, file, isGLB, oDir};
}

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
    const res = await gltfPipe.glbToGltf(buffer, {separate: true, resourceDirectory: entity.iDir});
    gltf = res.gltf;
    separateResources = res.separateResources;
  } else {
    const json = await readFileJson(path.resolve(entity.iDir, entity.file));
    const res = await gltfPipe.processGltf(json, {separate: true, resourceDirectory: entity.iDir});
    gltf = res.gltf;
    separateResources = res.separateResources;
  }

  for (const relativePath in separateResources) {
    const op = path.resolve(entity.oDir, relativePath);
    if (!/.bin$/.test(op)) {
      assets.push(await writeFile(op, separateResources[relativePath]));
    } else {
      buffers[relativePath] = separateResources[relativePath];
    }
  }

  const buffer = await processMeshes(gltf, buffers);
  assets.push(await writeFile(path.resolve(entity.oDir, 'buffer.bin'), buffer));
  gltf.buffers = [{uri: 'buffer.bin', byteLength: buffer.byteLength}];

  gltf.extensionsUsed = gltf.extensionsUsed || [];
  gltf.extensionsUsed.push('WX_prcessed_model');

  return {gltf, assets};
}

async function processMeshes(gltf: any, buffers: {[path: string]: Buffer;}) {
  if (!gltf.meshes) {
    return;
  }

  gltf.bufferViews.forEach(bv => {
    bv.byteOffset = bv.byteOffset || 0;
    bv.buffer = buffers[gltf.buffers[bv.buffer].uri].buffer.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
    delete bv.byteOffset;
    delete bv.byteLength;
  });

  const geometries: {[attr: string]: number;}[] = [];
  gltf.meshes.forEach(mesh => {
    const {primitives, mode} = mesh;

    if (mode && mode !== 4) {
      showWarn('图元类型不为4(三角形)，忽略...');
      return;
    }

    if (!primitives) {
      return;
    }

    primitives.forEach(prim => {
      const {attributes} = prim;

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
    processMesh(mesh, gltf.accessors, gltf.materials, gltf.bufferViews, geometries);
  });

  const geoBuffers = geometries.map((geo, index) => {
    return processGeometry(index, geo, gltf.accessors, gltf.bufferViews);
  });

  return processBuffers(gltf.accessors, gltf.bufferViews, geoBuffers);
}

function processGeometry(index: number, geo: any, accessors: any, bvs: any) {
  let maxCount: number = 0;
  let stride: number = 0;
  for (const attrKey in geo) {
    const attr = geo[attrKey];
    const accessor = accessors[attr];
    const s = getComponentByteLenthAndClass(accessor.componentType)[0] * getTypeLenth(accessor.type);
    stride += s % 4 === 0 ? s : Math.floor(s / 4) + 4;
    maxCount = Math.max(accessor.count, maxCount);
  }

  const buffer = Buffer.alloc(maxCount * stride).buffer;

  let offset: number = 0;
  for (const attrKey in geo) {
    const attr = geo[attrKey];
    const accessor = accessors[attr];
    const bv = bvs[accessor.bufferView];
    const [_l, clz] = getComponentByteLenthAndClass(accessor.componentType);
    const count = getTypeLenth(accessor.type);
    const origPerLen = (bv.stride || (_l * count)) / _l;
    const perLen = stride / _l;

    const origView = new clz(bv.buffer, accessor.byteOffset || 0) as Float32Array;
    const view = new clz(buffer, offset) as Float32Array;
    const max = new Array(count).fill(-Infinity);
    const min = new Array(count).fill(Infinity);

    let j: number = 0;
    for (let i = 0; i < origView.length; i += origPerLen) {
      for (let k = 0; k < count; k += 1) {
        const v = view[j + k] = origView[i + k];
        max[k] = Math.max(v, max[k]);
        min[k] = Math.min(v, min[k]);
      }
      j += perLen;
    }

    accessor.geometryIndex = index;
    accessor.count = maxCount;
    accessor.max = max;
    accessor.min = min;
    accessor.byteOffset = offset;
    const s = _l * count;
    offset += s % 4 === 0 ? s : Math.floor(s / 4) + 4;
  }

  return {buffer, stride};
}

function processBuffers(
  accessors: any, bvs: any,
  geoBuffers: {buffer: ArrayBuffer, stride: number}[]
) {
  let totalLen: number = 0;
  const bvCache = new Set<string | number>();
  accessors.forEach((accessor) => {
    if (accessor.geometryIndex !== undefined && !bvCache.has(`g-${accessor.geometryIndex}`)) {
      totalLen += geoBuffers[accessor.geometryIndex].buffer.byteLength;
      bvCache.add(`g-${accessor.geometryIndex}`);
    } else if (!bvCache.has(accessor.bufferView)) {
      totalLen += bvs[accessor.bufferView].buffer.byteLength;
      bvCache.add(accessor.bufferView);
    }
  });

  const buffer = Buffer.alloc(totalLen);
  const geoBvCache: {[key: string]: any} = {};
  bvCache.clear();

  let offset: number = 0;
  accessors.forEach((accessor) => {
    let b: ArrayBuffer;
    let bv: any;
    if (accessor.geometryIndex === undefined && !bvCache.has(accessor.bufferView)) {
      bv = bvs[accessor.bufferView];
      b = bv.buffer;
      bvCache.add(accessor.bufferView);
    } else if (accessor.geometryIndex !== undefined) {
      const cKey = `g-${accessor.geometryIndex}`;
      if (geoBvCache[cKey]) {
        bvs[accessor.bufferView] = geoBvCache[cKey];
        delete accessor.geometryIndex;
        return;
      }
      const {buffer: b1, stride} = geoBuffers[accessor.geometryIndex];
      delete accessor.geometryIndex;
      bv = geoBvCache[cKey] = bvs[accessor.bufferView] = {
        target: 34962,
        byteStride: stride
      };
      b = b1;
    } else {
      return;
    }

    buffer.set(Buffer.from(b), offset);
    bv.byteOffset = offset;
    bv.buffer = 0;
    bv.byteLength = b.byteLength;
    offset += b.byteLength;
  });

  return buffer;
}

function processMesh(
  mesh: any, accessors: any, materials: any,
  bvs: any, geometries: {[attrName: string]: number}[]
) {
  mesh.primitives?.forEach(prim => {
    const {attributes, material, indices} = prim;

    if (!attributes) {
      return;
    }

    const geometry = geometries[attributes.geometry];
    delete prim.geometry;

    if (!geometry) {
      return;
    }

    if (materials[material]?.normalTexture && !(geometry.NORMAL !== undefined && geometry.TANGENT !== undefined)) {
      if (!geometry.TEXCOORD_0) {
        showWarn('需要生成法线数据但缺失uv数据，忽略...');
      } else if (indices === undefined) {
        showWarn('需要生成法线数据但缺失索引，忽略...');
      } else {
        const iaccessor = accessors[indices];
        const indexBuffer = new (getComponentByteLenthAndClass(iaccessor.componentType)[1])(
          bvs[iaccessor.bufferView].buffer
        );

        if (!geometry.NORMAL) {
          generateNormal(geometry, indexBuffer, bvs, accessors);
        }

        if (!geometry.TANGENT) {
          generateTangent(geometry, indexBuffer, bvs, accessors);
        }
      }
    }

    prim.attributes = geometry;
  });
}

function generateNormal(geometry: {[aName: string]: number}, indexBuffer: ArrayBufferView, bvs: any, accessors: any) {
  const {buffer: positons, per: pPer} = getAttr(geometry.POSITION, bvs, accessors);
  const {buffer: uvs, per: uvPer} = getAttr(geometry.TEXCOORD_0, bvs, accessors);
}

function generateTangent(geometry: {[aName: string]: number}, indexBuffer: ArrayBufferView, bvs: any, accessors: any) {
  const {buffer: positons, per: pPer} = getAttr(geometry.POSITION, bvs, accessors);
  const {buffer: uvs, per: uvPer} = getAttr(geometry.TEXCOORD_0, bvs, accessors);
  const {buffer: normals, per: normalPer} = getAttr(geometry.NORMAL, bvs, accessors);
}

function getAttr(index: number, bvs: any, accessors: any) {
  let {byteOffset, bufferView, componentType} = accessors[index];
  let {buffer, byteStride} = bvs[bufferView];

  byteStride = byteStride || getComponentByteLenthAndClass(componentType)[0];
  return {
    buffer: new Float32Array(buffer.buffer, byteOffset),
    per: byteStride / 4
  };
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

  gltfFiles.push(await writeFile(path.resolve(entity.oDir, 'index.gltf'), JSON.stringify(gltf, undefined, 2)));

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
      entites.push(getEntity(fp, output));
    });
  } else if (!isGLTFFile(input)) {
    showWarn(`'${input}' 不是gltf文件，忽略...`);
  } else {
    entites.push(getEntity(input, output));
  }

  if (!input.length) {
    showError('有效输入路径为0！');
  }

  for (let index = 0; index < entites.length; index += 1) {
    await execOne(entites[index], glb);
  }
}
