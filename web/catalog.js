/** Static catalog renderer. All index data is untrusted until verified. */

export const MARKET_PUBLIC_KEY_SPKI_B64 =
  'MCowBQYDK2VwAyEA8d7tATk4T2mJ2vbSdVPNHIxClIctNMUwIsqboL5BRUQ=';

const CATEGORY_LABELS = {
  themes: '主题外观',
  agent: 'Agent 能力',
  productivity: '效率工作流',
  integrations: '外部集成',
  insights: '观测统计',
  writing: '写作翻译',
  fun: '休闲娱乐',
};
const TIER_LABELS = { official: '官方精选', community: '社区收录' };
const PLATFORM_LABELS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const SURFACE_LABELS = {
  code: 'Code 对话',
  bot: 'Bot',
  'image-studio': '图像工作室',
  taskboard: '任务看板',
  design: '设计',
  settings: '设置',
};
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const RELEASE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CATEGORIES = Object.keys(CATEGORY_LABELS);
const PLATFORMS = Object.keys(PLATFORM_LABELS);
const SURFACES = Object.keys(SURFACE_LABELS);

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value, max = 1000) =>
  typeof value === 'string' && value.length <= max ? value : null;

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 256) return false;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(value) || /[\u0000-\u001f\u007f<>:"|?*#]/.test(value)) return false;
  return value.split('/').every(
    (segment) =>
      segment &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.endsWith('.') &&
      !segment.endsWith(' ')
  );
}

