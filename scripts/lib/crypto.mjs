import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PRODUCTION_KEY_FINGERPRINT } from './constants.mjs';

export function publicKeyFingerprint(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function publicKeySpkiBase64(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

export function assertPinnedKey(publicKeyPem, { allowTestKey = false } = {}) {
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (!allowTestKey && fingerprint !== PRODUCTION_KEY_FINGERPRINT)
    throw new Error(
      `拒绝非生产公钥（${fingerprint}）；本地测试请显式使用 --allow-test-key 与临时密钥`
    );
  return fingerprint;
}

export function signBytes(bytes, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('签名私钥必须是 Ed25519');
  return sign(null, Buffer.from(bytes), key).toString('base64');
}

export function verifyBytes(bytes, signatureBase64, publicKeyPem) {
  if (typeof signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64))
    return false;
  try {
    return verify(
      null,
      Buffer.from(bytes),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

export function privateKeyMatchesPublic(privateKeyPem, publicKeyPem) {
  const derived = createPublicKey(createPrivateKey(privateKeyPem));
  const expected = createPublicKey(publicKeyPem);
  return (
    derived.export({ type: 'spki', format: 'der' }).toString('base64') ===
    expected.export({ type: 'spki', format: 'der' }).toString('base64')
  );
}

/** Generate an Ed25519 key pair without ever printing the private key. */
export function generateKeyPairFiles(privateKeyPath, publicKeyPath) {
  if (existsSync(privateKeyPath)) throw new Error(`私钥已存在，拒绝覆盖：${privateKeyPath}`);
  if (existsSync(publicKeyPath)) throw new Error(`公钥已存在，拒绝覆盖：${publicKeyPath}`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(privateKeyPath, privatePem, { mode: 0o600, flag: 'wx' });
  chmodSync(privateKeyPath, 0o600);
  writeFileSync(publicKeyPath, publicPem, { mode: 0o644, flag: 'wx' });
  return { fingerprint: publicKeyFingerprint(publicPem) };
}

export function readPem(path) {
  return readFileSync(path, 'utf8');
}
