/**
 * index.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:45:38
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
  getChildrenFromFolder,
  isGLTFFile
} from '../utils';

interface IEntity {
  iDir: string;
  file: string;
  isGLB: boolean;
  oDir: string;  
}

function getEntity(fp: string, o: string): IEntity {
  const iDir = path.dirname(fp);
  const file = path.basename(fp);
  const isGLB = path.extname(fp) === '.glb';
  const oDir = path.resolve(o, path.dirname(fp).split('/').pop());

  return {iDir, file, isGLB, oDir};
}

export async function exec(argv: yargs.Arguments) {
  let {input, output, size} = argv;

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

  // for (let index = 0; index < inputs.length; index += 1) {
  //   await execOne(inputs[index], outputs[index], size); 
  // }
}
