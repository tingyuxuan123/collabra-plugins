import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_INDEX_BYTES,
  MAX_HISTORY_DEPTH,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_GENERATIONS,
  MAX_README_BYTES,
  MARKET_ID,
  SCHEMA_VERSION,
  historyLedgerPath,
  historyLedgerSignaturePath,
  historySnapshotPath,
  historySnapshotSignaturePath,
  packagePath,
  readmePath,
} from './constants.mjs';
import {
  assertPinnedKey,
  privateKeyMatchesPublic,
  signBytes,
  verifyBytes,
} from './crypto.mjs';
import {
  assertNoLinks,
  copyTree,
  inside,
  prepareOutputDir,
  sha256,
  sha256File,
  writeFile,
} from './fs.mjs';
import {
  loadHistory,
  verifyLedgerArtifacts,
  verifyNoUnledgeredArtifacts,
} from './history.mjs';
import { compareVersions, isNewerVersion } from './ids.mjs';
import { artifactKey, buildLedger } from './ledger.mjs';
import { parseMarketIndex, stableJson, validateMarketPlugin } from './schema.mjs';
import { loadSourcePlugins } from './source.mjs';

const WEBSITE_FILES = ['index.html', 'site.css', 'catalog.js'];

const sameVersion = (left, right) =>
  JSON.stringify({
    version: left.version,
    permissions: left.permissions,
    path: left.path,
    sha256: left.sha256,
    size: left.size,
    compatibility: left.compatibility,
  }) ===
  JSON.stringify({
    version: right.version,
    permissions: right.permissions,
    path: right.path,
    sha256: right.sha256,
    size: right.size,
    compatibility: right.compatibility,
  });

const toVersionEntry = (artifact) => ({
  version: artifact.version,
  permissions: [...artifact.permissions],
  path: artifact.path,
  sha256: artifact.sha256,
  size: artifact.size,
  compatibility: artifact.compatibility,
});

function assertHistoricalVersionUnchanged(source, historical, pluginId) {
  if (source.sha256 !== historical.sha256 || source.size !== historical.size)
    throw new Error(
      `${pluginId}@${source.version} 已发布包内容被修改；同版本必须保持字节不变，请发布新版本`
    );
  if (source.path !== historical.path)
    throw new Error(`${pluginId}@${source.version} 包路径被修改`);
  if (!sameVersion(source, historical))
    throw new Error(
      `${pluginId}@${source.version} 已发布 compatibility/permissions 被修改；请发布新版本`
    );
}

function assertReadmeMatches(file, bytes, label) {
  if (!existsSync(file)) return false;
  if (statSync(file).size !== bytes.length || sha256File(file) !== sha256(bytes))
    throw new Error(`${label} 的 README 已发布内容被修改；请发布新版本`);
  return true;
}

