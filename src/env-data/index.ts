/**
 * index.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:45:42
 */
import * as path from 'path';
import * as fs from 'fs';
import * as yargs from 'yargs';
import {
  showError,
  toSnakeCase,
  showInfo,
  isImageFile,
  showWarn,
  getChildrenFromFolder
} from '../utils';
import {decodeImage, encodeImage, IImage} from './image';
import renderer from './renderer';

function toPOT(size: number) {
  const log2 = Math.log2(size);
  const i = ~~log2;
  const d = log2 % 1;

  if (d === 0) {
    return size;
  }

  if (d < 0.3) {
    return Math.pow(2, i);
  }
  
  return Math.pow(2, i + 1);
}

function getSize(image: IImage, size: number): {width: number, height: number} {
  let {width, height} = image;

  if (!size || size > image.width) {
    size = image.width;
  }

  if (size !== image.width) {
    width = size;
    height = size / image.width * image.height; 
  }

  return {width: toPOT(width), height: toPOT(height)};
}

async function execOne(input: string, output: string, size?: number, bin?: boolean) {
  showInfo(`处理输入'${input}'`);

  if (!fs.existsSync(input)) {
    showError(`路径不存在 '${input}'`);
  }

  if (!output) {
    output = input.replace(path.extname(input), '');
    showInfo(`使用input同名目录'${output}'`);
  }

  let image: IImage;
  try {
    image = await decodeImage(input);
  } catch(error) {
    showError(`解码异常 ${error}`);
  }
  const {hdr, rgb} = image;
  const {width, height} = getSize(image, size);

  if (width / height !== 2) {
    showError(`输入图片宽高比必须接近2:1 现在为${image.width}:${image.height}`)
  }

  if (!fs.existsSync(output)) {
    fs.mkdirSync(output);
  }
  
  let {specular, skybox, diffuse} = renderer.process(image, width, height);
  const skyboxImg = await encodeImage(skybox, width, height, !rgb);
  const specularImg = await encodeImage(specular, width, width, hdr, true);

  const json = {
    skybox: {type: '2D', half: false, map: undefined},
    specular: {type: '2D', rgbd: hdr, mipmaps: true, mipmapCount: 5, map: undefined},
    diffuse: {coefficients: diffuse}
  };

  if (!bin) {
    const skyboxPath = json.skybox.map = `skybox.${!rgb ? 'png' : 'jpg'}`;
    const specularPath = json.specular.map = `specular.${hdr ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.resolve(output, specularPath), specularImg);
    fs.writeFileSync(path.resolve(output, skyboxPath), skyboxImg);
    fs.writeFileSync(path.resolve(output, 'data.json'), JSON.stringify(json, null, 2), {encoding: 'utf-8'});
  } else {
    const prefix = Buffer.from('wxxr-env', 'utf-8');
    const skyboxImgFill = align4(skyboxImg);
    json.skybox.map = {
      offset: 0, length: skyboxImg.byteLength,
      type: rgb ? 'image/jpg' : 'image/png'
    };
    const specularImgFill = align4(specularImg);
    json.specular.map = {
      offset: skyboxImg.byteLength + skyboxImgFill.byteLength, length: specularImg.byteLength,
      type: !hdr ? 'image/jpg' : 'image/png'
    };
    const content = Buffer.from(JSON.stringify(json), 'utf-8');
    const jsonLen = new Uint32Array([content.byteLength]);
    const binFill = align4(content);
    const binStart = new Uint32Array([content.byteLength + binFill.byteLength]);
    const finalData = Buffer.concat([
      prefix, new Uint8Array(jsonLen.buffer), new Uint8Array(binStart.buffer),
      content, binFill,
      new Uint8Array(skyboxImg), skyboxImgFill,
      new Uint8Array(specularImg), specularImgFill
    ]);
    fs.writeFileSync(path.resolve(output, 'data.bin'), finalData);
  }

  showInfo(`输出完成 '${input}' to '${output}/data.${bin ? 'bin' : 'json'}'`);
}

function align4(buffer: Buffer | ArrayBuffer) {
  const det = buffer.byteLength % 4;
  return Buffer.alloc(4 - det);
}

function getOutput(isFolder: boolean, i: string, o?: string): string {
  if (o && !fs.existsSync(o)) {
    try {
      fs.mkdirSync(o);
    } catch (error) {
      showError(`指定的输出路径不存在且创建失败 ${o}, ${error}`);
    }
  }

  if (!isFolder) {
    return o || i.replace(path.extname(i), '');
  }

  return path.resolve(o || path.dirname(i), path.basename(i).replace(path.extname(i), ''));
}

export async function exec(argv: yargs.Arguments) {
  let {input, output, size, bin} = argv;

  if (!input) {
    showError('必要参数`input`不存在！');
  }

  if (!fs.existsSync(input)) {
    showError(`路径不存在 ${input}!`);
  }

  const inputs: string[] = [];
  const outputs: string[] = [];
  if (fs.statSync(input).isDirectory()) {
    showInfo(`处理文件夹 ${input}...`);
    getChildrenFromFolder(input, fp => {
      const res = isImageFile(fp);
      !res && showWarn(`'${fp}' 不是图片文件，忽略...`);
      return res;
    }).forEach(fp => {
      inputs.push(fp);
      outputs.push(getOutput(true, fp, output));
    });
  } else if (!isImageFile(input)) {
    showWarn(`'${input}' 不是图片文件，忽略...`);
  } else {
    inputs.push(input);
    outputs.push(getOutput(false, input, output));
  }

  if (!input.length) {
    showError('有效输入路径为0！');
  }

  for (let index = 0; index < inputs.length; index += 1) {
    await execOne(inputs[index], outputs[index], size, bin); 
  }
}
