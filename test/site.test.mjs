import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  MARKET_PUBLIC_KEY_SPKI_B64,
  fetchCatalog,
  filterPlugins,
  formatBytes,
  parseCatalog,
  renderCatalog,
  renderPluginCard,
  safeHref,
  verifyIndexBytes,
} from '../web/catalog.js';
import { publicKeySpkiBase64 } from '../scripts/lib/crypto.mjs';
import { repoRoot } from './helpers.mjs';

const compatibility = {
  host: 'collabra',
  apiVersion: 1,
  minAppVersion: '0.2.80',
  platforms: ['darwin', 'win32', 'linux'],
  testedSurfaces: [],
};
const sha = 'b'.repeat(64);
const plugin = {
  id: 'collabra.paper',
  name: 'Collabra Paper',
  description: 'Neutral palette',
  tier: 'official',
  category: 'themes',
  tags: ['theme'],
  license: 'MIT',
  versions: [
    {
      version: '1.0.0',
      permissions: [],
      path: 'packages/collabra.paper/1.0.0.zip',
      sha256: sha,
      size: 1234,
      compatibility,
    },
  ],
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

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.dataset = {};
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent ?? '').join('');
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceWith(node) {
    const siblings = this.parent?.children ?? [];
    const at = siblings.indexOf(this);
    if (at < 0) return;
    node.parent = this.parent;
    siblings[at] = node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  addEventListener(name, listener) {
    this.listeners = this.listeners ?? {};
    this.listeners[name] = listener;
  }
}

function fakeDocument() {
  return { createElement: (tag) => new FakeNode(tag) };
}

function allNodes(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) allNodes(child, out);
  return out;
}

test('站点公钥与生产 pin 一致', () => {
  const pem = readFileSync(join(repoRoot, 'market-public-key.pem'), 'utf8');
  assert.equal(publicKeySpkiBase64(pem), MARKET_PUBLIC_KEY_SPKI_B64);
});

test('目录解析拒绝错误协议和越界路径', () => {
  const parsed = parseCatalog(index);
  assert.equal(parsed.plugins[0].latest.version, '1.0.0');
  assert.equal(parsed.plugins[0].latest.compatibility.testedSurfaces.length, 0);
  for (const candidate of [
    { ...index, schemaVersion: 1 },
    { ...index, marketId: 'enso' },
    { ...index, sequence: -1 },
    { ...index, generatedAt: 'nope' },
    {
      ...index,
      plugins: [{ ...plugin, versions: [{ ...plugin.versions[0], path: '../x.zip' }] }],
    },
    {
      ...index,
      plugins: [{ ...plugin, versions: [{ ...plugin.versions[0], sha256: 'x' }] }],
    },
    {
      ...index,
      plugins: [
        {
          ...plugin,
          versions: [
            { ...plugin.versions[0], compatibility: { ...compatibility, apiVersion: 2 } },
          ],
        },
      ],
    },
    {
      ...index,
      plugins: [{ ...plugin, versions: [plugin.versions[0], plugin.versions[0]] }],
    },
  ]) {
    assert.throws(() => parseCatalog(candidate));
  }
});

test('安全 DOM 渲染：恶意文本只作为 textContent，链接只指向相对包路径', () => {
  const malicious = {
    ...index,
    plugins: [
      {
        ...plugin,
        name: 'Paper </script><script>alert(1)</script>',
        description: '<img src=x onerror=alert(2)>',
        tags: ['<svg onload=alert(3)>'],
      },
    ],
  };
  const parsed = parseCatalog(malicious);
  const doc = fakeDocument();
  const root = new FakeNode('div');
  const count = renderCatalog(doc, root, parsed);
  assert.equal(count, 1);
  const nodes = allNodes(root);
  assert.equal(nodes.some((node) => node.tagName === 'script'), false);
  assert.equal(nodes.some((node) => node.tagName === 'img'), false);
  const title = nodes.find((node) => node.className === 'plugin-title');
  assert.match(title.textContent, /<\/script><script>alert\(1\)<\/script>/);
  const links = nodes.filter((node) => node.tagName === 'a');
  assert.ok(links.length >= 2);
  for (const link of links) {
    assert.match(link.attributes.href, /^\.\/v1\//);
  }
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('/v1/x'), null);
});

