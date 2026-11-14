import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { copyPaperSource, repoRoot, tempDir } from './helpers.mjs';

function run(args, options = {}) {
  const { env: extraEnv, ...spawnOptions } = options;
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...spawnOptions,
    env: { ...process.env, ...extraEnv },
  });
}

test('所有 CLI 都支持 --help 且不回显密钥', () => {
  for (const script of [
    'scripts/build-market.mjs',
    'scripts/sign-market.mjs',
    'scripts/keygen.mjs',
    'scripts/validate-source.mjs',
    'scripts/verify-build.mjs',
  ]) {
    const result = run([join(repoRoot, script), '--help']);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    assert.match(result.stdout, /用法|选项/);
    assert.doesNotMatch(result.stdout, /BEGIN .*PRIVATE KEY/);
  }
});

test('build → sign → verify 完整 CLI 流程（临时测试密钥）', () => {
  const root = tempDir('collabra-cli-flow-');
  const sources = copyPaperSource(root);
  const keyDir = join(root, 'keys');
  const keygen = run([join(repoRoot, 'scripts/keygen.mjs'), '--dir', keyDir]);
  assert.equal(keygen.status, 0, keygen.stderr);
  assert.match(keygen.stdout, /公钥指纹/);
  const out = join(root, 'out');
  const publicKey = join(keyDir, 'market-public-key.pem');
  const privateKey = join(keyDir, 'market-private-key.pem');
  const build = run([
    join(repoRoot, 'scripts/build-market.mjs'),
    '--sources',
    sources,
    '--history',
    join(root, 'none'),
    '--out',
    out,
    '--public-key',
    publicKey,
    '--allow-test-key',
  ]);
  assert.equal(build.status, 0, build.stderr);
  assert.match(build.stdout, /sequence=1/);
  assert.equal(existsSync(join(out, 'v1', 'index.json')), true);
  assert.equal(existsSync(join(out, 'v1', 'index.json.sig')), false);
  const sign = run([
    join(repoRoot, 'scripts/sign-market.mjs'),
    '--out',
    out,
    '--history',
    join(root, 'none'),
    '--key',
    privateKey,
    '--public-key',
    publicKey,
    '--allow-test-key',
  ]);
  assert.equal(sign.status, 0, sign.stderr);
  assert.match(sign.stdout, /已签名 sequence=1/);
  assert.doesNotMatch(sign.stdout, /BEGIN .*PRIVATE KEY/);
  assert.equal(existsSync(join(out, 'v1', 'index.json.sig')), true);
  const verify = run([
    join(repoRoot, 'scripts/verify-build.mjs'),
    '--out',
    out,
    '--signed',
    '--public-key',
    publicKey,
    '--allow-test-key',
  ]);
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /已验签/);
});

test('缺少私钥时 sign 失败且不泄露环境内容', () => {
  const result = run([join(repoRoot, 'scripts/sign-market.mjs')], {
    env: { COLLABRA_MARKET_PRIVATE_KEY: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /未提供私钥/);
  assert.doesNotMatch(result.stderr, /PRIVATE KEY/);
});

test('仓库源可通过 validate 与 secrets 检查', () => {
  const validate = run([join(repoRoot, 'scripts/validate-source.mjs')]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /collabra\.paper/);
  const secrets = run([join(repoRoot, 'scripts/check-secrets.mjs')]);
  assert.equal(secrets.status, 0, secrets.stderr);
  assert.match(secrets.stdout, /未发现私钥/);
});
