#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairFiles } from './lib/crypto.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `用法：node scripts/keygen.mjs [选项]

生成 Ed25519 密钥对。私钥权限固定为 0600，已存在时拒绝覆盖；
命令只输出公钥指纹和文件路径，绝不打印私钥内容。

选项：
  --dir <dir>          输出目录（默认 ./keys，必须不存在或为空目录）
  --private <path>     私钥路径（默认 <dir>/market-private-key.pem）
  --public <path>      公钥路径（默认 <dir>/market-public-key.pem）
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const options = {
    dir: join(repoRoot, 'keys'),
    privatePath: null,
    publicPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} 缺少参数值`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dir') options.dir = resolve(next());
    else if (arg === '--private') options.privatePath = resolve(next());
    else if (arg === '--public') options.publicPath = resolve(next());
    else throw new Error(`未知参数：${arg}`);
  }
  options.privatePath ??= join(options.dir, 'market-private-key.pem');
  options.publicPath ??= join(options.dir, 'market-public-key.pem');
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }
  if (existsSync(options.dir) && !statSync(options.dir).isDirectory())
    throw new Error('--dir 必须是目录');
  if (options.privatePath === options.publicPath)
    throw new Error('私钥与公钥路径不能相同');
  mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  chmodSync(options.dir, 0o700);
  mkdirSync(dirname(options.privatePath), { recursive: true });
  mkdirSync(dirname(options.publicPath), { recursive: true });
  const result = generateKeyPairFiles(options.privatePath, options.publicPath);
  console.log('已生成 Ed25519 密钥对（私钥不会显示）。');
  console.log(`私钥：${options.privatePath}`);
  console.log(`公钥：${options.publicPath}`);
  console.log(`公钥指纹：${result.fingerprint}`);
  console.log('请把私钥存入受保护的 GitHub Secret，且不要提交到仓库。');
} catch (error) {
  console.error(`keygen 失败：${error.message}`);
  process.exit(1);
}