test('过滤、大小格式化与页面来源静态检查', () => {
  const parsed = parseCatalog(index);
  assert.equal(filterPlugins(parsed.plugins, { query: 'neutral' }).length, 1);
  assert.equal(filterPlugins(parsed.plugins, { query: 'zzz' }).length, 0);
  assert.equal(filterPlugins(parsed.plugins, { category: 'themes' }).length, 1);
  assert.equal(filterPlugins(parsed.plugins, { category: 'agent' }).length, 0);
  assert.equal(formatBytes(1234), '1.2 KB');
  assert.equal(formatBytes(0), '—');
  const source = readFileSync(join(repoRoot, 'web', 'catalog.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML|document\.write|outerHTML\s*=/);
  const html = readFileSync(join(repoRoot, 'web', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.match(html, /src="\.\/catalog\.js"/);
  assert.match(html, /href="\.\/site\.css"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /平台代码 MIT/);
  assert.match(html, /第三方插件以/);
  assert.match(html, /推荐：应用内市场安装/);
  assert.match(html, /marketId/);
  assert.match(html, /本地 ZIP 来源，需要手动更新/);
  assert.match(html, /当前不支持保留插件数据的跨来源迁移/);
  assert.match(html, /不要把卸载重装当作无损迁移方案/);
  assert.doesNotMatch(html, /卸载重装也不能把本地 ZIP 安装转成市场安装/);
  assert.doesNotMatch(html, /一键安装|install URI|collabra:\/\//i);
});

test('浏览器 Ed25519 验签：正确签名通过，篡改失败', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const bytes = Buffer.from('{"schemaVersion":2}\n');
  const signature = nodeSign(null, bytes, privateKey).toString('base64');
  const good = await verifyIndexBytes(bytes, signature, {
    subtle: webcrypto.subtle,
    publicKeyB64,
  });
  assert.equal(good.ok, true);
  assert.equal(good.verified, true);
  const bad = await verifyIndexBytes(Buffer.from('tampered'), signature, {
    subtle: webcrypto.subtle,
    publicKeyB64,
  });
  assert.equal(bad.ok, false);
  const unsupported = await verifyIndexBytes(bytes, signature, {
    subtle: null,
    publicKeyB64,
  });
  assert.equal(unsupported.ok, true);
  assert.equal(unsupported.unsupported, true);
});

test('fetchCatalog 在签名有效时返回解析结果，无效时拒绝', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const bytes = Buffer.from(`${JSON.stringify(index)}\n`);
  const signature = nodeSign(null, bytes, privateKey).toString('base64');
  const response = (body) => ({
    ok: true,
    arrayBuffer: async () =>
      body instanceof Buffer
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : new TextEncoder().encode(body).buffer,
    text: async () => (typeof body === 'string' ? body : body.toString('utf8')),
  });
  const fetchImpl = async (url) =>
    String(url).endsWith('.sig') ? response(`${signature}\n`) : response(bytes);
  const result = await fetchCatalog({
    fetchImpl,
    baseUrl: 'https://example.test/collabra-plugins/',
    subtle: webcrypto.subtle,
    publicKeyB64,
  });
  assert.equal(result.index.sequence, 1);
  assert.equal(result.verification.verified, true);
});

test('站点图标：同源 media 路径渲染成 img，非法路径与加载失败都有兜底', () => {
  const withIcon = {
    ...index,
    plugins: [{ ...plugin, icon: 'media/collabra.paper/1.0.0/icon.svg' }],
  };
  const parsed = parseCatalog(withIcon);
  const doc = fakeDocument();
  const card = renderPluginCard(doc, parsed.plugins[0]);
  const nodes = allNodes(card);
  const image = nodes.find((node) => node.tagName === 'img');
  assert.ok(image, '应渲染插件图标 img');
  assert.equal(image.attributes.src, './v1/media/collabra.paper/1.0.0/icon.svg');
  assert.equal(image.attributes.alt, '');
  assert.equal(image.attributes.loading, 'lazy');

  // 加载失败时换成首字母占位，不留破图
  image.listeners.error();
  const after = allNodes(card);
  assert.equal(after.some((node) => node.tagName === 'img'), false);
  const fallback = after.find((node) => node.className === 'plugin-icon fallback');
  assert.ok(fallback, '缺少占位');
  assert.equal(fallback.textContent, 'C');

  for (const icon of [
    'https://evil.example.com/icon.svg',
    'media/collabra.other/1.0.0/icon.svg',
    'media/collabra.paper/2.0.0/icon.svg',
    'media/collabra.paper/1.0.0/../../x.svg',
    'media/collabra.paper/1.0.0/icon.exe',
  ]) {
    assert.throws(
      () => parseCatalog({ ...index, plugins: [{ ...plugin, icon }] }),
      /图标不合法/,
      `应拒绝 ${icon}`
    );
  }
  // 没有 icon 的条目继续可渲染
  const plainCard = renderPluginCard(fakeDocument(), parseCatalog(index).plugins[0]);
  assert.ok(allNodes(plainCard).some((node) => node.className === 'plugin-icon fallback'));
});
