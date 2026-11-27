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
  isMarketCompatible,
  latestCompatibleVersion,
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
const relativeFiles = (dir) =>
  filesUnder(dir)
    .map((file) => file.slice(dir.length + 1))
    .sort();
const read = (path) => readFileSync(path, 'utf8');
const OLD_COMPATIBILITY = {
  host: 'collabra',
  apiVersion: 1,
  minAppVersion: '0.2.81',
  platforms: ['darwin'],
  testedSurfaces: ['code', 'settings', 'bot'],
};
const NEW_COMPATIBILITY = {
  host: 'collabra',
  apiVersion: 1,
  minAppVersion: '0.2.81',
  platforms: ['darwin', 'win32'],
  testedSurfaces: ['code', 'settings', 'bot'],
};
const VERSIONS = ['1.0.0', '1.0.1'];
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
    plugins
      .filter((plugin) => plugin.meta.category === 'themes')
      .map((plugin) => plugin.id)
      .sort(),
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
    // 已发布的 1.0.0 兼容原值不可回改：历史版本仍只声明 macOS
    assert.deepEqual(version.compatibility, OLD_COMPATIBILITY);
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

test('兼容回归：1.0.1 在 win32 与 darwin 的 0.2.81 可用，linux 与 0.2.80 仍被排除', () => {
  const { plugins } = loadSourcePlugins(join(repoRoot, 'plugins'));
  for (const theme of THEMES) {
    const plugin = plugins.find((item) => item.id === theme.id);
    const latest = plugin.versions.at(-1);
    assert.equal(latest.version, '1.0.1', `${theme.id} 最新版本应是平台修复后的 1.0.1`);
    assert.deepEqual(latest.permissions, [], '新版本同样零权限');
    assert.deepEqual(latest.compatibility, NEW_COMPATIBILITY);
    // 用户投诉的 Windows 场景：0.2.81 Windows 必须能选中 1.0.1
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'win32', hostVersion: '0.2.81' }),
      true,
      `${theme.id} 在 Windows 0.2.81 上必须可用`
    );
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'darwin', hostVersion: '0.2.81' }),
      true,
      `${theme.id} 在 macOS 0.2.81 上必须可用`
    );
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'win32', hostVersion: '0.2.82' }),
      true,
      '更高版本仍需可用（没有 maxAppVersion）'
    );
    // 不低于市场协议基线：低于 0.2.81 的客户端读不到本市场，保持排除
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'darwin', hostVersion: '0.2.80' }),
      false,
      `${theme.id} 不应向 0.2.80 声明兼容`
    );
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'win32', hostVersion: '0.2.80' }),
      false
    );
    // 未请求 Linux，不扩大平台声明
    assert.equal(
      isMarketCompatible(latest.compatibility, { platform: 'linux', hostVersion: '0.2.81' }),
      false,
      `${theme.id} 不应声称支持 Linux`
    );
    // 旧版本仍按历史元数据只对 macOS 生效，不会被新平台声明"追溯放大"
    assert.equal(
      isMarketCompatible(plugin.versions[0].compatibility, {
        platform: 'win32',
        hostVersion: '0.2.81',
      }),
      false,
      '已发布 1.0.0 的 darwin 限制必须保持原样'
    );
    // 客户端"挑最新兼容版本"的结果：两个平台都选中 1.0.1
    for (const platform of ['darwin', 'win32'])
      assert.equal(
        latestCompatibleVersion(plugin.versions, { platform, hostVersion: '0.2.81' }),
        '1.0.1',
        `${theme.id} 在 ${platform} 上应选到 1.0.1`
      );
    assert.equal(
      latestCompatibleVersion(plugin.versions, { platform: 'linux', hostVersion: '0.2.81' }),
      null
    );
  }
});

