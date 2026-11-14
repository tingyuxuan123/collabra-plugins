import {
  HOST,
  MAX_PACKAGE_BYTES,
  MAX_README_BYTES,
  MARKET_API_VERSION,
  MARKET_CATEGORIES,
  MARKET_ID,
  MIN_APP_VERSION,
  PLATFORMS,
  SCHEMA_VERSION,
  TESTED_SURFACES,
  TIERS,
} from './constants.mjs';
import {
  compareVersions,
  isHttpsUrl,
  isPluginId,
  isReleaseVersion,
  isSafeRelativePath,
} from './ids.mjs';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isStringList = (value, maxItem = 64, maxItems = 64) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => typeof item === 'string' && item.length <= maxItem);
const hasOnlyKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));

const COMPATIBILITY_KEYS = [
  'host',
  'apiVersion',
  'minAppVersion',
  'maxAppVersion',
  'platforms',
  'testedSurfaces',
];
const VERSION_KEYS = ['version', 'permissions', 'path', 'sha256', 'size', 'compatibility'];
const PLUGIN_KEYS = [
  'id',
  'name',
  'description',
  'tier',
  'category',
  'tags',
  'license',
  'homepage',
  'screenshots',
  'readme',
  'versions',
];
const README_KEYS = ['path', 'sha256', 'size'];
const SCREENSHOT_KEYS = ['url', 'alt'];

export function validateCompatibility(raw) {
  const errors = [];
  if (!isRecord(raw)) return { ok: false, errors: ['compatibility 必须是对象'] };
  if (!hasOnlyKeys(raw, COMPATIBILITY_KEYS)) errors.push('compatibility 含未知字段');
  if (raw.host !== HOST) errors.push(`compatibility.host 必须是 ${HOST}`);
  if (raw.apiVersion !== MARKET_API_VERSION)
    errors.push(`compatibility.apiVersion 必须是 ${MARKET_API_VERSION}`);
  if (!isReleaseVersion(raw.minAppVersion))
    errors.push('compatibility.minAppVersion 必须是严格三段版本号');
  else if (compareVersions(raw.minAppVersion, MIN_APP_VERSION) < 0)
    errors.push(`compatibility.minAppVersion 不能低于 ${MIN_APP_VERSION}`);
  if (raw.maxAppVersion !== undefined) {
    if (!isReleaseVersion(raw.maxAppVersion))
      errors.push('compatibility.maxAppVersion 必须是严格三段版本号');
    else if (
      isReleaseVersion(raw.minAppVersion) &&
      compareVersions(raw.maxAppVersion, raw.minAppVersion) < 0
    )
      errors.push('compatibility.maxAppVersion 不能小于 minAppVersion');
  }
  if (
    !Array.isArray(raw.platforms) ||
    raw.platforms.length === 0 ||
    raw.platforms.length > PLATFORMS.length ||
    new Set(raw.platforms).size !== raw.platforms.length ||
    raw.platforms.some((item) => !PLATFORMS.includes(item))
  )
    errors.push('compatibility.platforms 必须是受支持平台的非空无重复子集');
  if (
    !Array.isArray(raw.testedSurfaces) ||
    new Set(raw.testedSurfaces).size !== raw.testedSurfaces.length ||
    raw.testedSurfaces.some((item) => !TESTED_SURFACES.includes(item))
  )
    errors.push('compatibility.testedSurfaces 含未知界面');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      host: HOST,
      apiVersion: MARKET_API_VERSION,
      minAppVersion: raw.minAppVersion,
      ...(raw.maxAppVersion !== undefined ? { maxAppVersion: raw.maxAppVersion } : {}),
      platforms: [...raw.platforms],
      testedSurfaces: [...raw.testedSurfaces],
    },
  };
}

export function validateMarketVersion(raw, pluginId) {
  if (!isRecord(raw)) return { ok: false, errors: ['版本条目必须是对象'] };
  const errors = [];
  if (!hasOnlyKeys(raw, VERSION_KEYS)) errors.push('版本条目含未知字段');
  if (!isReleaseVersion(raw.version)) errors.push('version 必须是严格三段版本号');
  if (!isStringList(raw.permissions, 64, 64)) errors.push('permissions 必须是最多 64 项的字符串数组');
  const expectedPath =
    isPluginId(pluginId) && isReleaseVersion(raw.version)
      ? `packages/${pluginId}/${raw.version}.zip`
      : null;
  if (!isSafeRelativePath(raw.path) || raw.path !== expectedPath)
    errors.push('path 必须指向规范包路径 packages/<id>/<version>.zip');
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256))
    errors.push('sha256 必须是 64 位小写十六进制');
  if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > MAX_PACKAGE_BYTES)
    errors.push('size 必须是正整数且不超过 200MB');
  const compatibility = validateCompatibility(raw.compatibility);
  if (!compatibility.ok) errors.push(...compatibility.errors);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version: raw.version,
      permissions: [...raw.permissions],
      path: raw.path,
      sha256: raw.sha256,
      size: raw.size,
      compatibility: compatibility.value,
    },
  };
}

