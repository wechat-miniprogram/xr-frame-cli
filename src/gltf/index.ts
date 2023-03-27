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
import * as mime from 'mime';
import * as sharp from 'sharp';
import {vec2, vec3, vec4} from 'gl-matrix';
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

async function processGlTF(entity: IEntity): Promise<{
  gltf: Object, buffer: Buffer, assets: {[key: string]: Buffer}, skip?: boolean
}> {
  let gltf: any;
  let separateResources: {[key: string]: Buffer;};
  const assets: string[] = [];
  const buffers: {[path: string]: Buffer;} = {};

  if (!fs.existsSync(entity.oDir)) {
    fs.mkdirSync(entity.oDir, {recursive: true});
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
    if (/.bin$/.test(op)) {
      buffers[relativePath] = separateResources[relativePath];
    }
  }

  for (const relativePath in buffers) {
    delete separateResources[relativePath];
  }

  if (gltf.extensionsUsed?.indexOf('WX_processed_model') >= 0) {
    showInfo('被CLI处理过的模型，跳过处理...');
    return {gltf, buffer: Object.values(buffers)[0], assets: separateResources, skip: true};  
  }

  showInfo('输入模型解析结束，开始处理Mesh数据...');

  const buffer = await processMeshes(gltf, buffers);
  gltf.buffers = [{uri: 'buffer.bin', byteLength: buffer.byteLength}];

  gltf.extensionsUsed = gltf.extensionsUsed || [];
  gltf.extensionsUsed.push('WX_processed_model');
  gltf.extensions = gltf.extensions || {};
  gltf.extensions.WX_processed_model = {
    trustMaxAndMin: true,
    simpleAttribNodeDontCheckTangent: true
  };

  return {gltf, buffer, assets: separateResources};
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
      const {attributes, targets} = prim;

      let index: number = 0;
      for (const geo of geometries) {
        let skip: boolean = false;
        if (geo.targets && geo.targets !== targets) {
          skip = true;
          break;
        }

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

        if (!geo.targets) {
          geo.targets = targets;
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
        if (targets) {
          geo.targets = targets;
        }
        geometries.push(geo);
        prim.geometry = geometries.length - 1;
      }
    });
  });

  gltf.meshes.forEach(mesh => {
    processMesh(mesh, gltf.accessors, gltf.materials, gltf.bufferViews, geometries);
  });

  showInfo('法线切线补充完成，开始处理几何数据...');
  const geoBuffers: {buffer: ArrayBuffer, stride: number}[] = [];
  let index: number = 0;
  geometries.forEach((geo) => {
    geoBuffers.push(...processGeometry(index, geo, gltf.accessors, gltf.bufferViews));
    index = geoBuffers.length;
  });

  showInfo('交错几何数据组装完成，进行最后拼装...');
  return processBuffers(gltf.accessors, gltf.bufferViews, geoBuffers);
}

