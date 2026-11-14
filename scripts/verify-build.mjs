#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_INDEX_BYTES } from './lib/constants.mjs';
import { assertPinnedKey, verifyBytes } from './lib/crypto.mjs';
import { sha256File } from './lib/fs.mjs';
import { loadHistory } from './lib/history.mjs';
import { parseMarketIndex } from './lib/schema.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const usage = `用法：node scripts/verify-build.mjs [选项]

校验构建产物的索引结构、包/README 哈希与站点文件。
加 --signed 时同时用内置公钥验证 index.json.sig。

选项：
  --out <dir>          产物目录（默认 build）
  --signed             要求并验证 Ed25519 签名
  --public-key <pem>   公钥（默认 market-public-key.pem）
  --allow-test-key     允许非生产公钥（仅本地测试）
  -h, --help           显示帮助`;

function parseArgs(argv) {
  const options = {
    out: join(repoRoot, 'build'),
    signed: false,
    publicKey: join(repoRoot, 'market-public-key.pem'),
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
    else if (arg === '--signed') options.signed = true;
    else if (arg === '--public-key') options.publicKey = resolve(next());
    else if (arg === '--allow-test-key') options.allowTestKey = true;
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
  const fingerprint = assertPinnedKey(publicKeyPem, { allowTestKey: options.allowTestKey });
  const v1 = join(options.out, 'v1');
  const indexPath = join(v1, 'index.json');
  if (!existsSync(indexPath)) throw new Error('缺少 v1/index.json');
  const raw = readFileSync(indexPath);
  if (raw.length > MAX_INDEX_BYTES) throw new Error('索引超过大小上限');
  if (options.signed) {
    const signaturePath = join(v1, 'index.json.sig');
    if (!existsSync(signaturePath)) throw new Error('缺少 v1/index.json.sig');
    const signature = readFileSync(signaturePath, 'utf8').trim();
    if (!verifyBytes(raw, signature, publicKeyPem)) throw new Error('索引签名无效');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('索引不是合法 JSON');
  }
  const validated = parseMarketIndex(parsed);
  if (!validated.ok) throw new Error(`索引结构无效：${validated.errors.join('; ')}`);
  const index = validated.value;
  for (const plugin of index.plugins) {
    for (const version of plugin.versions) {
      const path = join(v1, version.path);
      if (!existsSync(path)) throw new Error(`缺少包：${version.path}`);
      if (statSync(path).size !== version.size)
        throw new Error(`包大小不匹配：${version.path}`);
      if (sha256File(path) !== version.sha256) throw new Error(`包哈希不匹配：${version.path}`);
    }
    if (plugin.readme) {
      const path = join(v1, plugin.readme.path);
      if (!existsSync(path)) throw new Error(`缺少 README：${plugin.readme.path}`);
      if (statSync(path).size !== plugin.readme.size)
        throw new Error(`README 大小不匹配：${plugin.readme.path}`);
      if (sha256File(path) !== plugin.readme.sha256)
        throw new Error(`README 哈希不匹配：${plugin.readme.path}`);
    }
  }
  for (const file of ['index.html', 'site.css', 'catalog.js']) {
    if (!existsSync(join(options.out, file))) throw new Error(`站点缺少 ${file}`);
  }
  if (options.signed) {
    loadHistory(options.out, {
      publicKeyPem,
      allowTestKey: options.allowTestKey,
    });
  }
  console.log(
    `产物校验通过${options.signed ? '（已验签）' : '（未签名）'}：sequence=${index.sequence}，插件 ${index.plugins.length} 个，公钥指纹 ${fingerprint}`
  );
} catch (error) {
  console.error(`verify 失败：${error.message}`);
  process.exit(1);
}
