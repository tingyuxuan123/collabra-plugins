import {
  HISTORY_LEDGER_SCHEMA_VERSION,
  MAX_PACKAGE_BYTES,
  MAX_README_BYTES,
  packagePath,
  readmePath,
} from './constants.mjs';
import { compareVersions, isPluginId, isReleaseVersion } from './ids.mjs';
import { validateCompatibility } from './schema.mjs';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isHex = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hasOnlyKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));

export const emptyLedger = {
  schemaVersion: HISTORY_LEDGER_SCHEMA_VERSION,
  sequence: 0,
  artifacts: [],
};

export const artifactKey = (pluginId, version) => `${pluginId}@${version}`;

const ARTIFACT_KEYS = [
  'pluginId',
  'version',
  'path',
  'sha256',
  'size',
  'permissions',
  'compatibility',
  'readme',
];
const README_KEYS = ['path', 'sha256', 'size'];

function normalizeArtifact(raw) {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ARTIFACT_KEYS)) return null;
  if (!isPluginId(raw.pluginId) || !isReleaseVersion(raw.version)) return null;
  if (raw.path !== packagePath(raw.pluginId, raw.version)) return null;
  if (!isHex(raw.sha256)) return null;
  if (
    !Number.isSafeInteger(raw.size) ||
    raw.size <= 0 ||
    raw.size > MAX_PACKAGE_BYTES
  )
    return null;
  if (
    !Array.isArray(raw.permissions) ||
    raw.permissions.length > 64 ||
    new Set(raw.permissions).size !== raw.permissions.length ||
    raw.permissions.some((item) => typeof item !== 'string' || item.length > 64)
  )
    return null;
  const compatibility = validateCompatibility(raw.compatibility);
  if (!compatibility.ok) return null;
  if (
    !isRecord(raw.readme) ||
    !hasOnlyKeys(raw.readme, README_KEYS) ||
    raw.readme.path !== readmePath(raw.pluginId, raw.version) ||
    !isHex(raw.readme.sha256) ||
    !Number.isSafeInteger(raw.readme.size) ||
    raw.readme.size <= 0 ||
    raw.readme.size > MAX_README_BYTES
  )
    return null;
  return {
    pluginId: raw.pluginId,
    version: raw.version,
    path: raw.path,
    sha256: raw.sha256,
    size: raw.size,
    permissions: [...raw.permissions],
    compatibility: compatibility.value,
    readme: {
      path: raw.readme.path,
      sha256: raw.readme.sha256,
      size: raw.readme.size,
    },
  };
}

export function parseLedger(raw) {
  const errors = [];
  if (!isRecord(raw)) return { ok: false, errors: ['ledger 必须是对象'] };
  if (!hasOnlyKeys(raw, ['schemaVersion', 'sequence', 'artifacts']))
    errors.push('ledger 含未知字段');
  if (raw.schemaVersion !== HISTORY_LEDGER_SCHEMA_VERSION)
    errors.push('ledger schemaVersion 不支持');
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0)
    errors.push('ledger sequence 不合法');
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length > 10000)
    errors.push('ledger artifacts 不合法');
  const seen = new Set();
  const artifacts = [];
  for (const [index, item] of (Array.isArray(raw.artifacts) ? raw.artifacts : []).entries()) {
    const artifact = normalizeArtifact(item);
    if (!artifact) {
      errors.push(`ledger artifacts[${index}] 不合法`);
      continue;
    }
    const key = artifactKey(artifact.pluginId, artifact.version);
    if (seen.has(key)) errors.push(`ledger 重复条目：${key}`);
    seen.add(key);
    if (artifacts.length > 0) {
      const previous = artifacts.at(-1);
      if (
        previous.pluginId > artifact.pluginId ||
        (previous.pluginId === artifact.pluginId &&
          compareVersions(previous.version, artifact.version) >= 0)
      )
        errors.push('ledger artifacts 必须按插件与版本严格排序');
    }
    artifacts.push(artifact);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: HISTORY_LEDGER_SCHEMA_VERSION,
      sequence: raw.sequence,
      artifacts,
    },
  };
}

export function buildLedger(sequence, artifacts) {
  const sorted = [...artifacts].sort((a, b) => {
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    return compareVersions(a.version, b.version);
  });
  const parsed = parseLedger({
    schemaVersion: HISTORY_LEDGER_SCHEMA_VERSION,
    sequence,
    artifacts: sorted,
  });
  if (!parsed.ok) throw new Error(`ledger 不合法：${parsed.errors.join('; ')}`);
  return parsed.value;
}

export function ledgerMap(ledger) {
  return new Map(
    ledger.artifacts.map((artifact) => [
      artifactKey(artifact.pluginId, artifact.version),
      artifact,
    ])
  );
}

export function sameArtifact(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