export function safeHref(path) {
  if (!isSafeRelativePath(path)) return null;
  if (path.startsWith('/') || path.includes('//')) return null;
  // Index paths are relative to v1/; the catalog page lives at the site root.
  return `./v1/${path}`;
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function formatBytes(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortSha(value) {
  return typeof value === 'string' && value.length === 64 ? `${value.slice(0, 12)}…` : '—';
}

function parseCompatibility(raw) {
  if (!isRecord(raw) || raw.host !== 'collabra' || raw.apiVersion !== 1) return null;
  if (typeof raw.minAppVersion !== 'string' || !RELEASE_VERSION.test(raw.minAppVersion))
    return null;
  if (raw.maxAppVersion !== undefined) {
    if (
      typeof raw.maxAppVersion !== 'string' ||
      !RELEASE_VERSION.test(raw.maxAppVersion) ||
      compareVersions(raw.maxAppVersion, raw.minAppVersion) < 0
    )
      return null;
  }
  if (
    !Array.isArray(raw.platforms) ||
    raw.platforms.length === 0 ||
    raw.platforms.some((platform) => !PLATFORMS.includes(platform))
  )
    return null;
  if (
    !Array.isArray(raw.testedSurfaces) ||
    raw.testedSurfaces.some((surface) => !SURFACES.includes(surface))
  )
    return null;
  return {
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: raw.minAppVersion,
    ...(raw.maxAppVersion !== undefined ? { maxAppVersion: raw.maxAppVersion } : {}),
    platforms: [...raw.platforms],
    testedSurfaces: [...raw.testedSurfaces],
  };
}

export function parseCatalog(raw) {
  if (!isRecord(raw) || raw.schemaVersion !== 2 || raw.marketId !== 'collabra')
    throw new Error('不支持的索引协议');
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0)
    throw new Error('索引 sequence 不合法');
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt)))
    throw new Error('索引 generatedAt 不合法');
  if (!Array.isArray(raw.plugins)) throw new Error('索引 plugins 不合法');
  const seen = new Set();
  const plugins = [];
  for (const item of raw.plugins) {
    if (!isRecord(item) || !PLUGIN_ID.test(item.id) || seen.has(item.id))
      throw new Error('索引含非法或重复插件 id');
    seen.add(item.id);
    const name = text(item.name, 60);
    const description = text(item.description, 1000);
    const license = text(item.license, 80);
    if (!name || !license || !Object.hasOwn(TIER_LABELS, item.tier))
      throw new Error(`插件 ${item.id} 展示字段不合法`);
    if (!CATEGORIES.includes(item.category)) throw new Error(`插件 ${item.id} 分类不合法`);
    if (
      !Array.isArray(item.tags) ||
      item.tags.length > 32 ||
      item.tags.some((tag) => typeof tag !== 'string' || tag.length > 32)
    )
      throw new Error(`插件 ${item.id} 标签不合法`);
    if (!Array.isArray(item.versions) || item.versions.length === 0)
      throw new Error(`插件 ${item.id} 没有版本`);
    const versions = item.versions.map((version) => {
      if (
        !isRecord(version) ||
        typeof version.version !== 'string' ||
        !RELEASE_VERSION.test(version.version) ||
        version.path !== `packages/${item.id}/${version.version}.zip` ||
        !isSafeRelativePath(version.path) ||
        typeof version.sha256 !== 'string' ||
        !SHA256.test(version.sha256) ||
        !Number.isSafeInteger(version.size) ||
        version.size <= 0 ||
        !Array.isArray(version.permissions) ||
        version.permissions.length > 64 ||
        version.permissions.some((permission) => typeof permission !== 'string')
      )
        throw new Error(`插件 ${item.id} 版本条目不合法`);
      const compatibility = parseCompatibility(version.compatibility);
      if (!compatibility) throw new Error(`插件 ${item.id} 兼容性不合法`);
      return {
        version: version.version,
        path: version.path,
        sha256: version.sha256,
        size: version.size,
        permissions: [...version.permissions],
        compatibility,
      };
    });
    versions.sort((a, b) => compareVersions(a.version, b.version));
    for (let i = 1; i < versions.length; i++) {
      if (compareVersions(versions[i - 1].version, versions[i].version) >= 0)
        throw new Error(`插件 ${item.id} 版本顺序不合法`);
    }
    let readme = null;
    if (item.readme !== undefined) {
      const latest = versions.at(-1).version;
      if (
        !isRecord(item.readme) ||
        item.readme.path !== `readmes/${item.id}/${latest}.md` ||
        !isSafeRelativePath(item.readme.path) ||
        typeof item.readme.sha256 !== 'string' ||
        !SHA256.test(item.readme.sha256) ||
        !Number.isSafeInteger(item.readme.size) ||
        item.readme.size <= 0
      )
        throw new Error(`插件 ${item.id} README 不合法`);
      readme = { ...item.readme };
    }
    plugins.push({
      id: item.id,
      name,
      description: description ?? '',
      tier: item.tier,
      category: item.category,
      tags: [...item.tags],
      license,
      ...(text(item.homepage, 500)?.startsWith('https://')
        ? { homepage: item.homepage }
        : {}),
      versions,
      readme,
      latest: versions.at(-1),
    });
  }
  plugins.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    schemaVersion: 2,
    marketId: 'collabra',
    sequence: raw.sequence,
    generatedAt: raw.generatedAt,
    plugins,
  };
}

export function matchesQuery(plugin, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [plugin.id, plugin.name, plugin.description, plugin.license, plugin.category, ...plugin.tags]
    .join('\n')
    .toLowerCase()
    .includes(needle);
}

export function filterPlugins(plugins, { query = '', category = 'all' } = {}) {
  return plugins.filter(
    (plugin) =>
      (category === 'all' || plugin.category === category) && matchesQuery(plugin, query)
  );
}

function element(doc, tag, className, textContent) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function appendLink(doc, parent, { href, label, className, download }) {
  const safe = safeHref(href);
  if (!safe) return null;
  const link = element(doc, 'a', className, label);
  link.setAttribute('href', safe);
  if (download) link.setAttribute('download', download);
  parent.append(link);
  return link;
}

function compatibilityLine(compatibility) {
  const parts = [`Collabra API ${compatibility.apiVersion}`, `App ≥ ${compatibility.minAppVersion}`];
  if (compatibility.maxAppVersion) parts.push(`App ≤ ${compatibility.maxAppVersion}`);
  parts.push(compatibility.platforms.map((platform) => PLATFORM_LABELS[platform]).join(' / '));
  return parts.join(' · ');
}