function buildPluginEntry(plugin, outputV1, historicalPlugin, ledgerArtifacts) {
  const historicalVersions = new Map(
    (historicalPlugin?.versions ?? []).map((version) => [version.version, version])
  );
  const sourceVersions = new Map(plugin.versions.map((version) => [version.version, version]));
  const ledgerForPlugin = [...ledgerArtifacts.values()]
    .filter((artifact) => artifact.pluginId === plugin.id)
    .sort((left, right) => compareVersions(left.version, right.version));
  const ledgerVersions = new Map(
    ledgerForPlugin.map((artifact) => [artifact.version, artifact])
  );
  const maxHistorical = ledgerForPlugin.at(-1)?.version;
  const versions = [];
  for (const source of plugin.versions) {
    const readmeFile = join(outputV1, readmePath(plugin.id, source.version));
    const historical = ledgerVersions.get(source.version);
    if (historical) {
      if (
        historical.readme.path !== readmePath(plugin.id, source.version) ||
        historical.readme.sha256 !== sha256(source.readmeBytes) ||
        historical.readme.size !== source.readmeBytes.length
      )
        throw new Error(`${plugin.id}@${source.version} 的 README 已发布内容被修改`);
      if (!assertReadmeMatches(readmeFile, source.readmeBytes, `${plugin.id}@${source.version}`))
        writeFile(readmeFile, source.readmeBytes);
      assertHistoricalVersionUnchanged(source, historical, plugin.id);
      versions.push(toVersionEntry(historical));
      continue;
    }
    if (!assertReadmeMatches(readmeFile, source.readmeBytes, `${plugin.id}@${source.version}`))
      writeFile(readmeFile, source.readmeBytes);
    if (maxHistorical && !isNewerVersion(source.version, maxHistorical))
      throw new Error(
        `${plugin.id}@${source.version} 不是高于历史最新版本 ${maxHistorical} 的新版本`
      );
    const packageFile = join(outputV1, packagePath(plugin.id, source.version));
    if (existsSync(packageFile)) {
      if (sha256File(packageFile) !== source.sha256)
        throw new Error(`${plugin.id}@${source.version} 目标包已存在且内容不同`);
    } else {
      writeFile(packageFile, source.zip);
    }
    versions.push({
      version: source.version,
      permissions: [...source.permissions],
      path: packagePath(plugin.id, source.version),
      sha256: source.sha256,
      size: source.size,
      compatibility: source.compatibility,
    });
  }
  for (const [version, historical] of historicalVersions) {
    if (!sourceVersions.has(version)) versions.push(historical);
  }
  versions.sort((a, b) => compareVersions(a.version, b.version));
  if (versions.length === 0) throw new Error(`${plugin.id} 没有可用版本`);
  const latest = versions.at(-1);
  const readmeRel = readmePath(plugin.id, latest.version);
  const readmeFile = join(outputV1, readmeRel);
  if (!existsSync(readmeFile))
    throw new Error(`${plugin.id} 缺少 ${latest.version} 的 README：${readmeRel}`);
  const readmeBytes = readFileSync(readmeFile);
  if (readmeBytes.length > MAX_README_BYTES) throw new Error(`${plugin.id} README 超过 256KB`);
  const meta = plugin.meta;
  return {
    id: plugin.id,
    name: meta.name,
    description: meta.description,
    tier: meta.tier,
    category: meta.category,
    tags: [...meta.tags],
    license: meta.license,
    ...(meta.homepage !== undefined ? { homepage: meta.homepage } : {}),
    ...(meta.screenshots !== undefined
      ? { screenshots: meta.screenshots.map((shot) => ({ url: shot.url, alt: shot.alt })) }
      : {}),
    versions,
    readme: {
      path: readmeRel,
      sha256: sha256(readmeBytes),
      size: readmeBytes.length,
    },
  };
}

function verifyIndexArtifacts(v1, index) {
  for (const plugin of index.plugins) {
    for (const version of plugin.versions) {
      const path = join(v1, version.path);
      if (!existsSync(path)) throw new Error(`索引引用的包不存在：${version.path}`);
      if (statSync(path).size !== version.size)
        throw new Error(`索引包大小不匹配：${version.path}`);
      if (sha256File(path) !== version.sha256)
        throw new Error(`索引包哈希不匹配：${version.path}`);
    }
    if (plugin.readme) {
      const path = join(v1, plugin.readme.path);
      if (!existsSync(path)) throw new Error(`索引引用的 README 不存在：${plugin.readme.path}`);
      if (statSync(path).size !== plugin.readme.size)
        throw new Error(`README 大小不匹配：${plugin.readme.path}`);
      if (sha256File(path) !== plugin.readme.sha256)
        throw new Error(`README 哈希不匹配：${plugin.readme.path}`);
    }
  }
}

/**
 * Build a new unsigned generation from sources merged onto verified history.
 * The output is never trusted until signMarket() signs the exact index bytes.
 */