test('1.0.1 是 1.0.0 的复制：CSS/素材/图标逐字节一致，只改清单版本与说明文档', () => {
  for (const theme of THEMES) {
    const oldDir = versionDir(theme.id, '1.0.0');
    const newDir = versionDir(theme.id, '1.0.1');
    assert.deepEqual(relativeFiles(newDir), relativeFiles(oldDir), `${theme.id} 文件清单必须一致`);
    for (const file of relativeFiles(oldDir)) {
      const isDoc = ['enso-plugin.json', 'README.md', 'NOTICE.md'].includes(file);
      if (isDoc) continue;
      assert.deepEqual(
        readFileSync(join(newDir, file)),
        readFileSync(join(oldDir, file)),
        `${theme.id} 的 ${file} 必须与 1.0.0 逐字节一致`
      );
    }
    // 清单只允许改 version
    const oldManifest = readJson(join(oldDir, 'enso-plugin.json'));
    const newManifest = readJson(join(newDir, 'enso-plugin.json'));
    assert.equal(newManifest.version, '1.0.1');
    assert.deepEqual(
      { ...newManifest, version: oldManifest.version },
      oldManifest,
      `${theme.id} 1.0.1 清单除 version 外不能有改动`
    );
    // NOTICE 只在末尾追加版本记录，原有来源记录不得改写
    const oldNotice = read(join(oldDir, 'NOTICE.md')).trimEnd();
    const newNotice = read(join(newDir, 'NOTICE.md'));
    assert.ok(newNotice.startsWith(oldNotice), `${theme.id} NOTICE 原有内容必须保持不变`);
    assert.match(newNotice, /1\.0\.1/);
    assert.match(newNotice, /逐字节一致/);
  }
});