function testedLine(compatibility) {
  if (compatibility.testedSurfaces.length === 0)
    return '界面级测试：未声明（不把调色板支持算作界面验收）';
  return `界面级测试：${compatibility.testedSurfaces
    .map((surface) => SURFACE_LABELS[surface])
    .join('、')}`;
}

export function renderPluginCard(doc, plugin) {
  const card = element(doc, 'article', 'plugin-card');
  const top = element(doc, 'div', 'card-top');
  top.append(
    element(doc, 'span', `tier tier-${plugin.tier}`, TIER_LABELS[plugin.tier]),
    element(doc, 'span', 'category', CATEGORY_LABELS[plugin.category])
  );
  card.append(top);
  card.append(element(doc, 'h3', 'plugin-title', plugin.name));
  card.append(element(doc, 'p', 'plugin-description', plugin.description));

  const tags = element(doc, 'ul', 'tag-list');
  for (const tag of plugin.tags) tags.append(element(doc, 'li', 'tag', tag));
  card.append(tags);

  const latest = plugin.latest;
  const facts = element(doc, 'dl', 'facts');
  const fact = (label, value) => {
    const row = element(doc, 'div', 'fact');
    row.append(element(doc, 'dt', null, label), element(doc, 'dd', null, value));
    facts.append(row);
  };
  fact('最新版本', latest.version);
  fact('许可证', plugin.license);
  fact('包大小', formatBytes(latest.size));
  fact('权限', latest.permissions.length === 0 ? '无' : latest.permissions.join('、'));
  card.append(facts);
  card.append(element(doc, 'p', 'compatibility', compatibilityLine(latest.compatibility)));
  card.append(element(doc, 'p', 'surfaces', testedLine(latest.compatibility)));

  const actions = element(doc, 'div', 'card-actions');
  appendLink(doc, actions, {
    href: latest.path,
    label: `下载 ${latest.version} ZIP`,
    className: 'button primary',
    download: `${plugin.id}-${latest.version}.zip`,
  });
  if (plugin.readme) {
    appendLink(doc, actions, {
      href: plugin.readme.path,
      label: `README（${latest.version}）`,
      className: 'button ghost',
    });
  }
  card.append(actions);

  const details = element(doc, 'details', 'versions');
  details.append(element(doc, 'summary', null, '版本与校验值'));
  const list = element(doc, 'ul', 'version-list');
  for (const version of [...plugin.versions].reverse()) {
    const item = element(doc, 'li', 'version-row');
    const heading = element(doc, 'div', 'version-head');
    heading.append(element(doc, 'strong', null, version.version));
    heading.append(element(doc, 'span', null, formatBytes(version.size)));
    item.append(heading);
    item.append(element(doc, 'p', 'version-compat', compatibilityLine(version.compatibility)));
    item.append(element(doc, 'p', 'version-compat', testedLine(version.compatibility)));
    if (version.version !== latest.version) {
      const versionReadme = `readmes/${plugin.id}/${version.version}.md`;
      const links = element(doc, 'div', 'version-links');
      appendLink(doc, links, {
        href: version.path,
        label: 'ZIP',
        className: 'text-link',
        download: `${plugin.id}-${version.version}.zip`,
      });
      appendLink(doc, links, {
        href: versionReadme,
        label: '该版本 README',
        className: 'text-link',
      });
      item.append(links);
    }
    const hash = element(doc, 'code', 'sha', version.sha256);
    hash.setAttribute('title', version.sha256);
    item.append(element(doc, 'span', 'sha-label', 'SHA-256'), hash);
    list.append(item);
  }
  details.append(list);
  card.append(details);
  return card;
}

