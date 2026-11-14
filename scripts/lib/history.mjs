import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  MAX_INDEX_BYTES,
  MAX_LEDGER_BYTES,
  MAX_HISTORY_DEPTH,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_GENERATIONS,
  MARKET_ID,
  SCHEMA_VERSION,
  historyLedgerPath,
  historyLedgerSignaturePath,
  historySnapshotPath,
  historySnapshotSignaturePath,
} from './constants.mjs';
import { assertPinnedKey, verifyBytes } from './crypto.mjs';
import { assertNoLinks, sha256File } from './fs.mjs';
import {
  artifactKey,
  emptyLedger,
  ledgerMap,
  parseLedger,
  sameArtifact,
} from './ledger.mjs';
import { parseMarketIndex } from './schema.mjs';

export const emptyIndex = {
  schemaVersion: SCHEMA_VERSION,
  marketId: MARKET_ID,
  sequence: 0,
  generatedAt: '1970-01-01T00:00:00.000Z',
  plugins: [],
};

function emptyHistory(fingerprint) {
  return {
    index: emptyIndex,
    root: null,
    raw: null,
    signature: null,
    fingerprint,
    ledger: emptyLedger,
    artifacts: new Map(),
    historyDir: null,
  };
}

function readBounded(path, maxBytes, label) {
  const info = statSync(path);
  if (!info.isFile()) throw new Error(`${label} 必须是普通文件`);
  if (info.size > maxBytes) throw new Error(`${label} 超过大小上限`);
  return readFileSync(path);
}

function readSigned(path, signaturePath, publicKeyPem, label, maxBytes) {
  if (!existsSync(path) || !existsSync(signaturePath))
    throw new Error(`${label} 或签名缺失`);
  const bytes = readBounded(path, maxBytes, label);
  const signature = readFileSync(signaturePath, 'utf8').trim();
  if (!verifyBytes(bytes, signature, publicKeyPem))
    throw new Error(`${label} 签名无效`);
  return { bytes, signature };
}

function parseIndexBytes(bytes, label) {
  let raw;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
  const parsed = parseMarketIndex(raw);
  if (!parsed.ok) throw new Error(`${label} 结构无效：${parsed.errors.join('; ')}`);
  return parsed.value;
}

function parseLedgerBytes(bytes, label) {
  let raw;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
  const parsed = parseLedger(raw);
  if (!parsed.ok) throw new Error(`${label} 结构无效：${parsed.errors.join('; ')}`);
  return parsed.value;
}

function versionFieldsMatch(left, right) {
  return (
    left.path === right.path &&
    left.sha256 === right.sha256 &&
    left.size === right.size &&
    JSON.stringify(left.permissions) === JSON.stringify(right.permissions) &&
    JSON.stringify(left.compatibility) === JSON.stringify(right.compatibility)
  );
}

function assertSnapshotMatchesLedger(index, artifacts, label) {
  for (const plugin of index.plugins) {
    for (const version of plugin.versions) {
      const artifact = artifacts.get(artifactKey(plugin.id, version.version));
      if (!artifact) throw new Error(`${label} 缺少 ledger 条目：${plugin.id}@${version.version}`);
      if (!versionFieldsMatch(version, artifact))
        throw new Error(`${label} 与 ledger 字段不一致：${plugin.id}@${version.version}`);
    }
    if (plugin.readme) {
      const latest = plugin.versions.at(-1);
      const artifact = artifacts.get(artifactKey(plugin.id, latest.version));
      if (
        !artifact ||
        artifact.readme.path !== plugin.readme.path ||
        artifact.readme.sha256 !== plugin.readme.sha256 ||
        artifact.readme.size !== plugin.readme.size
      )
        throw new Error(`${label} 的 README 与 ledger 不一致：${plugin.id}`);
    }
  }
}

export function verifyLedgerArtifacts(v1, ledger) {
  for (const artifact of ledger.artifacts) {
    const packageFile = join(v1, artifact.path);
    if (!existsSync(packageFile)) throw new Error(`ledger 包缺失：${artifact.path}`);
    if (statSync(packageFile).size !== artifact.size)
      throw new Error(`ledger 包大小不匹配：${artifact.path}`);
    if (sha256File(packageFile) !== artifact.sha256)
      throw new Error(`ledger 包哈希不匹配：${artifact.path}`);
    const readmeFile = join(v1, artifact.readme.path);
    if (!existsSync(readmeFile)) throw new Error(`ledger README 缺失：${artifact.readme.path}`);
    if (statSync(readmeFile).size !== artifact.readme.size)
      throw new Error(`ledger README 大小不匹配：${artifact.readme.path}`);
    if (sha256File(readmeFile) !== artifact.readme.sha256)
      throw new Error(`ledger README 哈希不匹配：${artifact.readme.path}`);
  }
}

export function verifyNoUnledgeredArtifacts(v1, ledger) {
  const allowed = new Set();
  for (const artifact of ledger.artifacts) {
    allowed.add(artifact.path);
    allowed.add(artifact.readme.path);
  }
  for (const folder of ['packages', 'readmes']) {
    const root = join(v1, folder);
    if (!existsSync(root)) continue;
    assertNoLinks(root, folder, {
      maxEntries: MAX_HISTORY_ENTRIES,
      maxDepth: MAX_HISTORY_DEPTH,
    });
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (lstatSync(path).isDirectory()) walk(path);
        else {
          const rel = relative(v1, path).split(sep).join('/');
          if (!allowed.has(rel)) throw new Error(`未在 signed ledger 中的产物：${rel}`);
        }
      }
    };
    walk(root);
  }
}

