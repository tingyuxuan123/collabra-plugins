import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMarketIndex,
  validateCompatibility,
  validateMarketPlugin,
  validateMarketVersion,
} from '../scripts/lib/schema.mjs';

const sha = 'a'.repeat(64);
const compatibility = {
  host: 'collabra',
  apiVersion: 1,
  minAppVersion: '0.2.80',
  platforms: ['darwin', 'win32', 'linux'],
  testedSurfaces: [],
};
const version = {
  version: '1.0.0',
  permissions: [],
  path: 'packages/collabra.paper/1.0.0.zip',
  sha256: sha,
  size: 1234,
  compatibility,
};
const plugin = {
  id: 'collabra.paper',
  name: 'Collabra Paper',
  description: 'Original neutral theme',
  tier: 'official',
  category: 'themes',
  tags: ['theme'],
  license: 'MIT',
  versions: [version],
  readme: {
    path: 'readmes/collabra.paper/1.0.0.md',
    sha256: sha,
    size: 120,
  },
};
const index = {
  schemaVersion: 2,
  marketId: 'collabra',
  sequence: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  plugins: [plugin],
};

test('接受 SPEC v2 索引并规范排序', () => {
  const result = parseMarketIndex(index);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));
  assert.equal(result.value.marketId, 'collabra');
  assert.equal(result.value.sequence, 1);
  assert.equal(result.value.plugins[0].versions[0].compatibility.testedSurfaces.length, 0);
});

test('拒绝 v1、错误市场、坏 sequence 与坏时间', () => {
  for (const candidate of [
    { ...index, schemaVersion: 1 },
    { ...index, marketId: 'enso' },
    { ...index, marketId: undefined },
    { ...index, sequence: -1 },
    { ...index, sequence: 1.5 },
    { ...index, generatedAt: 'not-a-date' },
    { ...index, extra: true },
  ]) {
    assert.equal(parseMarketIndex(candidate).ok, false);
  }
});

test('兼容性必须是完整 v2 块，不接受任意 semver 范围', () => {
  assert.equal(validateCompatibility(compatibility).ok, true);
  assert.equal(
    validateCompatibility({ ...compatibility, maxAppVersion: '0.2.99' }).ok,
    true
  );
  for (const candidate of [
    undefined,
    null,
    { ...compatibility, host: 'enso' },
    { ...compatibility, apiVersion: 2 },
    { ...compatibility, minAppVersion: '^0.2.80' },
    { ...compatibility, minAppVersion: '0.2.79' },
    { ...compatibility, maxAppVersion: '0.2.79' },
    { ...compatibility, platforms: [] },
    { ...compatibility, platforms: ['darwin', 'darwin'] },
    { ...compatibility, platforms: ['android'] },
    { ...compatibility, testedSurfaces: ['everything'] },
    { ...compatibility, testedSurfaces: ['code', 'code'] },
    { ...compatibility, range: '>=0.2.80' },
  ]) {
    assert.equal(validateCompatibility(candidate).ok, false, JSON.stringify(candidate));
  }
});

test('版本条目路径、哈希、大小与兼容性都校验', () => {
  assert.equal(validateMarketVersion(version, 'collabra.paper').ok, true);
  const bad = [
    { ...version, path: 'packages/other/1.0.0.zip' },
    { ...version, path: '../1.0.0.zip' },
    { ...version, sha256: 'A'.repeat(64) },
    { ...version, sha256: 'a'.repeat(63) },
    { ...version, size: 0 },
    { ...version, version: '1.0' },
    { ...version, extra: true },
    { ...version, compatibility: { ...compatibility, apiVersion: 2 } },
  ];
  for (const candidate of bad)
    assert.equal(validateMarketVersion(candidate, 'collabra.paper').ok, false);
});

test('插件重复版本、乱序、未知字段和坏 README 被拒绝', () => {
  assert.equal(validateMarketPlugin(plugin).ok, true);
  const v101 = {
    ...version,
    version: '1.0.1',
    path: 'packages/collabra.paper/1.0.1.zip',
  };
  const bad = [
    { ...plugin, versions: [v101, version] },
    { ...plugin, versions: [version, version] },
    { ...plugin, extra: true },
    { ...plugin, id: 'Bad' },
    { ...plugin, tier: 'featured' },
    { ...plugin, category: 'misc' },
    { ...plugin, tags: [1] },
    { ...plugin, homepage: 'http://example.com' },
    { ...plugin, readme: { ...plugin.readme, path: 'readmes/collabra.paper/2.0.0.md' } },
    { ...plugin, readme: { ...plugin.readme, sha256: 'x' } },
    { ...plugin, readme: { ...plugin.readme, size: 0 } },
    { ...plugin, screenshots: [{ url: 'http://x', alt: '' }] },
  ];
  for (const candidate of bad) assert.equal(validateMarketPlugin(candidate).ok, false);
});

test('索引拒绝重复插件 id 和非法条目', () => {
  assert.equal(parseMarketIndex({ ...index, plugins: [plugin, plugin] }).ok, false);
  assert.equal(parseMarketIndex({ ...index, plugins: [{ ...plugin, id: 'bad' }] }).ok, false);
  assert.equal(parseMarketIndex({ ...index, plugins: 'nope' }).ok, false);
});