export function renderCatalog(doc, root, index, options = {}) {
  const filtered = filterPlugins(index.plugins, options);
  root.replaceChildren();
  if (filtered.length === 0) {
    root.append(element(doc, 'p', 'empty', '没有符合筛选条件的插件。'));
    return 0;
  }
  for (const plugin of filtered) root.append(renderPluginCard(doc, plugin));
  return filtered.length;
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim()))
    return null;
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyIndexBytes(
  bytes,
  signatureText,
  {
    subtle = globalThis.crypto?.subtle,
    publicKeyB64 = MARKET_PUBLIC_KEY_SPKI_B64,
  } = {}
) {
  if (!subtle) return { ok: true, verified: false, unsupported: true };
  const signature = base64ToBytes(signatureText);
  const keyBytes = base64ToBytes(publicKeyB64);
  if (!signature || !keyBytes) return { ok: false, verified: false, reason: '签名或公钥格式错误' };
  try {
    const key = await subtle.importKey('spki', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'Ed25519' }, key, signature, bytes);
    return ok
      ? { ok: true, verified: true }
      : { ok: false, verified: false, reason: '索引签名校验失败' };
  } catch {
    return { ok: true, verified: false, unsupported: true };
  }
}

export async function fetchCatalog({
  fetchImpl = globalThis.fetch,
  baseUrl = globalThis.document?.baseURI ?? 'http://localhost/',
  subtle,
  publicKeyB64,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('浏览器不支持 fetch');
  const indexUrl = new URL('./v1/index.json', baseUrl);
  const signatureUrl = new URL('./v1/index.json.sig', baseUrl);
  const [indexResponse, signatureResponse] = await Promise.all([
    fetchImpl(indexUrl, { cache: 'no-cache' }),
    fetchImpl(signatureUrl, { cache: 'no-cache' }),
  ]);
  if (!indexResponse.ok || !signatureResponse.ok) throw new Error('市场索引暂时不可用');
  const bytes = new Uint8Array(await indexResponse.arrayBuffer());
  const signatureText = await signatureResponse.text();
  const verification = await verifyIndexBytes(bytes, signatureText, {
    subtle,
    ...(publicKeyB64 ? { publicKeyB64 } : {}),
  });
  if (!verification.ok) throw new Error(verification.reason ?? '索引签名无效');
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('市场索引不是合法 JSON');
  }
  return { index: parseCatalog(parsed), verification };
}

function setState(document, selector, value, tone) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = value;
  if (tone) node.dataset.tone = tone;
}

export async function initCatalog() {
  if (typeof document === 'undefined') return;
  const grid = document.querySelector('[data-catalog-grid]');
  if (!grid) return;
  const search = document.querySelector('[data-catalog-search]');
  const category = document.querySelector('[data-catalog-category]');
  const count = document.querySelector('[data-catalog-count]');
  const status = document.querySelector('[data-catalog-status]');
  const state = { index: null, query: '', category: 'all' };
  try {
    setState(document, '[data-catalog-status]', '正在获取并验证签名索引…');
    const { index, verification } = await fetchCatalog();
    state.index = index;
    setState(document, '[data-market-sequence]', String(index.sequence));
    setState(
      document,
      '[data-market-generated]',
      new Date(index.generatedAt).toLocaleString('zh-CN')
    );
    if (verification.verified)
      setState(document, '[data-signature-state]', '索引签名已验证（Ed25519）', 'ok');
    else
      setState(
        document,
        '[data-signature-state]',
        '当前浏览器无法在线验签；Collabra 客户端仍会校验签名',
        'warn'
      );
    const redraw = () => {
      const shown = renderCatalog(document, grid, index, {
        query: state.query,
        category: state.category,
      });
      if (count) count.textContent = `当前显示 ${shown} 个插件`;
    };
    if (search)
      search.addEventListener('input', () => {
        state.query = search.value;
        redraw();
      });
    if (category)
      category.addEventListener('change', () => {
        state.category = category.value;
        redraw();
      });
    redraw();
    if (status) status.hidden = true;
  } catch (error) {
    setState(document, '[data-catalog-status]', `目录加载失败：${error.message}`, 'error');
    if (count) count.textContent = '';
    setState(document, '[data-signature-state]', '未验证', 'error');
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => void initCatalog());
  else void initCatalog();
}