function processGeometry(index: number, geo: any, accessors: any, bvs: any) {
  let maxCount: number = 0;
  let stride: number = 0;
  const bytesAttrMap: {attrIdx: number, stride: number}[] = [];

  function calcAttr(attrIdx: number) {
    const accessor = accessors[attrIdx];
    let s = getComponentByteLenthAndClass(accessor.componentType)[0] * getTypeLenth(accessor.type);
    s = s % 4 === 0 ? s : (Math.floor(s / 4) + 1) * 4;
    bytesAttrMap.push({attrIdx, stride: s});
    stride += s;
    maxCount = Math.max(accessor.count, maxCount);
  }

  // 过程中统计，左右byteStride相同的需要对称，记录accId和byteStride
  Object.keys(geo).forEach(attrKey => {
    if (attrKey === 'targets') {
      geo[attrKey].forEach(target => {
        Object.keys(target).forEach(key => {
          calcAttr(target[key]);
        });
      });
    } else {
      calcAttr(geo[attrKey]);
    }
  });

  if (stride > 252 * 2) {
    showError(`这是啥模型啊这么多attributes，byteStride都超过webgl限制(252)两倍了，我处理不了，另请高明吧！`);
  }

  let subStride: number;
  let subMaps: {attrIdx: number, stride: number}[][];
  function processAttr(attrIdx: number, subIndex: number, buffer: ArrayBuffer, offset: number) {
    const accessor = accessors[attrIdx];
    const [_l, clz] = getComponentByteLenthAndClass(accessor.componentType);
    const count = getTypeLenth(accessor.type);
    const perLen = subStride / _l;
    const view = new clz(buffer, offset) as Float32Array;
    const bv = bvs[accessor.bufferView];
    const origPerLen = bv ? (bv.stride || (_l * count)) / _l : count;
    const origView = (bv ? new clz(bv.buffer, accessor.byteOffset || 0) : new clz(accessor.count * count)) as Float32Array;
    const max = new Array(count).fill(-Infinity);
    const min = new Array(count).fill(Infinity);

    let j: number = 0;
    for (let i = 0; i < accessor.count; i += 1) {
      for (let k = 0; k < count; k += 1) {
        const v = view[j + k] = origView[i * origPerLen + k];
        max[k] = Math.max(v, max[k]);
        min[k] = Math.min(v, min[k]);
      }
      j += perLen;
    }

    accessor.geometryIndex = index + subIndex;
    accessor.count = maxCount;
    accessor.max = max;
    accessor.min = min;
    accessor.byteOffset = offset;
    const s = _l * count;
    offset += s % 4 === 0 ? s : (Math.floor(s / 4) + 1) * 4;

    return offset;
  }

  if (stride <= 252) {
    subStride = stride;
    subMaps = [bytesAttrMap];
  } else {
    bytesAttrMap.sort((a, b) => a.stride - b.stride).reverse();
    subMaps = [[], []];
    const sums = [0, 0];
    bytesAttrMap.forEach(v => {
      const i = sums[0] <= sums[1] ? 0 : 1;
      subMaps[i].push(v);
      sums[i] += v.stride;
    });
    
    subStride = Math.max(sums[0], sums[1]);
    const diff = sums[0] - sums[1];

    if (subStride > 252 || diff % 4 !== 0 || diff > 4 * 4) {
      showError(`这是啥模型啊尝试分割超长图元失败(stride: ${subStride}, diff: ${diff})，我处理不了，另请高明吧！`);
    }

    if (diff !== 0) {
      const subIdx = diff > 0 ? 0 : 1;
      accessors.push({
        componentType: 5126,
        count: maxCount,
        type: diff === 4 ? 'SCALAR' : diff === 8 ? "VEC2" : diff === 12 ? "VEC3" : "VEC4",
        geometryIndex: index + subIdx
      });
      subMaps[subIdx].push({attrIdx: accessors.length - 1, stride: diff});
    }
  }

  const res: {buffer: ArrayBuffer, stride: number}[] = subMaps.map(_ => {
    return {stride: subStride, buffer: Buffer.alloc(maxCount * subStride).buffer};
  });

  subMaps.forEach((map, subIdx) => {
    let offset: number = 0;
    const buffer = res[subIdx].buffer;
    
    map.forEach(({attrIdx}) => {
      offset = processAttr(attrIdx, subIdx, buffer, offset);
    });
  });

  return res;
}

