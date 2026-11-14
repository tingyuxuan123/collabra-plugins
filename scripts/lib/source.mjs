import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_MANIFEST_BYTES,
  MAX_README_BYTES,
  SUPPORTED_PERMISSIONS,
} from './constants.mjs';
import { assertNoLinks, collectPackageFiles, readJson, sha256 } from './fs.mjs';
import {
  compareVersions,
  isHttpsUrl,
  isPluginId,
  isReleaseVersion,
  isSafeRelativePath,
} from './ids.mjs';
import { validateCompatibility, validateMarketPlugin } from './schema.mjs';
import { createZip } from './zip.mjs';

const META_KEYS = [
  'id',
  'name',
  'description',
  'tier',
  'category',
  'tags',
  'license',
  'homepage',
  'screenshots',
  'delisted',
  'versions',
];
const MANIFEST_KEYS = [
  'schemaVersion',
  'id',
  'name',
  'version',
  'description',
  'icon',
  'engines',
  'main',
  'renderer',
  'permissions',
  'fs',
  'net',
  'mcp',
  'resident',
  'env',
  'interop',
  'contributes',
];
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));

function parseManifest(pluginId, version, packageDir) {
  const path = join(packageDir, 'enso-plugin.json');
  if (!existsSync(path)) throw new Error(`${pluginId}@${version} 缺少 enso-plugin.json`);
  const manifest = readJson(path, MAX_MANIFEST_BYTES);
  if (!isRecord(manifest)) throw new Error(`${pluginId}@${version} 清单必须是对象`);
  if (Object.keys(manifest).some((key) => !MANIFEST_KEYS.includes(key)))
    throw new Error(`${pluginId}@${version} 清单含未知顶层字段`);
  if (manifest.contributes !== undefined && !isRecord(manifest.contributes))
    throw new Error(`${pluginId}@${version} 清单 contributes 必须是对象`);
  if (manifest.engines !== undefined) {
    if (
      !isRecord(manifest.engines) ||
      Object.keys(manifest.engines).some((key) => key !== 'enso') ||
      typeof manifest.engines.enso !== 'string' ||
      !/^>=(\d+)\.(\d+)\.(\d+)$/.test(manifest.engines.enso)
    )
      throw new Error(`${pluginId}@${version} 清单 engines 不合法`);
  }
  if (manifest.resident !== undefined && typeof manifest.resident !== 'boolean')
    throw new Error(`${pluginId}@${version} 清单 resident 不合法`);
  if (manifest.schemaVersion !== 1) throw new Error(`${pluginId}@${version} schemaVersion 必须是 1`);
  if (manifest.id !== pluginId) throw new Error(`${pluginId}@${version} 清单 id 不匹配`);
  if (manifest.version !== version) throw new Error(`${pluginId}@${version} 清单版本不匹配`);
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 60)
    throw new Error(`${pluginId}@${version} 清单 name 不合法`);
  if (typeof manifest.description !== 'string' || manifest.description.length > 1000)
    throw new Error(`${pluginId}@${version} 清单 description 不合法`);
  if (
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.length > 64 ||
    new Set(manifest.permissions).size !== manifest.permissions.length ||
    manifest.permissions.some((item) => typeof item !== 'string' || item.length > 64)
  )
    throw new Error(`${pluginId}@${version} 清单 permissions 不合法`);
  const unknownPermission = manifest.permissions.find(
    (item) => !SUPPORTED_PERMISSIONS.includes(item)
  );
  if (unknownPermission)
    throw new Error(`${pluginId}@${version} 未知权限 ${String(unknownPermission)}`);
  for (const key of ['main', 'renderer', 'icon']) {
    if (manifest[key] !== undefined && !isSafeRelativePath(manifest[key]))
      throw new Error(`${pluginId}@${version} 清单 ${key} 路径不安全`);
  }
  const themes = manifest.contributes?.themes;
  if (themes !== undefined) {
    if (!Array.isArray(themes) || themes.length > 20)
      throw new Error(`${pluginId}@${version} contributes.themes 不合法`);
    const ids = new Set();
    for (const theme of themes) {
      if (
        !isRecord(theme) ||
        typeof theme.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(theme.id) ||
        ids.has(theme.id) ||
        typeof theme.name !== 'string' ||
        !theme.name.trim() ||
        theme.name.length > 40 ||
        !isSafeRelativePath(theme.path) ||
        !theme.path.endsWith('.json') ||
        (theme.css !== undefined &&
          (!isSafeRelativePath(theme.css) || !theme.css.endsWith('.css')))
      )
        throw new Error(`${pluginId}@${version} contributes.themes 条目不合法`);
      ids.add(theme.id);
    }
  }
  return manifest;
}

