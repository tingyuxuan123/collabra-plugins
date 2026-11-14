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