function processBuffers(
  accessors: any, bvs: any,
  geoBuffers: {buffer: ArrayBuffer, stride: number}[]
) {
  let totalLen: number = 0;
  const geoBVs = new Set<number>();
  const bvCache = new Set<string | number>();
  accessors.forEach((accessor) => {
    if (accessor.geometryIndex !== undefined) {
      accessor.bufferView !== undefined && geoBVs.add(accessor.bufferView);
      if (!bvCache.has(`g-${accessor.geometryIndex}`)) {
        totalLen += geoBuffers[accessor.geometryIndex].buffer.byteLength;
        bvCache.add(`g-${accessor.geometryIndex}`);
      }
    } else if (!bvCache.has(accessor.bufferView)) {
      totalLen += bvs[accessor.bufferView].buffer.byteLength;
      bvCache.add(accessor.bufferView);
    }
  });

  const buffer = Buffer.alloc(totalLen);
  const origBVs: Set<number> = new Set();
  const usableGeoBVs = Array.from(geoBVs);
  const geoBvCache: {[key: string]: number} = {};
  bvCache.clear();

  let offset: number = 0;
  accessors.forEach((accessor, i) => {
    let b: ArrayBuffer;
    let bv: any;
    origBVs.add(accessor.bufferView);
    if (accessor.geometryIndex === undefined && !bvCache.has(accessor.bufferView)) {
      bv = bvs[accessor.bufferView];
      b = bv.buffer;
      bvCache.add(accessor.bufferView);
    } else if (accessor.geometryIndex !== undefined) {
      const cKey = `g-${accessor.geometryIndex}`;
      if (geoBvCache[cKey] !== undefined) {
        accessor.bufferView = geoBvCache[cKey];
        delete accessor.geometryIndex;
        return;
      }
      const {buffer: b1, stride} = geoBuffers[accessor.geometryIndex];
      delete accessor.geometryIndex;
      bv = {
        target: 34962,
        byteStride: stride
      };
      b = b1;

      if (usableGeoBVs.length) {
        geoBvCache[cKey] = usableGeoBVs.shift();
      } else {
        bvs.push(null);
        geoBvCache[cKey] = bvs.length - 1;
      }

      accessor.bufferView = geoBvCache[cKey];
      bvs[accessor.bufferView] = bv;
    } else {
      return;
    }

    buffer.set(Buffer.from(b), offset);
    bv.byteOffset = offset;
    bv.buffer = 0;
    bv.byteLength = b.byteLength;
    offset += b.byteLength;
  });

  accessors.forEach((accessor, i) => {
    if (origBVs.has(accessor.bufferView)) {
      origBVs.delete(accessor.bufferView);
    }
  });

  origBVs.forEach(bvid => {
    delete bvs[bvid].byteStride;
    bvs[bvid].buffer = 0;
    bvs[bvid].byteOffset = 0;
    bvs[bvid].byteLength = 1;
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

    const geoIndex = prim.geometry;
    const geometry = geometries[geoIndex];
    delete prim.geometry;

    if (!geometry) {
      return;
    }

    if ((materials[material]?.normalTexture && geometry.TANGENT === undefined) || geometry.NORMAL === undefined) {
      if (!geometry.TEXCOORD_0) {
        showWarn('需要生成法线数据但缺失uv数据，忽略...');
      } else if (indices === undefined) {
        showWarn('需要生成法线数据但缺失索引，忽略...');
      } else {
        const iaccessor = accessors[indices];
        const indexBuffer = new (getComponentByteLenthAndClass(iaccessor.componentType)[1])(
          bvs[iaccessor.bufferView].buffer
        ) as Uint16Array;

        if (geometry.NORMAL === undefined) {
          showInfo('生成法线数据...')
          generateNormal(geometry, indexBuffer, bvs, accessors);
        }

        if (geometry.TANGENT === undefined && materials[material]?.normalTexture) {
          showInfo('生成切线数据...')
          generateTangent(geometry, indexBuffer, bvs, accessors);
        }
      }
    }

    const {targets, ...attrs} = geometry;
    prim.attributes = attrs;
    if (targets) {
      prim.targets = targets;
    }
  });
}

