import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertPinnedKey,
  generateKeyPairFiles,
  privateKeyMatchesPublic,
  publicKeyFingerprint,
  publicKeySpkiBase64,
  signBytes,
  verifyBytes,
} from '../scripts/lib/crypto.mjs';
import { repoRoot, tempDir } from './helpers.mjs';

test('生产公钥指纹固定且与测试密钥隔离', () => {
  const production = readFileSync(join(repoRoot, 'market-public-key.pem'), 'utf8');
  assert.equal(
    publicKeyFingerprint(production),
    '731611380199cd338bbb3fcde8ef6f8bf9d7085c56ebe45374af057591f55bd4'
  );
  assert.equal(
    publicKeySpkiBase64(production),
    'MCowBQYDK2VwAyEA8d7tATk4T2mJ2vbSdVPNHIxClIctNMUwIsqboL5BRUQ='
  );
  assert.doesNotThrow(() => assertPinnedKey(production));
  const keys = makeTempKeys();
  assert.throws(() => assertPinnedKey(keys.publicPem));
  assert.doesNotThrow(() => assertPinnedKey(keys.publicPem, { allowTestKey: true }));
});

function makeTempKeys() {
  const dir = tempDir('collabra-key-test-');
  const privatePath = join(dir, 'private.pem');
  const publicPath = join(dir, 'public.pem');
  const { fingerprint } = generateKeyPairFiles(privatePath, publicPath);
  return {
    fingerprint,
    privatePem: readFileSync(privatePath, 'utf8'),
    publicPem: readFileSync(publicPath, 'utf8'),
  };
}

test('Ed25519 签名可验证，篡改与错钥都失败', () => {
  const keys = makeTempKeys();
  const bytes = Buffer.from('signed index bytes\n');
  const signature = signBytes(bytes, keys.privatePem);
  assert.equal(verifyBytes(bytes, signature, keys.publicPem), true);
  assert.equal(verifyBytes(Buffer.from('tampered'), signature, keys.publicPem), false);
  assert.equal(verifyBytes(bytes, signature, readFileSync(join(repoRoot, 'market-public-key.pem'), 'utf8')), false);
  assert.equal(verifyBytes(bytes, 'not base64!', keys.publicPem), false);
  assert.equal(privateKeyMatchesPublic(keys.privatePem, keys.publicPem), true);
});

test('keygen 私钥 0600、不覆盖且不打印私钥', () => {
  const dir = tempDir('collabra-keygen-test-');
  const privatePath = join(dir, 'private.pem');
  const publicPath = join(dir, 'public.pem');
  const first = generateKeyPairFiles(privatePath, publicPath);
  assert.equal(existsSync(privatePath), true);
  assert.equal(existsSync(publicPath), true);
  if (process.platform !== 'win32') assert.equal(statSync(privatePath).mode & 0o777, 0o600);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  assert.throws(() => generateKeyPairFiles(privatePath, join(dir, 'other.pem')), /已存在/);
  assert.throws(() => generateKeyPairFiles(join(dir, 'new.pem'), publicPath), /已存在/);
});

test('keygen CLI 只输出指纹与路径', () => {
  const dir = tempDir('collabra-keygen-cli-');
  const output = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts/keygen.mjs'), '--dir', dir],
    { encoding: 'utf8' }
  );
  assert.match(output, /公钥指纹：[0-9a-f]{64}/);
  assert.doesNotMatch(output, /BEGIN .*PRIVATE KEY/);
  const help = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts/keygen.mjs'), '--help'],
    { encoding: 'utf8' }
  );
  assert.match(help, /用法/);
  const again = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/keygen.mjs'), '--dir', dir],
    { encoding: 'utf8' }
  );
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /拒绝覆盖/);
});