export function buildMarket({
  sourcesDir,
  historyDir,
  outDir,
  webDir,
  now = new Date().toISOString(),
  publicKeyPem,
  allowTestKey = false,
  includeWeb = true,
}) {
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now)))
    throw new Error('generatedAt 不是合法时间');
  for (const [label, protectedDir] of [
    ['插件源', sourcesDir],
    ['历史 dist', historyDir],
    ['站点源', webDir],
  ]) {
    if (!protectedDir) continue;
    if (
      resolve(outDir) === resolve(protectedDir) ||
      inside(outDir, protectedDir) ||
      inside(protectedDir, outDir)
    )
      throw new Error(`输出目录不能与${label}重叠：${protectedDir}`);
  }
  const history = loadHistory(historyDir, { publicKeyPem, allowTestKey });
  const output = prepareOutputDir(outDir);
  const outputV1 = join(output, 'v1');
  if (history.root) {
    copyTree(history.root, outputV1, {
      maxEntries: MAX_HISTORY_ENTRIES,
      maxDepth: MAX_HISTORY_DEPTH,
    });
    verifyLedgerArtifacts(outputV1, history.ledger);
  }
  // A signature from the previous generation must never sit next to the new
  // unsigned index. Only signMarket() may write a signature.
  const staleSignature = join(outputV1, 'index.json.sig');
  if (existsSync(staleSignature)) rmSync(staleSignature);

  const { plugins: sourcePlugins, warnings } = loadSourcePlugins(sourcesDir);
  const historyPlugins = new Map(history.index.plugins.map((plugin) => [plugin.id, plugin]));
  const result = new Map(historyPlugins);
  for (const plugin of sourcePlugins) {
    if (plugin.delisted) {
      result.delete(plugin.id);
      continue;
    }
    const entry = buildPluginEntry(
      plugin,
      outputV1,
      historyPlugins.get(plugin.id),
      history.artifacts
    );
    const validated = validateMarketPlugin(entry);
    if (!validated.ok)
      throw new Error(`${plugin.id} 索引条目不合法：${validated.errors.join('; ')}`);
    result.set(plugin.id, entry);
  }
  const plugins = [...result.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sequence = history.index.sequence + 1;
  if (!Number.isSafeInteger(sequence) || sequence > MAX_HISTORY_GENERATIONS)
    throw new Error('sequence 超出安全整数范围');
  const index = {
    schemaVersion: SCHEMA_VERSION,
    marketId: MARKET_ID,
    sequence,
    generatedAt: now,
    plugins,
  };
  const validated = parseMarketIndex(index);
  if (!validated.ok) throw new Error(`生成的索引不合法：${validated.errors.join('; ')}`);
  verifyIndexArtifacts(outputV1, validated.value);

  writeFileSync(join(outputV1, 'index.json'), stableJson(validated.value));
  if (includeWeb) {
    if (
      !webDir ||
      !existsSync(webDir) ||
      !statSync(webDir).isDirectory()
    )
      throw new Error('站点目录不存在');
    for (const file of WEBSITE_FILES) {
      if (!existsSync(join(webDir, file))) throw new Error(`站点缺少 ${file}`);
    }
    for (const reserved of ['v1', 'packages', 'readmes', 'index.json']) {
      if (existsSync(join(webDir, reserved)))
        throw new Error(`站点目录不能包含保留路径：${reserved}`);
    }
    assertNoLinks(webDir, '站点目录');
    copyTree(webDir, output);
  }
  return { index: validated.value, output, warnings };
}

function writeConsistent(path, bytes, label) {
  const data = Buffer.from(bytes);
  if (existsSync(path)) {
    if (!readFileSync(path).equals(data))
      throw new Error(`${label} 已存在且内容不同，拒绝覆盖`);
    return;
  }
  writeFile(path, data);
}

function artifactForVersion(v1, plugin, version) {
  const readmeRel = readmePath(plugin.id, version.version);
  const readmeFile = join(v1, readmeRel);
  if (!existsSync(readmeFile)) throw new Error(`缺少版本 README：${readmeRel}`);
  const size = statSync(readmeFile).size;
  if (size <= 0 || size > MAX_README_BYTES)
    throw new Error(`版本 README 大小不合法：${readmeRel}`);
  return {
    pluginId: plugin.id,
    version: version.version,
    path: version.path,
    sha256: version.sha256,
    size: version.size,
    permissions: [...version.permissions],
    compatibility: version.compatibility,
    readme: {
      path: readmeRel,
      sha256: sha256File(readmeFile),
      size,
    },
  };
}

function assertIndexRespectsLedger(index, history) {
  const ledgerMax = new Map();
  for (const artifact of history.artifacts.values()) {
    const current = ledgerMax.get(artifact.pluginId);
    if (!current || isNewerVersion(artifact.version, current))
      ledgerMax.set(artifact.pluginId, artifact.version);
  }
  const historyMap = new Map(history.index.plugins.map((plugin) => [plugin.id, plugin]));
  const nextMap = new Map(index.plugins.map((plugin) => [plugin.id, plugin]));
  for (const [id, historical] of historyMap) {
    const next = nextMap.get(id);
    if (!next) continue;
    const nextVersions = new Map(next.versions.map((version) => [version.version, version]));
    for (const version of historical.versions) {
      const candidate = nextVersions.get(version.version);
      const artifact = history.artifacts.get(artifactKey(id, version.version));
      if (!candidate)
        throw new Error(`${id}@${version.version} 从索引消失；请使用 delisted`);
      if (!artifact || !sameVersion(candidate, artifact))
        throw new Error(`${id}@${version.version} 历史版本字段被篡改，拒绝签名`);
    }
  }
  for (const plugin of index.plugins) {
    const max = ledgerMax.get(plugin.id);
    for (const version of plugin.versions) {
      const artifact = history.artifacts.get(artifactKey(plugin.id, version.version));
      if (artifact) {
        if (!sameVersion(version, artifact))
          throw new Error(`${plugin.id}@${version.version} 与 signed ledger 不一致`);
      } else if (max && !isNewerVersion(version.version, max)) {
        throw new Error(`${plugin.id}@${version.version} 未高于历史最新版本，拒绝签名`);
      }
    }
    if (plugin.readme) {
      const latest = plugin.versions.at(-1);
      const artifact = history.artifacts.get(artifactKey(plugin.id, latest.version));
      if (
        artifact &&
        (artifact.readme.path !== plugin.readme.path ||
          artifact.readme.sha256 !== plugin.readme.sha256 ||
          artifact.readme.size !== plugin.readme.size)
      )
        throw new Error(`${plugin.id} 的 README 与 signed ledger 不一致`);
    }
  }
}

