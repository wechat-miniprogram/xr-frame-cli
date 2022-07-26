#!/usr/bin/env node
/**
 * index.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:49:54
 */
import * as Yargs from 'yargs';

import {showError} from './utils';
import * as cmdEnvData from './env-data';
import * as cmdGltf from './gltf';
import * as fs from 'fs';
import * as path from 'path';

const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), {encoding: 'utf8'}));

const {argv} = Yargs
  .command('$0', 'xr-frame相关脚手架，使用 `xr-frame -h` 查看所有有效指令。')
  .usage('Usage: $0 <command> [options]')
  .command(
    'env-data',
    '处理EnvData，通过全景图预计算环境光的高光贴图和漫反射球谐系数，生成符合xr-frame标准的数据。',
    yargs => yargs
      .example('$0 env-data -i room.png', '通过room.png生成，输出到当前目录下同名文件夹。')
      .example('$0 env-data -i room.png -o room1', '输出到room1文件夹。')
      .example('$0 env-data -i src -o dst', '将src文件夹的所有图片，生成到dst文件夹中，不指定输出则生成到目录下。')
      .example('$0 env-data -i src -s 2048,1024', '指定输出的纹理尺寸，天空盒为2048，高光为1024，第二个不指定默认1024。')
      .example('$0 gltf -i src -b', '最终输出为单个bin文件。')
      .alias('i', 'input')
      .describe('i', `指定输入全景图或者文件夹。`)
      .alias('o', 'output')
      .describe('o', '指定输出数据文件夹，不指定则输出到同名文件夹。')
      .alias('s', 'size')
      .describe('s', '指定输出纹理的尺寸，`skybox,specular`形式，不指定第二个默认1024。')
      .alias('b', 'bin')
      .describe('b', '指定打包输出为单个二进制文件，优化加载性能。')
  )
  .command(
    'gltf',
    '预处理gltf资源，合并相似图元，强制交错格式，根据需要自动生成法线切线。',
    yargs => yargs
      .example('$0 gltf -i test.gltf -o test1', '处理test.gltf文件，输出到test1文件夹。')
      .example('$0 gltf -i src -o dst', '将src文件夹的所有gltf资源（支持到二级目录），生成到dst文件夹中。')
      .example('$0 gltf -i src -o dst -b', '最终输出为glb。')
      .alias('i', 'input')
      .describe('i', `指定输入gltf文件或目录。`)
      .alias('o', 'output')
      .describe('o', '指定输出数据目录。')
      .alias('b', 'glb')
      .describe('b', '是否转换为glb。')
  )
  .help('h')
  .alias('h', 'help')
  .version(json.version)
  .alias('v', 'version');

if (['env-data', 'gltf'].indexOf(argv._[0]) < 0) {
  showError('无此指令, 使用 `xr-frame -h` 查看所有有效指令。');
}

if (argv._[0] === 'env-data') {
  cmdEnvData.exec(argv);
}

if (argv._[0] === 'gltf') {
  cmdGltf.exec(argv);
}
