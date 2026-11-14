import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import {
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_DEPTH,
  MAX_PACKAGE_DIRECTORIES,
  MAX_PACKAGE_ENTRIES,
  MAX_PACKAGE_FILES,
} from './constants.mjs';
import { isSafeRelativePath } from './ids.mjs';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export const sha256File = (path) => sha256(readFileSync(path));

export function assertNoLinks(
  root,
  label = root,
  { maxDepth = 64, maxEntries = 20000 } = {}
) {
  if (!existsSync(root)) return;
  let entries = 0;
  const visit = (path, depth) => {
    if (depth > maxDepth) throw new Error(`${label} 目录深度超限`);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`${label} 含符号链接：${relative(root, path)}`);
    if (!info.isDirectory()) {
      if (!info.isFile()) throw new Error(`${label} 含特殊文件：${relative(root, path)}`);
      if (info.nlink > 1) throw new Error(`${label} 含硬链接：${relative(root, path)}`);
      return;
    }
    for (const entry of readdirSync(path)) {
      entries++;
      if (entries > maxEntries) throw new Error(`${label} 条目过多`);
      visit(join(path, entry), depth + 1);
    }
  };
  visit(root, 0);
}

/** Read a plugin directory into sorted ZIP entries without following links. */
export function collectPackageFiles(root) {
  if (!existsSync(root)) throw new Error(`包目录不存在：${root}`);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory()) throw new Error('包目录必须是普通目录');
  const files = [];
  let total = 0;
  let directories = 0;
  let entries = 0;
  const walk = (dir, depth) => {
    const names = readdirSync(dir).sort();
    if (names.length > MAX_PACKAGE_ENTRIES)
      throw new Error('包内目录条目数超过上限');
    for (const name of names) {
      const absolute = join(dir, name);
      const rel = relative(root, absolute).split(sep).join('/');
      entries++;
      if (entries > MAX_PACKAGE_ENTRIES) throw new Error('包内目录条目数超过上限');
      if (rel.split('/').length > MAX_PACKAGE_DEPTH) throw new Error('包内目录深度超限');
      if (!isSafeRelativePath(rel)) throw new Error(`包内路径不安全：${rel}`);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`包内禁止符号链接：${rel}`);
      if (info.isDirectory()) {
        directories++;
        if (directories > MAX_PACKAGE_DIRECTORIES)
          throw new Error('包内目录条目数超过上限');
        if (name.startsWith('.')) throw new Error(`包内禁止隐藏目录：${rel}`);
        if (name === 'node_modules') throw new Error(`包内禁止 node_modules：${rel}`);
        walk(absolute, depth + 1);
        continue;
      }
      if (!info.isFile()) throw new Error(`包内禁止特殊文件：${rel}`);
      if (info.nlink > 1) throw new Error(`包内禁止硬链接：${rel}`);
      if (name.endsWith('.node')) throw new Error(`包内禁止原生 .node 模块：${rel}`);
      if (name.startsWith('.') || name.endsWith('.zip') || name === 'Thumbs.db')
        throw new Error(`包内禁止的文件：${rel}`);
      total += info.size;
      if (total > MAX_PACKAGE_BYTES) throw new Error('包内容超过 200MB');
      files.push({ path: rel, data: readFileSync(absolute) });
      if (files.length > MAX_PACKAGE_FILES) throw new Error('包内文件超过 5000 个');
    }
  };
  walk(root, 0);
  if (files.length === 0) throw new Error('包目录为空');
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

export function copyTree(source, target, limits) {
  assertNoLinks(source, source, limits);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(target, name);
    const info = lstatSync(from);
    if (info.isDirectory()) copyTree(from, to, limits);
    else if (info.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    } else {
      throw new Error(`拒绝复制特殊文件：${from}`);
    }
  }
}

export function prepareOutputDir(outDir) {
  const resolved = resolve(outDir);
  const cwd = resolve(process.cwd());
  if (resolved === cwd) throw new Error('输出目录不能是仓库根目录');
  if (inside(resolved, cwd)) throw new Error('输出目录不能包含当前工作目录');
  if (resolved === resolve(homedir())) throw new Error('输出目录不能是用户主目录');
  if (resolved === resolve(tmpdir())) throw new Error('输出目录不能是系统临时目录本身');
  if (resolved === resolve('/') || resolved.length < 4)
    throw new Error('输出目录过浅');
  if (resolved.split(sep).filter(Boolean).length < 2)
    throw new Error('输出目录层级过浅');
  if (existsSync(join(resolved, '.git'))) throw new Error('输出目录看起来是 Git 仓库，拒绝清理');
  if (existsSync(join(resolved, 'package.json')) && existsSync(join(resolved, 'SPEC.md')))
    throw new Error('输出目录看起来是仓库根目录，拒绝清理');
  if (existsSync(resolved)) {
    const info = lstatSync(resolved);
    if (info.isSymbolicLink()) throw new Error('输出目录不能是符号链接');
    if (!info.isDirectory()) throw new Error('输出路径必须是目录');
    rmSync(resolved, { recursive: true, force: true });
  }
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

export function readJson(path, maxBytes) {
  const linkInfo = lstatSync(path);
  if (linkInfo.isSymbolicLink() || !linkInfo.isFile())
    throw new Error(`JSON 必须是普通文件：${basename(path)}`);
  if (linkInfo.nlink > 1) throw new Error(`JSON 禁止硬链接：${basename(path)}`);
  const info = statSync(path);
  if (info.size > maxBytes) throw new Error(`文件过大：${basename(path)}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`JSON 解析失败：${basename(path)}：${error.message}`);
  }
}

export function writeFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
