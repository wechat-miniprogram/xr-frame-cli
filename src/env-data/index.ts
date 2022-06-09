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

export async function exec(argv: yargs.Arguments) {
  // const root = await getRoot(argv);

  // const existedFiles = fs.readdirSync(root).filter(name => ['.git', '.DS_Store'].indexOf(name) < 0);
  // if (existedFiles.length > 0) {
  //   showError(`Current directory is not empty: ${existedFiles.toString()}`);
  // }

  // const template = await getTemplate(argv);
  // const engine = await getEngine(argv);

  // await create(root, template, engine);

  showInfo("新建完成，请自行执行`npm i`安装新依赖。");
  showInfo("可以使用`npm run dev`进行开发，默认Url是`localhost:8888`");
  showInfo("打包请使用`npm run build`。");
}
