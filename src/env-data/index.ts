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
  showInfo
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

  if (!size) {
    size = image.width;
  }

  if (size !== image.width) {
    width = size;
    height = size / image.width * image.height; 
  }

  return {width: toPOT(width), height: toPOT(height)};
}

export async function exec(argv: yargs.Arguments) {
  let {input, output, size} = argv;

  if (!input) {
    showError('必要参数input不存在！');
  }

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
  
  let {specular, diffuse} = renderer.process(image, width, height);
  const specularImg = await encodeImage(specular, width, width, 4, hdr);
  const skyboxImg = await encodeImage(image.buffer, image.width, image.height, rgb ? 3 : 4, !rgb);

  if (!fs.existsSync(output)) {
    fs.mkdirSync(output);
  }

  const specularPath = `specular.${hdr ? 'png' : 'jpg'}`;
  const skyboxPath = `skybox.${!rgb ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.resolve(output, specularPath), specularImg);
  fs.writeFileSync(path.resolve(output, skyboxPath), skyboxImg);
  fs.writeFileSync(path.resolve(output, 'data.json'), JSON.stringify({
    skybox: {type: '2D', half: false, map: skyboxPath},
    specular: {type: '2D', rgbd: hdr, mipmaps: true, map: specularPath},
    diffuse: {coefficients: diffuse}
  }), {encoding: 'utf-8'});

  showInfo(`输出完成 '${input}'`);
}