/**
 * Verify the complete signed generation chain and the immutable artifact ledger.
 * History is authoritative only when every snapshot, ledger, package and README
 * verifies; missing snapshots or unledgered files are rejected.
 */
export function loadHistory(historyRoot, { publicKeyPem, allowTestKey = false } = {}) {
  const fingerprint = assertPinnedKey(publicKeyPem, { allowTestKey });
  if (!historyRoot || !existsSync(historyRoot)) return emptyHistory(fingerprint);
  if (!lstatSync(historyRoot).isDirectory())
    throw new Error('历史 dist 路径必须是目录');
  assertNoLinks(historyRoot, '历史 dist', {
    maxEntries: MAX_HISTORY_ENTRIES,
    maxDepth: MAX_HISTORY_DEPTH,
  });
  const v1 = join(historyRoot, 'v1');
  if (!existsSync(v1)) {
    if (readdirSync(historyRoot).length > 0) throw new Error('历史 dist 缺少 v1 目录');
    return emptyHistory(fingerprint);
  }
  const indexPath = join(v1, 'index.json');
  const signaturePath = join(v1, 'index.json.sig');
  if (!existsSync(indexPath) && !existsSync(signaturePath)) {
    if (readdirSync(v1).length > 0)
      throw new Error('历史索引缺失但 v1 目录非空，拒绝丢弃历史');
    return emptyHistory(fingerprint);
  }
  if (!existsSync(indexPath) || !existsSync(signaturePath))
    throw new Error('历史 dist 的 index.json 与 .sig 必须同时存在');
  const allowedV1 = new Set(['index.json', 'index.json.sig', 'history', 'packages', 'readmes']);
  for (const name of readdirSync(v1)) {
    if (!allowedV1.has(name)) throw new Error(`历史 v1 含未验证文件：${name}`);
  }
  const { bytes: raw, signature } = readSigned(
    indexPath,
    signaturePath,
    publicKeyPem,
    '历史索引',
    MAX_INDEX_BYTES
  );
  const index = parseIndexBytes(raw, '历史索引');
  const sequence = index.sequence;
  if (sequence < 1 || sequence > MAX_HISTORY_GENERATIONS)
    throw new Error('历史索引 sequence 不合法');
  const historyDir = join(v1, 'history');
  if (!existsSync(historyDir)) throw new Error('历史 snapshot 缺失，拒绝在无历史账本上发布');
  if (!lstatSync(historyDir).isDirectory()) throw new Error('历史 snapshot 目录不合法');

  const expected = new Set();
  for (let n = 1; n <= sequence; n++) {
    for (const path of [
      historySnapshotPath(n),
      historySnapshotSignaturePath(n),
      historyLedgerPath(n),
      historyLedgerSignaturePath(n),
    ])
      expected.add(path.slice('history/'.length));
  }
  const actual = readdirSync(historyDir).sort();
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name)))
    throw new Error('历史 snapshot/ledger 文件集合不完整或含未验证文件');

  let artifacts = new Map();
  let latestLedger = emptyLedger;
  for (let n = 1; n <= sequence; n++) {
    const snapshot = readSigned(
      join(v1, historySnapshotPath(n)),
      join(v1, historySnapshotSignaturePath(n)),
      publicKeyPem,
      `历史 snapshot ${n}`,
      MAX_INDEX_BYTES
    );
    const snapshotIndex = parseIndexBytes(snapshot.bytes, `历史 snapshot ${n}`);
    if (snapshotIndex.sequence !== n)
      throw new Error(`历史 snapshot ${n} 的 sequence 不匹配`);
    if (n === sequence && !snapshot.bytes.equals(raw))
      throw new Error('当前 index.json 与最新 signed snapshot 不一致');

    const ledger = parseLedgerBytes(
      readSigned(
        join(v1, historyLedgerPath(n)),
        join(v1, historyLedgerSignaturePath(n)),
        publicKeyPem,
        `历史 ledger ${n}`,
        MAX_LEDGER_BYTES
      ).bytes,
      `历史 ledger ${n}`
    );
    if (ledger.sequence !== n) throw new Error(`历史 ledger ${n} 的 sequence 不匹配`);
    const current = ledgerMap(ledger);
    for (const [key, previous] of artifacts) {
      const candidate = current.get(key);
      if (!candidate || !sameArtifact(previous, candidate))
        throw new Error(`历史 ledger ${n} 丢失或改写旧条目：${key}`);
    }
    for (const [key, artifact] of current) {
      const previous = artifacts.get(key);
      if (previous && !sameArtifact(previous, artifact))
        throw new Error(`历史 ledger ${n} 改写旧条目：${key}`);
      artifacts.set(key, artifact);
    }
    assertSnapshotMatchesLedger(snapshotIndex, artifacts, `历史 snapshot ${n}`);
    latestLedger = ledger;
  }
  if (latestLedger.sequence !== sequence)
    throw new Error('最新 ledger 与索引 sequence 不一致');
  verifyLedgerArtifacts(v1, latestLedger);
  verifyNoUnledgeredArtifacts(v1, latestLedger);

  return {
    index,
    root: v1,
    raw,
    signature,
    fingerprint,
    ledger: latestLedger,
    artifacts,
    historyDir,
  };
}
