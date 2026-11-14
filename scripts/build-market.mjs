#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarket } from './lib/market.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `用法：node scripts/build-market.mjs [选项]

从已验签的历史 dist 合并插件源，生成确定性的 v1 产物与静态站点。
本命令不签名，也不读取任何私钥。

选项：
  --sources <dir>      插件源目录（默认 plugins）
  --history <dir>      历史 dist 根目录（默认 .dist-history；不存在视为首次发布）
  --out <dir>          输出目录（默认 build）
  --web <dir>          静态站点源目录（默认 web）
  --now <iso>          generatedAt（默认当前时间）
  --public-key <pem>   历史验签公钥（默认 market-public-key.pem）
  --allow-test-key     允许非生产公钥（仅本地测试）
  --no-web             不复制静态站点（测试用）
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const options = {
    sources: join(repoRoot, 'plugins'),
    history: join(repoRoot, '.dist-history'),
    out: join(repoRoot, 'build'),
    web: join(repoRoot, 'web'),
    now: new Date().toISOString(),
    publicKey: join(repoRoot, 'market-public-key.pem'),
    allowTestKey: false,
    includeWeb: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} 缺少参数值`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--sources') options.sources = resolve(next());
    else if (arg === '--history') options.history = resolve(next());
    else if (arg === '--out') options.out = resolve(next());
    else if (arg === '--web') options.web = resolve(next());
    else if (arg === '--now') options.now = next();
    else if (arg === '--public-key') options.publicKey = resolve(next());
    else if (arg === '--allow-test-key') options.allowTestKey = true;
    else if (arg === '--no-web') options.includeWeb = false;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }
  const publicKeyPem = readFileSync(options.publicKey, 'utf8');
  const result = buildMarket({
    sourcesDir: options.sources,
    historyDir: options.history,
    outDir: options.out,
    webDir: options.web,
    now: options.now,
    publicKeyPem,
    allowTestKey: options.allowTestKey,
    includeWeb: options.includeWeb,
  });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  const versions = result.index.plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0);
  console.log(
    `已生成未签名索引 sequence=${result.index.sequence}，插件 ${result.index.plugins.length} 个，版本 ${versions} 个`
  );
  console.log(`输出：${result.output}`);
  console.log('下一步必须由受保护的 sign 步骤签名后才能发布。');
} catch (error) {
  console.error(`build 失败：${error.message}`);
  process.exit(1);
}
