#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signMarket } from './lib/market.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `用法：node scripts/sign-market.mjs [选项]

签名前会再次验证历史签名、包哈希与不可变字段。私钥只从 --key 文件或
COLLABRA_MARKET_PRIVATE_KEY 读取，绝不打印。

选项：
  --out <dir>          待签名产物目录（默认 build）
  --history <dir>      历史 dist 根目录（默认 .dist-history）
  --key <path>         私钥 PEM 文件；省略时读取环境变量
  --public-key <pem>   仓库内置公钥（默认 market-public-key.pem）
  --allow-test-key     允许非生产密钥（仅本地测试）
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const options = {
    out: join(repoRoot, 'build'),
    history: join(repoRoot, '.dist-history'),
    publicKey: join(repoRoot, 'market-public-key.pem'),
    key: null,
    allowTestKey: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} 缺少参数值`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out') options.out = resolve(next());
    else if (arg === '--history') options.history = resolve(next());
    else if (arg === '--key') options.key = resolve(next());
    else if (arg === '--public-key') options.publicKey = resolve(next());
    else if (arg === '--allow-test-key') options.allowTestKey = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function readPrivateKey(path) {
  if (path) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error('私钥文件不存在');
    return readFileSync(path, 'utf8');
  }
  const fromEnv = process.env.COLLABRA_MARKET_PRIVATE_KEY;
  if (!fromEnv) throw new Error('未提供私钥：请使用 --key 或 COLLABRA_MARKET_PRIVATE_KEY');
  return fromEnv.replace(/\\n/g, '\n');
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    process.exit(0);
  }
  const publicKeyPem = readFileSync(options.publicKey, 'utf8');
  const result = signMarket({
    outDir: options.out,
    historyDir: options.history,
    privateKeyPem: readPrivateKey(options.key),
    publicKeyPem,
    allowTestKey: options.allowTestKey,
  });
  console.log(`已签名 sequence=${result.sequence}`);
  console.log(`公钥指纹：${result.fingerprint}`);
  console.log(`索引 SHA-256：${result.indexSha256}`);
} catch (error) {
  console.error(`sign 失败：${error.message}`);
  process.exit(1);
}