function generateNormal(geometry: {[aName: string]: number}, ibv: Uint16Array, bvs: any, accessors: any) {
  const {buffer: positons, per: pPer, count} = getAttr(geometry.POSITION, bvs, accessors);
  const normalsBuffer = Buffer.alloc(count * 3 * 4);
  const normals = new Float32Array(normalsBuffer.buffer);

  const vertexFaceNormals = new Array<vec3[]>(normals.length);
  for (let i = 0; i < ibv.length; i += 3) {
    const vis = [ibv[i], ibv[i + 1], ibv[i + 2]];
    const pos = vis.map(vi => new Float32Array(3).map((_, offset) => positons[vi * pPer + offset]));
    const edge0 = vec3.sub(vec3.create(), pos[0], pos[1]);
    const edge1 = vec3.sub(vec3.create(), pos[0], pos[2]);
    const normal = vec3.cross(vec3.create(), edge0, edge1);
    vis.forEach(vi => {
      vertexFaceNormals[vi] = vertexFaceNormals[vi] || [];
      vertexFaceNormals[vi].push(normal);
    });
  }

  vertexFaceNormals.forEach((faceNormals, index) => {
    const n = faceNormals.reduce((pre, current) => vec3.add(pre, pre, current), vec3.create());
    vec3.scale(n, n, 1 / n.length);
    vec3.normalize(n, n);
    normals.set(n, index * 3);
  });

  bvs.push({
    buffer: normalsBuffer.buffer,
    target: 34963,
    byteOffset: 0,
    byteLength: normalsBuffer.byteLength
  });

  accessors.push({
    bufferView: bvs.length - 1,
    componentType: 5126,
    count,
    type: 'VEC3'
  });

  geometry.NORMAL = accessors.length - 1;
}

function generateTangent(geometry: {[aName: string]: number}, ibv: Uint16Array, bvs: any, accessors: any) {
  const {buffer: positons, per: pPer, count} = getAttr(geometry.POSITION, bvs, accessors);
  const {buffer: uvs, per: uvPer} = getAttr(geometry.TEXCOORD_0, bvs, accessors);
  const {buffer: normals, per: normalPer} = getAttr(geometry.NORMAL, bvs, accessors);
  const tangentBuffer = Buffer.alloc(count * 4 * 4);
  const tangents = new Float32Array(tangentBuffer.buffer);

  const vertexFaceTangents = new Array<vec3[]>(tangents.length);
  for (let i = 0; i < ibv.length; i += 3) {
    const vis = [ibv[i], ibv[i + 1], ibv[i + 2]];
    const pos = vis.map(vi => new Float32Array(3).map((_, offset) => positons[vi * pPer + offset]));
    const uv = vis.map(vi => new Float32Array(3).map((_, offset) => uvs[vi * uvPer + offset]));
    const edge0 = vec3.sub(vec3.create(), pos[0], pos[1]);
    const edge1 = vec3.sub(vec3.create(), pos[0], pos[2]);
    const deltaUV0 = vec2.sub(vec2.create(), uv[0], uv[1]);
    const deltaUV1 = vec2.sub(vec2.create(), uv[0], uv[2]);
    const det = deltaUV0[0] * deltaUV1[1] - deltaUV0[1] * deltaUV1[0];
    let tangent = vec3.create();
    if (Math.abs(det) > 0) {
      const xAsixInUVSpace = [deltaUV1[1], -deltaUV0[1]];
      tangent = vec3.add(tangent, vec3.scale(edge0, edge0, xAsixInUVSpace[0]), vec3.scale(edge1, edge1, xAsixInUVSpace[1]))
    }
    vis.forEach(vi => {
      vertexFaceTangents[vi] = vertexFaceTangents[vi] || [];
      vertexFaceTangents[vi].push(tangent);
    });
  }

  vertexFaceTangents.forEach((faceTangents, index) => {
    const tangent = faceTangents.reduce((pre, current) => vec3.add(pre, pre, current), vec3.create());
    vec3.scale(tangent, tangent, 1 / tangent.length);
    const normal = new Float32Array(3).map((_, offset) => normals[index * normalPer + offset]);
    const t = vec3.cross(tangent, tangent, normal);
    vec3.normalize(t, t);
    tangents.set(t, index * 4);
    tangents[index * 4 + 3] = 1;
  });

  bvs.push({
    buffer: tangentBuffer.buffer,
    target: 34963,
    byteOffset: 0,
    byteLength: tangentBuffer.byteLength
  });

  accessors.push({
    bufferView: bvs.length - 1,
    componentType: 5126,
    count,
    type: 'VEC4'
  });

  geometry.TANGENT = accessors.length - 1;
}

