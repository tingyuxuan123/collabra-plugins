import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairFiles } from '../scripts/lib/crypto.mjs';
import { buildMarket, signMarket } from '../scripts/lib/market.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const fixedNow = '2026-01-01T00:00:00.000Z';

export function tempDir(prefix = 'collabra-market-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function makeKeys(dir) {
  mkdirSync(dir, { recursive: true });
  const privatePath = join(dir, 'test-private.pem');
  const publicPath = join(dir, 'test-public.pem');
  const { fingerprint } = generateKeyPairFiles(privatePath, publicPath);
  return {
    privatePath,
    publicPath,
    privatePem: readFileSync(privatePath, 'utf8'),
    publicPem: readFileSync(publicPath, 'utf8'),
    fingerprint,
  };
}

export function copyPaperSource(root) {
  const sources = join(root, 'plugins');
  // 只复制 collabra.paper：构建/历史用例都在验证"已发布的那一个插件"。
  // 仓库里其他插件的入库与构建由各自用例（copyAllSources）覆盖。
  cpSync(join(repoRoot, 'plugins', 'collabra.paper'), join(sources, 'collabra.paper'), {
    recursive: true,
  });
  return sources;
}

/** 复制仓库里全部插件源，用于多插件入库/构建用例。 */
export function copyAllSources(root) {
  const sources = join(root, 'plugins');
  cpSync(join(repoRoot, 'plugins'), sources, { recursive: true });
  return sources;
}

export function paperMarketPath(sources, id = 'collabra.paper') {
  return join(sources, id, 'market.json');
}

export function paperVersionDir(sources, version, id = 'collabra.paper') {
  return join(sources, id, 'versions', version);
}

export function addPaperVersion(sources, version, { readme, compatibility } = {}) {
  const marketPath = paperMarketPath(sources);
  const market = readJson(marketPath);
  const dir = paperVersionDir(sources, version);
  cpSync(paperVersionDir(sources, '1.0.0'), dir, { recursive: true });
  const manifestPath = join(dir, 'enso-plugin.json');
  const manifest = readJson(manifestPath);
  manifest.version = version;
  writeJson(manifestPath, manifest);
  if (readme !== undefined) writeFileSync(join(dir, 'README.md'), readme);
  const baseCompatibility = Object.values(market.versions)[0].compatibility;
  market.versions[version] = {
    compatibility: compatibility ? { ...baseCompatibility, ...compatibility } : { ...baseCompatibility },
  };
  writeJson(marketPath, market);
  return dir;
}

export function testBuild({
  sources,
  history,
  out,
  keys,
  now = fixedNow,
  includeWeb = false,
}) {
  return buildMarket({
    sourcesDir: sources,
    historyDir: history,
    outDir: out,
    webDir: join(repoRoot, 'web'),
    now,
    publicKeyPem: keys.publicPem,
    allowTestKey: true,
    includeWeb,
  });
}

export function testSign({ out, history, keys }) {
  return signMarket({
    outDir: out,
    historyDir: history,
    privateKeyPem: keys.privatePem,
    publicKeyPem: keys.publicPem,
    allowTestKey: true,
  });
}

/**
 * 与主客户端 `marketIndex.isMarketCompatible` 同口径的协议筛选（平台命中 +
 * 三段版本边界 + 结构非法即不兼容）。市场侧测试引用它，避免只测"自己写的另一套规则"。
 */
const COMPAT_APP_VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const COMPAT_PLATFORMS = ['darwin', 'win32', 'linux'];
const COMPAT_SURFACES = ['code', 'bot', 'image-studio', 'taskboard', 'design', 'settings'];
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseCompatAppVersion(value) {
  const match = typeof value === 'string' ? COMPAT_APP_VERSION.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const compareCompatVersion = (left, right) =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

export function isMarketCompatible(raw, { hostVersion, platform } = {}) {
  if (!isRecord(raw)) return false;
  if (raw.host !== 'collabra' || raw.apiVersion !== 1) return false;
  const min = parseCompatAppVersion(raw.minAppVersion);
  const app = parseCompatAppVersion(hostVersion);
  if (!min || !app) return false;
  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0) return false;
  if (raw.platforms.some((item) => !COMPAT_PLATFORMS.includes(item))) return false;
  if (!raw.platforms.includes(platform)) return false;
  if (compareCompatVersion(app, min) < 0) return false;
  if (raw.maxAppVersion !== undefined) {
    const max = parseCompatAppVersion(raw.maxAppVersion);
    if (!max || compareCompatVersion(app, max) > 0) return false;
  }
  if (
    !Array.isArray(raw.testedSurfaces) ||
    raw.testedSurfaces.some((item) => !COMPAT_SURFACES.includes(item))
  )
    return false;
  return true;
}

/** 客户端只在这份兼容子集里挑最新版本；这里返回它选中的版本号。 */
export function latestCompatibleVersion(versions, host) {
  const compatible = versions.filter((version) => isMarketCompatible(version.compatibility, host));
  if (compatible.length === 0) return null;
  return compatible
    .map((version) => version.version)
    .sort((left, right) =>
      compareCompatVersion(parseCompatAppVersion(left), parseCompatAppVersion(right))
    )
    .at(-1);
}