export function validateMarketPlugin(raw) {
  if (!isRecord(raw)) return { ok: false, errors: ['插件条目必须是对象'] };
  const errors = [];
  if (!hasOnlyKeys(raw, PLUGIN_KEYS)) errors.push('插件条目含未知字段');
  if (!isPluginId(raw.id)) errors.push('id 不合法');
  if (!isText(raw.name, 60)) errors.push('name 不合法');
  if (typeof raw.description !== 'string' || raw.description.length > 1000)
    errors.push('description 不合法');
  if (!TIERS.includes(raw.tier)) errors.push('tier 不合法');
  if (!MARKET_CATEGORIES.includes(raw.category)) errors.push('category 不合法');
  if (!isStringList(raw.tags, 32, 32)) errors.push('tags 不合法');
  if (!isText(raw.license, 80)) errors.push('license 不合法');
  if (raw.homepage !== undefined && !isHttpsUrl(raw.homepage)) errors.push('homepage 必须是 https');
  if (raw.screenshots !== undefined) {
    if (
      !Array.isArray(raw.screenshots) ||
      raw.screenshots.length > 6 ||
      raw.screenshots.some(
        (shot) =>
          !isRecord(shot) ||
          !hasOnlyKeys(shot, SCREENSHOT_KEYS) ||
          !isHttpsUrl(shot.url) ||
          typeof shot.alt !== 'string' ||
          shot.alt.length > 200
      )
    )
      errors.push('screenshots 不合法');
  }
  if (raw.readme !== undefined) {
    const expected =
      isPluginId(raw.id) &&
      Array.isArray(raw.versions) &&
      raw.versions.length > 0 &&
      isReleaseVersion(raw.versions.at(-1)?.version)
        ? `readmes/${raw.id}/${raw.versions.at(-1).version}.md`
        : null;
    if (
      !isRecord(raw.readme) ||
      !hasOnlyKeys(raw.readme, README_KEYS) ||
      !isSafeRelativePath(raw.readme.path) ||
      raw.readme.path !== expected ||
      typeof raw.readme.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.readme.sha256) ||
      !Number.isSafeInteger(raw.readme.size) ||
      raw.readme.size <= 0 ||
      raw.readme.size > MAX_README_BYTES
    )
      errors.push('readme 不合法');
  }
  if (!Array.isArray(raw.versions) || raw.versions.length === 0) {
    errors.push('versions 必须是非空数组');
  } else {
    const parsed = raw.versions.map((version) => validateMarketVersion(version, raw.id));
    for (const result of parsed) if (!result.ok) errors.push(...result.errors);
    const versions = parsed.filter((result) => result.ok).map((result) => result.value.version);
    if (new Set(versions).size !== versions.length) errors.push('versions 含重复版本');
    for (let i = 1; i < versions.length; i++) {
      if (compareVersions(versions[i - 1], versions[i]) >= 0)
        errors.push('versions 必须按严格递增的版本号排序');
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: raw };
}

export function parseMarketIndex(raw) {
  const errors = [];
  if (!isRecord(raw)) return { ok: false, errors: ['索引必须是对象'] };
  const allowed = ['schemaVersion', 'marketId', 'sequence', 'generatedAt', 'plugins'];
  if (!hasOnlyKeys(raw, allowed)) errors.push('索引含未知顶层字段');
  if (raw.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion 必须是 ${SCHEMA_VERSION}`);
  if (raw.marketId !== MARKET_ID) errors.push(`marketId 必须是 ${MARKET_ID}`);
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0)
    errors.push('sequence 必须是非负安全整数');
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt)))
    errors.push('generatedAt 必须是 ISO 时间');
  if (!Array.isArray(raw.plugins)) {
    errors.push('plugins 必须是数组');
    return { ok: false, errors };
  }
  const seen = new Set();
  for (const [index, plugin] of raw.plugins.entries()) {
    const result = validateMarketPlugin(plugin);
    if (!result.ok) {
      errors.push(`plugins[${index}]: ${result.errors.join('; ')}`);
      continue;
    }
    if (seen.has(plugin.id)) errors.push(`plugins 含重复 id：${plugin.id}`);
    seen.add(plugin.id);
  }
  if (errors.length > 0) return { ok: false, errors };
  const plugins = [...raw.plugins]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      tier: plugin.tier,
      category: plugin.category,
      tags: [...plugin.tags],
      license: plugin.license,
      ...(plugin.homepage !== undefined ? { homepage: plugin.homepage } : {}),
      ...(plugin.screenshots !== undefined
        ? {
            screenshots: plugin.screenshots.map((shot) => ({
              url: shot.url,
              alt: shot.alt,
            })),
          }
        : {}),
      versions: [...plugin.versions]
        .sort((a, b) => compareVersions(a.version, b.version))
        .map((version) => ({ ...version, permissions: [...version.permissions] })),
      ...(plugin.readme !== undefined ? { readme: { ...plugin.readme } } : {}),
    }));
  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION,
      marketId: MARKET_ID,
      sequence: raw.sequence,
      generatedAt: raw.generatedAt,
      plugins,
    },
  };
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function versionEntry(plugin, version) {
  return plugin.versions.find((entry) => entry.version === version);
}
