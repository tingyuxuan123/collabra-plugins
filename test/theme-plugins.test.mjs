import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadSourcePlugins } from '../scripts/lib/source.mjs';
import { readZipEntries } from '../scripts/lib/zip.mjs';
import { loadHistory } from '../scripts/lib/history.mjs';
import {
  copyAllSources,
  fixedNow,
  makeKeys,
  readJson,
  repoRoot,
  tempDir,
  testBuild,
  testSign,
} from './helpers.mjs';

/** 两个社区主题包的验收路径：真实素材、零权限、真实挂点、历史不变。 */
const THEMES = [
  {
    id: 'collabra.nailong',
    themeId: 'nailong',
    name: '奶龙',
    upstream: 'enso.nailong',
    commit: '6fb08f3a96a12ce7d9bd03534347bd9d96d9e04f',
  },
  {
    id: 'collabra.naiwa',
    themeId: 'naiwa',
    name: '奶蛙',
    upstream: 'enso.naiwa',
    commit: 'bb796a9942368db6740ee557aeb8ac4e8cbebb02',
  },
];
const PAPER_ZIP_SHA = '830976b5b9c3426512e11d744228eab458afa8e65058d58efbd5fc3cc955d836';
const PALETTE_KEYS = [
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
const pluginRoot = (id) => join(repoRoot, 'plugins', id);
const versionDir = (id, version = '1.0.0') => join(pluginRoot(id), 'versions', version);
const read = (path) => readFileSync(path, 'utf8');
const filesUnder = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) out.push(...filesUnder(absolute));
    else out.push(absolute);
  }
  return out;
};
const cssUrls = (css) =>
  [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? '').trim()
  );

test('两个社区主题包已入库：id/主题键/tier/权限/兼容范围都符合市场契约', () => {
  const { plugins, warnings } = loadSourcePlugins(join(repoRoot, 'plugins'));
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    plugins.map((plugin) => plugin.id).sort(),
    ['collabra.nailong', 'collabra.naiwa', 'collabra.paper']
  );
  for (const theme of THEMES) {
    const plugin = plugins.find((item) => item.id === theme.id);
    assert.ok(plugin, `缺少插件源：${theme.id}`);
    assert.equal(plugin.meta.tier, 'community');
    assert.equal(plugin.meta.category, 'themes');
    assert.match(plugin.meta.license, /NOTICE/);
    assert.ok(plugin.meta.tags.includes('theme'));
    const version = plugin.versions[0];
    assert.equal(version.version, '1.0.0');
    assert.deepEqual(version.permissions, [], '不能申请任何权限');
    assert.deepEqual(version.compatibility, {
      host: 'collabra',
      apiVersion: 1,
      minAppVersion: '0.2.81',
      platforms: ['darwin'],
      testedSurfaces: ['code', 'settings', 'bot'],
    });
    const manifest = readJson(join(versionDir(theme.id), 'enso-plugin.json'));
    assert.equal(manifest.id, theme.id);
    assert.equal(manifest.main, undefined);
    assert.equal(manifest.renderer, undefined);
    assert.equal(manifest.icon, 'icon.svg');
    assert.deepEqual(
      manifest.contributes.themes.map((item) => [item.id, item.name]),
      [[theme.themeId, theme.name]]
    );
    // 图标真实存在且是可被客户端识别的 SVG（mime 表：.svg → image/svg+xml）
    const icon = read(join(versionDir(theme.id), 'icon.svg'));
    assert.match(icon, /<svg[\s>]/i);
    assert.doesNotMatch(icon, /<script|onload\s*=/i);
  }
});