function parseMarketMeta(pluginDir, directoryName) {
  const path = join(pluginDir, 'market.json');
  if (!existsSync(path)) throw new Error(`${directoryName} 缺少 market.json`);
  const meta = readJson(path, 64 * 1024);
  if (!isRecord(meta) || !hasOnlyKeys(meta, META_KEYS))
    throw new Error(`${directoryName}/market.json 含未知字段或格式错误`);
  if (meta.id !== directoryName || !isPluginId(meta.id))
    throw new Error(`${directoryName}/market.json id 必须等于目录名且合法`);
  if (typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 60)
    throw new Error(`${directoryName}/market.json name 不合法`);
  if (
    typeof meta.description !== 'string' ||
    !meta.description.trim() ||
    meta.description.length > 1000
  )
    throw new Error(`${directoryName}/market.json description 不合法`);
  if (!['official', 'community'].includes(meta.tier))
    throw new Error(`${directoryName}/market.json tier 不合法`);
  if (
    !Array.isArray(meta.tags) ||
    meta.tags.length > 32 ||
    meta.tags.some((tag) => typeof tag !== 'string' || !tag || tag.length > 32)
  )
    throw new Error(`${directoryName}/market.json tags 不合法`);
  if (typeof meta.license !== 'string' || !meta.license.trim() || meta.license.length > 80)
    throw new Error(`${directoryName}/market.json license 不合法`);
  if (meta.homepage !== undefined && !isHttpsUrl(meta.homepage))
    throw new Error(`${directoryName}/market.json homepage 必须是 https`);
  if (meta.screenshots !== undefined) {
    if (
      !Array.isArray(meta.screenshots) ||
      meta.screenshots.length > 6 ||
      meta.screenshots.some(
        (shot) =>
          !isRecord(shot) ||
          !isHttpsUrl(shot.url) ||
          typeof shot.alt !== 'string' ||
          shot.alt.length > 200
      )
    )
      throw new Error(`${directoryName}/market.json screenshots 不合法`);
  }
  if (meta.delisted !== undefined && typeof meta.delisted !== 'boolean')
    throw new Error(`${directoryName}/market.json delisted 必须是布尔值`);
  if (!isRecord(meta.versions)) throw new Error(`${directoryName}/market.json versions 必须是对象`);
  return meta;
}

function parseReadme(files, pluginId, version) {
  const readme = files.find((file) => file.path === 'README.md');
  const license = files.find((file) => file.path === 'LICENSE' || file.path === 'LICENSE.md');
  if (!readme) throw new Error(`${pluginId}@${version} 缺少包内 README.md`);
  if (readme.data.length > MAX_README_BYTES)
    throw new Error(`${pluginId}@${version} README 超过 256KB`);
  if (readme.data.length === 0) throw new Error(`${pluginId}@${version} README 为空`);
  if (!license) throw new Error(`${pluginId}@${version} 缺少 LICENSE 或 LICENSE.md`);
  if (license.data.length === 0) throw new Error(`${pluginId}@${version} LICENSE 为空`);
  return readme.data;
}

function validateThemeAssets(files, pluginId, version, manifest) {
  const themes = manifest.contributes?.themes ?? [];
  if (!Array.isArray(themes)) return;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const paletteKeys = [
    'canvas',
    'surface',
    'sunken',
    'border',
    'borderStrong',
    'text',
    'textMuted',
    'textSubtle',
    'accent',
  ];
  for (const theme of themes) {
    const file = byPath.get(theme.path);
    if (!file) throw new Error(`${pluginId}@${version} 主题文件不存在：${theme.path}`);
    let parsed;
    try {
      parsed = JSON.parse(file.data.toString('utf8'));
    } catch {
      throw new Error(`${pluginId}@${version} 主题不是合法 JSON：${theme.path}`);
    }
    for (const mode of ['light', 'dark']) {
      const palette = parsed?.[mode];
      if (!isRecord(palette))
        throw new Error(`${pluginId}@${version} 主题缺少 ${mode} 调色板`);
      for (const key of paletteKeys) {
        const value = palette[key];
        if (
          typeof value !== 'string' ||
          !value.trim() ||
          value.length > 100 ||
          /[;{}]/.test(value)
        )
          throw new Error(`${pluginId}@${version} 主题 ${mode}.${key} 不合法`);
      }
    }
    if (theme.css !== undefined && !byPath.has(theme.css))
      throw new Error(`${pluginId}@${version} 主题 CSS 不存在：${theme.css}`);
  }
}