function getAttr(index: number, bvs: any, accessors: any) {
  let {byteOffset, bufferView, componentType, type, count} = accessors[index];
  let {buffer, byteStride} = bvs[bufferView];

  byteStride = byteStride || (getComponentByteLenthAndClass(componentType)[0] * getTypeLenth(type));
  return {
    buffer: new Float32Array(buffer, byteOffset),
    per: byteStride / 4,
    count
  };
}

async function generateGLB(gltf: any, buffer: Buffer, assets: {[rp: string]: Buffer | string}) {
  const bvs = gltf.bufferViews;
  const bvsLenOrig = bvs.length;
  const bin2RPs = Object.keys(assets);
  const asset2BV: {[rp: string]: number} = {};
  let offset: number = buffer.byteLength;
  const bin2Buffers = bin2RPs.map(rp => {
    let b = assets[rp];
    if (typeof b === 'string') {
      b = Buffer.from(b);
    }
    const ab = align4(b);
    bvs.push({buffer: 0, byteOffset: offset, byteLength: b.byteLength + ab.byteLength});
    asset2BV[rp] = bvs.length - 1;
    offset += b.byteLength + ab.byteLength;
    return Buffer.concat([b, ab]);
  });

  gltf.images?.forEach(img => {
    if (asset2BV[img.uri] === undefined) {
      return;
    }

    img.bufferView = asset2BV[img.uri];
    img.mimeType = mime.getType(getImageExtension(bin2Buffers[img.bufferView - bvsLenOrig]));
    delete img.uri;
  });

  gltf.shaders?.forEach(shader => {
    if (asset2BV[shader.uri] === undefined) {
      return;
    }

    shader.bufferView = asset2BV[shader.uri];
    delete shader.uri;
  });

  const bin2Buffer = Buffer.concat(bin2Buffers);
  const fBuffer = Buffer.concat([buffer, bin2Buffer]);
  const fBAlign = align4(fBuffer);
  gltf.buffers = [{byteLength: buffer.byteLength + bin2Buffer.byteLength}];
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonAlign = align4(json);

  const glb = Buffer.concat([
    new Uint8Array(new Uint32Array([
      0x46546C67,
      2,
      28 + json.byteLength + jsonAlign.byteLength + fBuffer.byteLength + fBAlign.byteLength,
      json.byteLength + jsonAlign.byteLength,
      0x4e4f534a
    ]).buffer),
    json,
    jsonAlign,
    new Uint8Array(new Uint32Array([
      fBuffer.byteLength + fBAlign.byteLength,
      0x004e4942
    ]).buffer),
    fBuffer,
    fBAlign
  ]);

  return glb;
}

function getImageExtension(data: Buffer) {
  const header = data.slice(0, 2);
  const webpHeaderRIFFChars = data.slice(0, 4);
  const webpHeaderWEBPChars = data.slice(8, 12);

  if (header.equals(Buffer.from([0x42, 0x4D]))) {
      return '.bmp';
  } else if (header.equals(Buffer.from([0x47, 0x49]))) {
      return '.gif';
  } else if (header.equals(Buffer.from([0xFF, 0xD8]))) {
      return '.jpg';
  } else if (header.equals(Buffer.from([0x89, 0x50]))) {
      return '.png';
  } else if (header.equals(Buffer.from([0xAB, 0x4B]))) {
      return '.ktx';
  } else if (header.equals(Buffer.from([0x48, 0x78]))) {
      return '.crn';
  } else if (webpHeaderRIFFChars.equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) && webpHeaderWEBPChars.equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) {
      // See https://developers.google.com/speed/webp/docs/riff_container#webp_file_header
      return '.webp';
  }

  throw new Error('Image data does not have valid header');
}


