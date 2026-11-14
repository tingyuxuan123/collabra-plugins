#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPinnedKey } from './lib/crypto.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['.git', 'node_modules', 'build', 'out', '.dist-history', '.dist-work']);
const privateKeyPattern = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) walk(path);
    else if (info.isFile()) {
      if (info.size > 1024 * 1024) continue;
      const rel = relative(repoRoot, path);
      if (privateKeyPattern.test(readFileSync(path, 'utf8'))) findings.push(`私钥内容：${rel}`);
      if (/private.*\.pem$/i.test(name) || /\.key$/i.test(name)) findings.push(`私钥文件：${rel}`);
    }
  }
}

try {
  walk(repoRoot);
  for (const name of readdirSync(join(repoRoot, '.github', 'workflows'))) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const body = readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8');
    if (body.includes('--allow-test-key')) findings.push(`生产工作流禁止测试密钥开关：${name}`);
    if (body.includes('pull_request_target')) findings.push(`禁止 pull_request_target：${name}`);
  }
  const publicKey = readFileSync(join(repoRoot, 'market-public-key.pem'), 'utf8');
  const fingerprint = assertPinnedKey(publicKey);
  if (findings.length > 0) throw new Error(findings.join('; '));
  console.log(`未发现私钥或测试密钥；生产公钥指纹 ${fingerprint}`);
} catch (error) {
  console.error(`check:secrets 失败：${error.message}`);
  process.exit(1);
}