/**
 * Read and validate plugin sources. This never executes plugin code, lifecycle
 * scripts or npm install.
 */
export function loadSourcePlugins(sourcesDir) {
  const plugins = [];
  const warnings = [];
  if (!existsSync(sourcesDir)) throw new Error(`插件源目录不存在：${sourcesDir}`);
  for (const name of readdirSync(sourcesDir).sort()) {
    if (name.startsWith('.')) continue;
    const pluginDir = join(sourcesDir, name);
    const info = lstatSync(pluginDir);
    if (info.isSymbolicLink()) throw new Error(`插件目录不能是符号链接：${name}`);
    if (!info.isDirectory()) continue;
    assertNoLinks(pluginDir, `${name} 插件目录`, { maxEntries: 100000, maxDepth: 100 });
    const meta = parseMarketMeta(pluginDir, name);
    const versionEntries = Object.entries(meta.versions);
    if (meta.delisted) {
      if (versionEntries.length > 0)
        warnings.push(`${meta.id} 已 delisted，新版源忽略；历史产物保留`);
      plugins.push({ id: meta.id, meta, delisted: true, versions: [] });
      continue;
    }
    if (versionEntries.length === 0) throw new Error(`${name} 没有发布版本`);
    const versionsDir = join(pluginDir, 'versions');
    if (!existsSync(versionsDir)) throw new Error(`${name} 缺少 versions/`);
    const sourceVersions = new Set();
    for (const entry of readdirSync(versionsDir)) {
      if (entry.startsWith('.')) continue;
      if (!isReleaseVersion(entry)) throw new Error(`${name}/versions 含非法版本目录：${entry}`);
      sourceVersions.add(entry);
    }
    const versions = [];
    let previous = null;
    for (const version of Object.keys(meta.versions).sort(compareVersions)) {
      if (!isReleaseVersion(version)) throw new Error(`${name} market.json 版本号不合法：${version}`);
      if (previous && compareVersions(previous, version) >= 0)
        throw new Error(`${name} 版本号必须严格递增`);
      previous = version;
      const entry = meta.versions[version];
      if (!isRecord(entry) || Object.keys(entry).some((key) => key !== 'compatibility'))
        throw new Error(`${name}@${version} market.json 版本条目含未知字段`);
      const compatibility = validateCompatibility(entry.compatibility);
      if (!compatibility.ok)
        throw new Error(`${name}@${version} compatibility 不合法：${compatibility.errors.join('; ')}`);
      const packageDir = join(versionsDir, version);
      if (!existsSync(packageDir)) throw new Error(`${name}@${version} 缺少版本目录`);
      if (!sourceVersions.delete(version)) throw new Error(`${name}@${version} 目录重复`);
      const manifest = parseManifest(meta.id, version, packageDir);
      const files = collectPackageFiles(packageDir);
      for (const key of ['main', 'renderer', 'icon']) {
        if (manifest[key] !== undefined && !files.some((file) => file.path === manifest[key]))
          throw new Error(`${meta.id}@${version} 清单 ${key} 指向的文件不存在`);
      }
      validateThemeAssets(files, meta.id, version, manifest);
      const readmeBytes = parseReadme(files, meta.id, version);
      const zip = createZip(files);
      versions.push({
        version,
        path: `packages/${meta.id}/${version}.zip`,
        compatibility: compatibility.value,
        permissions: [...manifest.permissions],
        files,
        readmeBytes,
        zip,
        sha256: sha256(zip),
        size: zip.length,
      });
    }
    if (sourceVersions.size > 0)
      throw new Error(`${name} 存在未在 market.json 声明的版本目录：${[...sourceVersions].join(', ')}`);
    const candidate = {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      tier: meta.tier,
      category: meta.category,
      tags: meta.tags,
      license: meta.license,
      ...(meta.homepage !== undefined ? { homepage: meta.homepage } : {}),
      ...(meta.screenshots !== undefined ? { screenshots: meta.screenshots } : {}),
      versions: versions.map((version) => ({
        version: version.version,
        permissions: version.permissions,
        path: `packages/${meta.id}/${version.version}.zip`,
        sha256: version.sha256,
        size: version.size,
        compatibility: version.compatibility,
      })),
    };
    const validated = validateMarketPlugin(candidate);
    if (!validated.ok)
      throw new Error(`${name} 市场条目不合法：${validated.errors.join('; ')}`);
    plugins.push({ id: meta.id, meta, delisted: false, versions });
  }
  return { plugins, warnings };
}