/**
 * Sign one generation after re-verifying the pinned history. This second check
 * prevents a tampered build from laundering old-version changes through a new
 * signature.
 */
export function signMarket({
  outDir,
  historyDir,
  privateKeyPem,
  publicKeyPem,
  allowTestKey = false,
}) {
  const fingerprint = assertPinnedKey(publicKeyPem, { allowTestKey });
  if (!privateKeyPem || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKeyPem))
    throw new Error('缺少合法的 Ed25519 私钥');
  if (!privateKeyMatchesPublic(privateKeyPem, publicKeyPem))
    throw new Error('私钥与仓库内置公钥不匹配，拒绝签名');
  if (
    historyDir &&
    (resolve(outDir) === resolve(historyDir) ||
      inside(outDir, historyDir) ||
      inside(historyDir, outDir))
  )
    throw new Error('签名输出目录不能与历史目录重叠');
  const history = loadHistory(historyDir, { publicKeyPem, allowTestKey });
  const v1 = join(outDir, 'v1');
  const indexPath = join(v1, 'index.json');
  if (!existsSync(indexPath)) throw new Error('缺少待签名 index.json');
  const raw = readFileSync(indexPath);
  if (raw.length > MAX_INDEX_BYTES) throw new Error('索引超过大小上限');
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('待签名索引不是合法 JSON');
  }
  const validated = parseMarketIndex(parsed);
  if (!validated.ok) throw new Error(`待签名索引结构无效：${validated.errors.join('; ')}`);
  const index = validated.value;
  if (raw.toString('utf8') !== stableJson(index))
    throw new Error('待签名索引不是规范序列化，拒绝签名');
  if (index.sequence !== history.index.sequence + 1)
    throw new Error(
      `sequence 必须为历史值 +1（历史 ${history.index.sequence}，实际 ${index.sequence}）`
    );

  verifyIndexArtifacts(v1, index);
  verifyLedgerArtifacts(v1, history.ledger);
  assertIndexRespectsLedger(index, history);

  const nextArtifacts = new Map(history.artifacts);
  for (const plugin of index.plugins) {
    for (const version of plugin.versions) {
      const key = artifactKey(plugin.id, version.version);
      if (nextArtifacts.has(key)) continue;
      nextArtifacts.set(key, artifactForVersion(v1, plugin, version));
    }
  }
  const nextLedger = buildLedger(index.sequence, [...nextArtifacts.values()]);
  verifyLedgerArtifacts(v1, nextLedger);
  verifyNoUnledgeredArtifacts(v1, nextLedger);

  const signature = signBytes(raw, privateKeyPem);
  if (!verifyBytes(raw, signature, publicKeyPem))
    throw new Error('签名后自校验失败');
  const ledgerBytes = Buffer.from(stableJson(nextLedger));
  const ledgerSignature = signBytes(ledgerBytes, privateKeyPem);
  if (!verifyBytes(ledgerBytes, ledgerSignature, publicKeyPem))
    throw new Error('ledger 签名后自校验失败');
  const sequence = index.sequence;
  writeConsistent(join(v1, 'index.json.sig'), `${signature}\n`, 'index.json.sig');
  writeConsistent(join(v1, historySnapshotPath(sequence)), raw, `history/${sequence}.json`);
  writeConsistent(
    join(v1, historySnapshotSignaturePath(sequence)),
    `${signature}\n`,
    `history/${sequence}.json.sig`
  );
  writeConsistent(
    join(v1, historyLedgerPath(sequence)),
    ledgerBytes,
    `history/${sequence}.ledger.json`
  );
  writeConsistent(
    join(v1, historyLedgerSignaturePath(sequence)),
    `${ledgerSignature}\n`,
    `history/${sequence}.ledger.json.sig`
  );
  // Final boundary: re-read the complete output as a dist root. This also
  // catches a tampered copy of older snapshots or unledgered files.
  loadHistory(outDir, { publicKeyPem, allowTestKey });
  return {
    sequence,
    fingerprint,
    indexSha256: sha256(raw),
    signature,
    ledgerSha256: sha256(ledgerBytes),
  };
}
