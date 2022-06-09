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

const {argv} = Yargs
  .command('$0', 'xr-frame相关脚手架，使用 `xr-frame -h` 查看所有有效指令。')
  .usage('Usage: $0 <command> [options]')
  .command(
    'env-data',
    '处理EnvData，通过全景图预计算环境光的高光贴图和漫反射球谐系数，生成符合xr-frame标准的数据',
    yargs => yargs
      .example('$0 env-data -i room.png', '通过room.png生成，输出到当前目录下同名文件夹。')
      .example('$0 env-data -i room.png -o room1', '输出到room1文件夹。')
      .alias('i', 'input')
      .describe('i', `指定输入全景图。`)
      .alias('o', 'output')
      .describe('o', '指定输出数据文件夹，不指定则输出到同名文件夹。')
  )
  .command(
    'gltf',
    '（预留）预处理gltf资源',
    yargs => yargs
      .example('$0 env-data -i room.png', '通过room.png生成，输出到当前目录下同名文件夹。')
      .example('$0 env-data -i room.png -o room1', '输出到room1文件夹。')
      .alias('i', 'input')
      .describe('i', `指定输入gltf文件或目录，不指定则处理当前目录下所有gltf。`)
      .alias('o', 'output')
      .describe('r', '指定输出数据目录，不指定则输出到同名文件夹，原始文件会保存在bak文件夹下。')
  )
  .help('h')
  .alias('h', 'help');

if (['env-data', 'gltf'].indexOf(argv._[0]) < 0) {
  showError('无此指令, 使用 `xr-frame -h` 查看所有有效指令。');
}

if (argv._[0] === 'env-data') {
  cmdEnvData.exec(argv);
}

if (argv._[0] === 'gltf') {
  // cmdMerge.exec(argv);
}
