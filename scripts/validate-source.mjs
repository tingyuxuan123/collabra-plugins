#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSourcePlugins } from './lib/source.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `用法：node scripts/validate-source.mjs [选项]

只读校验插件源：清单、版本、兼容性、路径安全、包边界与确定性 ZIP。
不执行插件代码或 npm 脚本，不访问网络。

选项：
  --sources <dir>      插件源目录（默认 plugins）
  -h, --help           显示帮助`;

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  let sources = join(repoRoot, 'plugins');
  const index = args.indexOf('--sources');
  if (index >= 0) {
    if (!args[index + 1]) throw new Error('--sources 缺少参数值');
    sources = resolve(args[index + 1]);
  }
  const { plugins, warnings } = loadSourcePlugins(sources);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const plugin of plugins) {
    if (plugin.delisted) {
      console.log(`${plugin.id}: delisted（历史产物保留，不再出现在索引）`);
      continue;
    }
    console.log(
      `${plugin.id}: ${plugin.versions
        .map((version) => `${version.version} (${version.size} bytes)`)
        .join(', ')}`
    );
  }
  console.log('插件源校验通过。');
} catch (error) {
  console.error(`validate 失败：${error.message}`);
  process.exit(1);
}