function align4(buffer: Buffer | ArrayBuffer) {
  const det = buffer.byteLength % 4;
  return det ? Buffer.alloc(4 - det).fill(0x20) : Buffer.alloc(0);
}

export async function processGLB(glb: Buffer): Promise<Buffer> {
  const buffers: {[path: string]: Buffer;} = {};

  const res = await gltfPipe.glbToGltf(glb, {separate: true});
  const gltf = res.gltf;
  const separateResources = res.separateResources;

  for (const relativePath in separateResources) {
    if (/.bin$/.test(relativePath)) {
      buffers[relativePath] = separateResources[relativePath];
    }
  }

  for (const relativePath in buffers) {
    delete separateResources[relativePath];
  }

  showInfo('输入模型解析结束，开始处理Mesh数据...');

  const buffer = await processMeshes(gltf, buffers);
  gltf.buffers = [{uri: 'buffer.bin', byteLength: buffer.byteLength}];
  gltf.extensionsUsed = gltf.extensionsUsed || [];
  gltf.extensionsUsed.push('WX_processed_model');

  return generateGLB(gltf, buffer, separateResources);
}

async function processTextures(gltf: any, assets: {[rp: string]: Buffer}) {
  for (const tex of gltf.textures) {
    let repeat: boolean = true;

    if (tex.sampler !== undefined) {
      let {wrapS, wrapT} = gltf.samplers[tex.sampler];
      wrapS = wrapS || 10497;
      wrapT = wrapT || 10497;
      repeat = wrapS === 10497 || wrapT === 10497;
    }

    if (repeat) {
      const rp = gltf.images[tex.source].uri;
      assets[rp] = await checkPOTandConvert(assets[rp], rp);
    }
  }
}

async function checkPOTandConvert(img: Buffer, rp: string): Promise<Buffer> {
  const instance = await sharp(img);
  const info = await instance.metadata();
  const width = getPOT(info.width);
  const height = getPOT(info.height);

  if (width === info.width && height === info.height) {
    return img;
  }

  showInfo(`处理repeat的非POT纹理 '${rp}'，[${info.width},${info.height}] -> [${width},${height}]`);

  return await instance.resize({width, height, fit: sharp.fit.fill}).toFormat(path.extname(rp).slice(1)).toBuffer();
}

function getPOT(s: number): number {
  const log = Math.log2(s);
  const int = ~~log;
  const det = log % 1;

  return Math.pow(2, det < 0.4 ? int : int + 1);
}

async function execOne(entity: IEntity, toGLB: boolean) {
  showInfo(`处理开始 ${path.join(entity.iDir, entity.file)}`);

  const {gltf, buffer, assets, skip} = await processGlTF(entity);
  // if (!skip) {
    await processTextures(gltf, assets);
  // }

  if (toGLB || entity.isGLB) {
    showInfo(`glb生成开始`);
    const glb = await generateGLB(gltf, buffer, assets);
    writeFile(path.resolve(entity.oDir, 'index.glb'), glb);
    showInfo(`glb生成结束`);
  } else {
    showInfo(`产物开始写入目标目录 ${entity.oDir}`);
    await writeFile(path.resolve(entity.oDir, 'index.gltf'), JSON.stringify(gltf, undefined, 2));
    await writeFile(path.resolve(entity.oDir, 'buffer.bin'), buffer);
    for (const relativePath in assets) {
      await writeFile(path.resolve(entity.oDir, relativePath), assets[relativePath]);
    }
    showInfo(`产物写入完成`);
  }

  showInfo(`处理完成 ${path.join(entity.iDir, entity.file)} to ${path.join(entity.oDir, 'index.' + (toGLB || entity.isGLB ? 'glb' : 'gltf'))}`);
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
