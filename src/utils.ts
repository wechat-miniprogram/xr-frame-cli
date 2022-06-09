/**
 * utils.ts
 * 
 * @Author  : dtysky(dtysky@outlook.com)
 * @Date    : 2022/6/9 18:59:41
 */
export function showError(msg: string) {
  console.error('\x1b[31m%s', `Error: ${msg}`);
  process.exit(0);
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