test('包内容是完整角色包：素材齐全、引用无误、无脚本无外链', () => {
  for (const theme of THEMES) for (const version of VERSIONS) {
    const dir = versionDir(theme.id, version);
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
  for (const theme of THEMES) for (const version of VERSIONS) {
    const dir = versionDir(theme.id, version);
    const readme = read(join(dir, 'README.md'));
    assert.match(readme, /修改界面样式/, '必须写明需要界面样式授权');
    assert.match(readme, /安装本身不会切换主题/, '不能说安装即切换主题');
    assert.match(readme, /不执行插件 JavaScript|不执行插件/, '必须写明不执行代码');
    assert.match(readme, /不发网络请求/, '必须写明不联网');
    assert.match(readme, /紧凑窗口/);
    assert.match(readme, /设置 → 外观 → 主题/, '必须写清怎么选主题');
    if (version === '1.0.1') {
      // 兼容范围与验收范围必须分开写，不能把"只视觉验过 macOS"说成"只兼容 macOS"，
      // 也不能把 Windows 平台筛选验证说成 Windows 界面真机验收
      assert.match(readme, /兼容范围（市场筛选依据）/, '必须单列兼容范围');
      assert.match(readme, /验收范围（只写真实做过的）/, '必须单列验收范围');
      assert.match(readme, /`win32`/, '必须写明 Windows 在兼容范围内');
      assert.match(readme, /Windows 只验证了包目录结构/, 'Windows 只能写已验证的部分');
      assert.match(readme, /没有\*\*在 Windows 真机上/, '必须声明未在 Windows 真机验收界面');
      assert.doesNotMatch(readme, /Windows 界面已实测|Windows 真机验过|Windows 已验收/);
      assert.match(readme, /视觉验收只在 macOS 真机上/, '视觉验收必须标注平台');
    }
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

test('memory 1.1.4：记忆以社区插件进入索引，权限、独立工作区与兼容范围可审查', () => {
  const { plugins } = loadSourcePlugins(join(repoRoot, 'plugins'));
  const plugin = plugins.find((item) => item.id === 'codekiln.memory');
  assert.ok(plugin, '市场源缺少 codekiln.memory');
  assert.equal(plugin.meta.tier, 'community');
  assert.equal(plugin.meta.category, 'productivity');
  assert.equal(plugin.meta.license, 'AGPL-3.0-only');
  assert.match(plugin.meta.homepage, /^https:\/\//);
  assert.deepEqual(
    plugin.versions.map((item) => item.version),
    ['1.1.4', '1.3.0']
  );
  const latest = plugin.versions.find((item) => item.version === '1.1.4');
  assert.deepEqual(latest.permissions, [
    'agent.tool',
    'ui.view',
    'agent.observe',
    'agent.intercept',
    'agent.run',
    'process.background',
    'ui.notify',
    'ui.clipboard',
  ]);
  // 最左图标轨工作区与宿主主题令牌同步都从 0.2.109 起可用；更早版本会退回右侧视图。
  assert.deepEqual(latest.compatibility, {
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: '0.2.109',
    platforms: ['darwin', 'win32', 'linux'],
    testedSurfaces: ['code'],
  });
  const dir = versionDir('codekiln.memory', '1.1.4');
  const manifest = readJson(join(dir, 'enso-plugin.json'));
  assert.equal(manifest.name, '记忆');
  assert.equal(manifest.version, '1.1.4');
  assert.equal(manifest.icon, 'icon.svg');
  assert.equal(manifest.views, undefined);
  assert.deepEqual(manifest.contributes.views[0].location, 'activitybar');
  assert.match(read(join(dir, 'LICENSE')), /GNU AFFERO/);
  assert.ok(existsSync(join(dir, 'README.md')));
  // 插件本体必须自包含：不随包发布测试与验证脚本。
  assert.ok(!existsSync(join(dir, 'test')), '包内不能带测试目录');
  assert.ok(manifest.main === 'main.mjs' && existsSync(join(dir, 'main.mjs')));
});

test('memory 1.3.0：项目切换与原图直发需要新宿主，权限扩大需可审查', () => {
  const { plugins } = loadSourcePlugins(join(repoRoot, 'plugins'));
  const plugin = plugins.find((item) => item.id === 'codekiln.memory');
  const latest = plugin.versions.find((item) => item.version === '1.3.0');
  assert.ok(latest, '市场源缺少 codekiln.memory 1.3.0');
  assert.deepEqual(latest.permissions, [
    'agent.tool',
    'ui.view',
    'agent.observe',
    'agent.intercept',
    'agent.inject',
    'session.read',
    'agent.run',
    'process.background',
    'ui.notify',
    'ui.clipboard',
  ]);
  // 显式项目作用域与 worker 接收回执从 0.2.112 起才存在；旧宿主只有复制指令。
  assert.deepEqual(latest.compatibility, {
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: '0.2.112',
    platforms: ['darwin', 'win32', 'linux'],
    testedSurfaces: ['code'],
  });
  const dir = versionDir('codekiln.memory', '1.3.0');
  const manifest = readJson(join(dir, 'enso-plugin.json'));
  assert.equal(manifest.name, '记忆');
  assert.equal(manifest.version, '1.3.0');
  assert.equal(manifest.engines.enso, '>=0.2.112');
  assert.equal(manifest.icon, 'icon.svg');
  assert.equal(manifest.contributes.views[0].location, 'activitybar');
  assert.ok(manifest.contributes.methods.some((item) => item.name === 'send_todo'));
  assert.ok(manifest.contributes.agentTools.some((item) => item.name === 'scratchpad'));
  assert.match(read(join(dir, 'LICENSE')), /GNU AFFERO/);
  assert.ok(existsSync(join(dir, 'README.md')));
  // 图片附件实现必须随包；测试与验收脚本不能随包。
  assert.ok(existsSync(join(dir, 'attachments.mjs')));
  assert.ok(!existsSync(join(dir, 'test')), '包内不能带测试目录');
});

test('llmdoc 1.10.0：知识地图以社区插件进入索引，权限与兼容范围可审查', () => {
  const { plugins } = loadSourcePlugins(join(repoRoot, 'plugins'));
  const plugin = plugins.find((item) => item.id === 'codekiln.llmdoc');
  assert.ok(plugin, '市场源缺少 codekiln.llmdoc');
  assert.equal(plugin.meta.tier, 'community');
  assert.equal(plugin.meta.category, 'insights');
  assert.equal(plugin.meta.license, 'AGPL-3.0-only');
  assert.match(plugin.meta.homepage, /^https:\/\//);
  assert.deepEqual(
    plugin.versions.map((item) => item.version),
    ['1.9.0', '1.10.0']
  );
  const latest = plugin.versions.find((item) => item.version === '1.10.0');
  assert.deepEqual(latest.permissions, [
    'agent.tool',
    'ui.view',
    'composer.draft',
    'agent.intercept',
    'agent.inject',
    'agent.observe',
    'agent.run',
    'fs.read',
    'fs.write',
  ]);
  assert.deepEqual(latest.compatibility, {
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: '0.2.83',
    platforms: ['darwin', 'win32', 'linux'],
    testedSurfaces: ['code', 'settings'],
  });
  // 1.9.0 已发布，权限与兼容范围必须保持原样。
  const previous = plugin.versions.find((item) => item.version === '1.9.0');
  assert.equal(previous.permissions.length, 6);
  assert.equal(previous.compatibility.minAppVersion, '0.2.80');
  const dir = versionDir('codekiln.llmdoc', '1.10.0');
  const manifest = readJson(join(dir, 'enso-plugin.json'));
  assert.equal(manifest.name, '知识地图');
  assert.equal(manifest.version, '1.10.0');
  assert.equal(manifest.icon, 'icon.svg');
  assert.match(read(join(dir, 'LICENSE')), /GNU AFFERO/);
  assert.ok(existsSync(join(dir, 'README.md')));
  assert.ok(existsSync(join(dir, 'knowledge.html')));
  assert.ok(existsSync(join(dir, 'automation.mjs')));
  assert.ok(existsSync(join(dir, 'run-cli.mjs')));
});

test('构建：主题包与 llmdoc 进入索引与 media，paper 字节保持不变', () => {
  const root = tempDir('collabra-themes-build-');
  const sources = copyAllSources(root);
  const keys = makeKeys(join(root, 'keys'));
  const out = join(root, 'out');
  const result = testBuild({ sources, history: join(root, 'none'), out, keys, now: fixedNow });
  const byId = new Map(result.index.plugins.map((plugin) => [plugin.id, plugin]));
  assert.deepEqual([...byId.keys()].sort(), [
    'codekiln.llmdoc',
    'codekiln.memory',
    'collabra.nailong',
    'collabra.naiwa',
    'collabra.paper',
  ]);
  assert.equal(
    byId.get('codekiln.memory').icon,
    'media/codekiln.memory/1.3.0/icon.svg',
    'memory 图标必须随版本进入 media'
  );
  assert.equal(
    byId.get('codekiln.llmdoc').icon,
    'media/codekiln.llmdoc/1.10.0/icon.svg',
    'llmdoc 图标必须随版本进入 media'
  );
  const paper = byId.get('collabra.paper');
  assert.equal(paper.versions[0].sha256, PAPER_ZIP_SHA, 'paper ZIP 字节必须保持不变');
  assert.equal(paper.icon, undefined, '旧插件不能凭空长出 icon 字段');
  for (const theme of THEMES) {
    const plugin = byId.get(theme.id);
    // 图标跟随最新发布版本：1.0.1 有自己的版本化 media 路径
    assert.equal(plugin.icon, `media/${theme.id}/1.0.1/icon.svg`);
    assert.equal(plugin.readme.path, `readmes/${theme.id}/1.0.1.md`);
    assert.deepEqual(
      plugin.versions.map((item) => item.version),
      VERSIONS,
      '旧 1.0.0 必须和新 1.0.1 一起留在索引里'
    );
    // 旧版本仍按发布时的 darwin/0.2.81 元数据存在，不被新版本"覆盖"
    assert.deepEqual(plugin.versions[0].compatibility, OLD_COMPATIBILITY);
    assert.deepEqual(plugin.versions[1].compatibility, NEW_COMPATIBILITY);
    // 客户端筛选：Windows 与 macOS 的 0.2.81 都选中 1.0.1
    for (const platform of ['darwin', 'win32'])
      assert.equal(
        latestCompatibleVersion(plugin.versions, { platform, hostVersion: '0.2.81' }),
        '1.0.1',
        `${theme.id} 在 ${platform} 上必须能选到 1.0.1`
      );
    const written = join(out, 'v1', plugin.icon);
    assert.deepEqual(
      readFileSync(written),
      readFileSync(join(versionDir(theme.id, '1.0.1'), 'icon.svg')),
      `${theme.id} 的 media 图标必须与包内 icon.svg 逐字节一致`
    );
    // 1.0.1 的 ZIP 只允许清单版本与说明文档不同，资源条目必须逐字节等于 1.0.0
    const oldZip = readZipEntries(readFileSync(join(out, 'v1', plugin.versions[0].path)));
    const newZip = readZipEntries(readFileSync(join(out, 'v1', plugin.versions[1].path)));
    assert.deepEqual(
      newZip.map((entry) => entry.path),
      oldZip.map((entry) => entry.path),
      `${theme.id} 1.0.1 ZIP 条目清单必须与 1.0.0 一致`
    );
    const oldByPath = new Map(oldZip.map((entry) => [entry.path, entry.data]));
    for (const entry of newZip) {
      if (['enso-plugin.json', 'README.md', 'NOTICE.md'].includes(entry.path)) continue;
      assert.deepEqual(entry.data, oldByPath.get(entry.path), `${theme.id} 的 ${entry.path} 被改动`);
    }
    const zipPath = join(out, 'v1', plugin.versions[1].path);
    const entries = newZip.map((entry) => entry.path);
    assert.ok(entries.includes('icon.svg'), 'ZIP 内必须有 icon.svg');
    assert.ok(entries.includes(`themes/${theme.themeId}.css`));
    assert.ok(entries.some((entry) => entry.startsWith('themes/assets/')));
    assert.equal(entries.some((entry) => /\.woff2$/.test(entry)), false, '未分发的字体不能进包');
  }
  testSign({ out, history: join(root, 'none'), keys });
  const ledger = readJson(join(out, 'v1', 'history', '1.ledger.json'));
  for (const theme of THEMES) {
    const artifacts = ledger.artifacts.filter((item) => item.pluginId === theme.id);
    assert.deepEqual(artifacts.map((item) => item.version), VERSIONS);
    const iconBytes = readFileSync(join(versionDir(theme.id, '1.0.1'), 'icon.svg'));
    for (const artifact of artifacts) {
      assert.equal(artifact.icon.path, `media/${theme.id}/${artifact.version}/icon.svg`);
      assert.equal(artifact.icon.size, iconBytes.length);
      assert.match(artifact.icon.sha256, /^[0-9a-f]{64}$/);
    }
    // 版本化图标各自入账，但字节相同（没有换图）
    assert.equal(artifacts[0].icon.sha256, artifacts[1].icon.sha256);
  }
  assert.equal(
    ledger.artifacts.find((item) => item.pluginId === 'collabra.paper').icon,
    undefined
  );
  loadHistory(out, { publicKeyPem: keys.publicPem, allowTestKey: true });
});

test('生产 dist 快照上增量构建：旧包、旧 ledger 与旧图标全部保留', async (t) => {
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
    const publishedPlugin = published.plugins.find((item) => item.id === theme.id);
    // 旧 1.0.0 条目（含当时 darwin/0.2.81 的 compatibility 与 ZIP 哈希）原样保留
    assert.deepEqual(plugin.versions[0], publishedPlugin.versions[0]);
    assert.deepEqual(plugin.versions[0].compatibility, OLD_COMPATIBILITY);
    assert.deepEqual(plugin.versions[1].compatibility, NEW_COMPATIBILITY);
    // 图标跟随最新版本走新的版本化路径，旧版本的 media 图标不删不改
    assert.equal(plugin.icon, `media/${theme.id}/1.0.1/icon.svg`);
    assert.equal(existsSync(join(out, 'v1', plugin.icon)), true);
    const oldIcon = `media/${theme.id}/${publishedPlugin.versions.at(-1).version}/icon.svg`;
    assert.equal(publishedPlugin.icon, oldIcon);
    assert.deepEqual(
      readFileSync(join(out, 'v1', oldIcon)),
      readFileSync(join(snapshot, 'v1', oldIcon)),
      '旧版本图标必须逐字节保留'
    );
    assert.deepEqual(
      readFileSync(join(out, 'v1', plugin.icon)),
      readFileSync(join(out, 'v1', oldIcon)),
      '1.0.1 图标必须与 1.0.0 逐字节一致'
    );
    // 客户端筛选：Windows 与 macOS 的 0.2.81 都能看到 1.0.1
    for (const platform of ['darwin', 'win32'])
      assert.equal(
        latestCompatibleVersion(plugin.versions, { platform, hostVersion: '0.2.81' }),
        '1.0.1'
      );
  }
  // 旧 sequence 的 snapshot/ledger 与签名逐字节复制，签名链条不受影响
  assert.deepEqual(
    readFileSync(join(out, 'v1', 'history', `${published.sequence}.ledger.json`)),
    readFileSync(join(snapshot, 'v1', 'history', `${published.sequence}.ledger.json`))
  );
  for (const name of readdirSync(join(snapshot, 'v1', 'history'))) {
    if (name.startsWith(`${result.index.sequence}.`)) continue;
    assert.deepEqual(
      readFileSync(join(out, 'v1', 'history', name)),
      readFileSync(join(snapshot, 'v1', 'history', name)),
      `历史文件 ${name} 必须逐字节保留`
    );
  }
  // 旧包与旧 README 全部逐字节保留
  for (const plugin of published.plugins)
    for (const version of plugin.versions) {
      assert.deepEqual(
        readFileSync(join(out, 'v1', version.path)),
        readFileSync(join(snapshot, 'v1', version.path)),
        `${version.path} 必须逐字节保留`
      );
    }
});