test('包内容是完整角色包：素材齐全、引用无误、无脚本无外链', () => {
  for (const theme of THEMES) {
    const dir = versionDir(theme.id);
    const cssRaw = read(join(dir, 'themes', `${theme.themeId}.css`));
    // 负向断言只看真实生效的规则，注释里提到的旧写法不算
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const files = filesUnder(dir).map((file) => file.slice(dir.length + 1));
    assert.equal(files.some((file) => /\.(?:m?js|cjs|node)$/i.test(file)), false, '不能带脚本');
    assert.doesNotMatch(css, /https?:\/\//i);
    assert.doesNotMatch(css, /local-image|@import/i);
    assert.doesNotMatch(css, /\.enso-chat-col/, '旧的每行误命中写法必须已移除');
    assert.doesNotMatch(css, /--font-family|--radius\s*:/, '不能全局改字体/圆角');
    const referenced = new Set();
    for (const url of cssUrls(css)) {
      assert.doesNotMatch(url, /^(?:\/|[a-zA-Z]:)/, `不许绝对路径：${url}`);
      const target = join('themes', url.split(/[?#]/)[0]);
      assert.equal(files.includes(target), true, `${theme.id} 引用缺失素材：${target}`);
      referenced.add(target);
    }
    const assets = files.filter((file) => file.startsWith('themes/assets/'));
    assert.ok(assets.length >= 16, `${theme.id} 素材数量异常：${assets.length}`);
    assert.deepEqual(assets.filter((file) => !referenced.has(file)), [], '存在未引用的素材');
    // 动图形式不同（奶龙是动态 webp，奶蛙是 gif），但都必须保留 reduced-motion 静帧
    assert.ok(
      assets.some((file) => file.endsWith('.gif') || file.endsWith('.webp')),
      `${theme.id} 应保留动图/素材`
    );
    assert.ok(
      assets.filter((file) => file.endsWith('-still.webp')).length >= 5,
      `${theme.id} 缺少静帧素材`
    );
    // 紧凑窗口保护：两条条件、三处大装饰 + 空时间线背景
    assert.match(cssRaw, /@media \(max-height: 680px\), \(max-width: 960px\)/);
    assert.match(
      css,
      /\[data-slot="chat-view"\] \[data-enso="composer"\]::before \{\s*content: none;/m
    );
    assert.match(css, /\[data-enso="side-panel"\]::after \{\s*content: none;/m);
    assert.match(css, /prefers-reduced-motion/);
    // 调色板完整，深浅不同
    const palette = readJson(join(dir, 'themes', `${theme.themeId}.json`));
    for (const mode of ['light', 'dark'])
      assert.deepEqual(Object.keys(palette[mode]).sort(), [...PALETTE_KEYS].sort());
    assert.notEqual(palette.light.accent, palette.dark.accent);
  }
});

test('README/NOTICE 只写事实：全局样式授权、无执行无网络、来源固定 commit', () => {
  for (const theme of THEMES) {
    const dir = versionDir(theme.id);
    const readme = read(join(dir, 'README.md'));
    assert.match(readme, /修改界面样式/, '必须写明需要界面样式授权');
    assert.match(readme, /安装本身不会切换主题/, '不能说安装即切换主题');
    assert.match(readme, /不执行插件 JavaScript|不执行插件/, '必须写明不执行代码');
    assert.match(readme, /不发网络请求/, '必须写明不联网');
    assert.match(readme, /紧凑窗口/);
    assert.match(readme, /设置 → 外观 → 主题/, '必须写清怎么选主题');
    const notice = read(join(dir, 'NOTICE.md'));
    assert.match(notice, new RegExp(theme.commit), 'NOTICE 必须写上游固定 commit');
    assert.match(notice, new RegExp(theme.upstream.replace('.', '\\.')));
    assert.doesNotMatch(notice, /本机|仅本机|未上架|22afc8a2|b5c31c5a|Application Support/);
    const license = read(join(dir, 'LICENSE'));
    assert.match(license, /MIT License/);
    assert.match(license, /no rights/i, 'LICENSE 必须声明不覆盖角色权利');
    // 私有路径 / 内部测试对话 / 安装 UUID 都不能混进发布包
    for (const file of filesUnder(dir)) {
      const text = /\.(?:svg|json|md|css|txt)$/i.test(file) ? read(file) : '';
      assert.doesNotMatch(text, /\/Users\/|Application Support|extension-plugins\/packages/, `${file} 含本机路径`);
      assert.doesNotMatch(text, /\/tmp\/collabra|collabra-theme-ui/, `${file} 含临时目录`);
    }
  }
});

test('构建：两个主题包进入索引与 media，paper 字节保持不变', () => {
  const root = tempDir('collabra-themes-build-');
  const sources = copyAllSources(root);
  const keys = makeKeys(join(root, 'keys'));
  const out = join(root, 'out');
  const result = testBuild({ sources, history: join(root, 'none'), out, keys, now: fixedNow });
  const byId = new Map(result.index.plugins.map((plugin) => [plugin.id, plugin]));
  assert.deepEqual([...byId.keys()].sort(), [
    'collabra.nailong',
    'collabra.naiwa',
    'collabra.paper',
  ]);
  const paper = byId.get('collabra.paper');
  assert.equal(paper.versions[0].sha256, PAPER_ZIP_SHA, 'paper ZIP 字节必须保持不变');
  assert.equal(paper.icon, undefined, '旧插件不能凭空长出 icon 字段');
  for (const theme of THEMES) {
    const plugin = byId.get(theme.id);
    assert.equal(plugin.icon, `media/${theme.id}/1.0.0/icon.svg`);
    const written = join(out, 'v1', plugin.icon);
    assert.deepEqual(
      readFileSync(written),
      readFileSync(join(versionDir(theme.id), 'icon.svg')),
      `${theme.id} 的 media 图标必须与包内 icon.svg 逐字节一致`
    );
    const zipPath = join(out, 'v1', plugin.versions[0].path);
    const entries = readZipEntries(readFileSync(zipPath)).map((entry) => entry.path);
    assert.ok(entries.includes('icon.svg'), 'ZIP 内必须有 icon.svg');
    assert.ok(entries.includes(`themes/${theme.themeId}.css`));
    assert.ok(entries.some((entry) => entry.startsWith('themes/assets/')));
    assert.equal(entries.some((entry) => /\.woff2$/.test(entry)), false, '未分发的字体不能进包');
  }
  testSign({ out, history: join(root, 'none'), keys });
  const ledger = readJson(join(out, 'v1', 'history', '1.ledger.json'));
  for (const theme of THEMES) {
    const artifact = ledger.artifacts.find((item) => item.pluginId === theme.id);
    assert.equal(artifact.icon.path, `media/${theme.id}/1.0.0/icon.svg`);
    assert.equal(artifact.icon.size, readFileSync(join(versionDir(theme.id), 'icon.svg')).length);
    assert.match(artifact.icon.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(
    ledger.artifacts.find((item) => item.pluginId === 'collabra.paper').icon,
    undefined
  );
  loadHistory(out, { publicKeyPem: keys.publicPem, allowTestKey: true });
});

test('生产 dist 快照上增量构建：旧 paper 条目不发生变化', async (t) => {
  const snapshot = process.env.COLLABRA_PROD_HISTORY;
  if (!snapshot) {
    t.skip('设置 COLLABRA_PROD_HISTORY=<dist 只读快照目录> 后运行');
    return;
  }
  const published = readJson(join(snapshot, 'v1', 'index.json'));
  const publishedPaper = published.plugins.find((plugin) => plugin.id === 'collabra.paper');
  assert.ok(publishedPaper, '快照里必须有已发布的 collabra.paper');
  assert.equal(publishedPaper.versions[0].sha256, PAPER_ZIP_SHA);

  const root = tempDir('collabra-prod-history-');
  const sources = copyAllSources(root);
  const out = join(root, 'out');
  const result = testBuild({
    sources,
    history: snapshot,
    out,
    keys: { publicPem: read(join(repoRoot, 'market-public-key.pem')) },
    now: fixedNow,
  });
  assert.equal(result.index.sequence, published.sequence + 1);
  assert.deepEqual(
    result.index.plugins.find((plugin) => plugin.id === 'collabra.paper'),
    publishedPaper,
    'paper 的元数据与哈希必须与已发布版本完全一致'
  );
  assert.deepEqual(
    readFileSync(join(out, 'v1', publishedPaper.versions[0].path)),
    readFileSync(join(snapshot, 'v1', publishedPaper.versions[0].path)),
    'paper ZIP 字节必须不变'
  );
  for (const theme of THEMES) {
    const plugin = result.index.plugins.find((item) => item.id === theme.id);
    assert.equal(plugin.icon, `media/${theme.id}/1.0.0/icon.svg`);
    assert.equal(existsSync(join(out, 'v1', plugin.icon)), true);
  }
  // 历史文件逐字节复制，签名链条不受影响
  assert.deepEqual(
    readFileSync(join(out, 'v1', 'history', `${published.sequence}.ledger.json`)),
    readFileSync(join(snapshot, 'v1', 'history', `${published.sequence}.ledger.json`))
  );
});
