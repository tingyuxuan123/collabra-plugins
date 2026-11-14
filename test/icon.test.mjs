import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_ICON_BYTES } from '../scripts/lib/constants.mjs';
import {
  historyLedgerPath,
  historyLedgerSignaturePath,
} from '../scripts/lib/constants.mjs';
import { signBytes } from '../scripts/lib/crypto.mjs';
import { loadHistory } from '../scripts/lib/history.mjs';
import { loadSourcePlugins } from '../scripts/lib/source.mjs';
import { validateMarketPlugin } from '../scripts/lib/schema.mjs';
import { readZipEntries } from '../scripts/lib/zip.mjs';
import {
  copyPaperSource,
  fixedNow,
  makeKeys,
  paperMarketPath,
  paperVersionDir,
  readJson,
  repoRoot,
  tempDir,
  testBuild,
  testSign,
  writeJson,
} from './helpers.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n';

function basePlugin(overrides = {}) {
  return {
    id: 'collabra.paper',
    name: 'Collabra Paper',
    description: 'palette',
    tier: 'official',
    category: 'themes',
    tags: ['theme'],
    license: 'MIT',
    versions: [
      {
        version: '1.0.0',
        permissions: [],
        path: 'packages/collabra.paper/1.0.0.zip',
        sha256: 'a'.repeat(64),
        size: 10,
        compatibility: {
          host: 'collabra',
          apiVersion: 1,
          minAppVersion: '0.2.80',
          platforms: ['darwin'],
          testedSurfaces: [],
        },
      },
    ],
    ...overrides,
  };
}

/** 给 paper 源加上可发布的正确图标，返回图标字节与路径。 */
function addPaperIcon(sources, { name = 'icon.svg', bytes = SVG } = {}) {
  const dir = paperVersionDir(sources, '1.0.0');
  writeFileSync(join(dir, name), bytes);
  const manifestPath = join(dir, 'enso-plugin.json');
  const manifest = readJson(manifestPath);
  manifest.icon = name;
  writeJson(manifestPath, manifest);
  return { path: name, bytes: Buffer.from(bytes) };
}

test('schema：icon 只接受本插件本版本 media 下的安全相对路径', () => {
  const ok = validateMarketPlugin(
    basePlugin({ icon: 'media/collabra.paper/1.0.0/icon.svg' })
  );
  assert.equal(ok.ok, true, ok.ok ? '' : ok.errors.join('; '));
  for (const icon of [
    'https://evil.example.com/icon.svg',
    '//evil.example.com/icon.svg',
    '/media/collabra.paper/1.0.0/icon.svg',
    '../media/collabra.paper/1.0.0/icon.svg',
    'media/other.plugin/1.0.0/icon.svg',
    'media/collabra.paper/2.0.0/icon.svg',
    'media/collabra.paper/1.0.0/nested/icon.svg',
    'media/collabra.paper/1.0.0/icon.exe',
    'media/collabra.paper/1.0.0/icon',
    42,
    `${'media/collabra.paper/1.0.0/'}${'a'.repeat(1000)}.svg`,
  ]) {
    const result = validateMarketPlugin(basePlugin({ icon }));
    assert.equal(result.ok, false, `应拒绝 icon=${String(icon).slice(0, 60)}`);
  }
  // 没有 icon 的老条目继续合法
  assert.equal(validateMarketPlugin(basePlugin()).ok, true);
});

function setup() {
  const root = tempDir('collabra-icon-test-');
  const sources = copyPaperSource(root);
  const keys = makeKeys(join(root, 'keys'));
  return { root, sources, keys };
}

test('source：图标字节从包内读取，伪图/超大/嵌套路径都被拒绝', () => {
  const { root, sources } = setup();
  addPaperIcon(sources);
  const { plugins } = loadSourcePlugins(sources);
  const version = plugins[0].versions[0];
  assert.equal(version.icon.path, 'media/collabra.paper/1.0.0/icon.svg');
  assert.equal(version.icon.size, Buffer.byteLength(SVG));
  assert.equal(version.icon.bytes.toString('utf8'), SVG);

  // 扩展名是 svg，内容其实是 HTML：拒绝
  const fake = copyPaperSource(tempDir('collabra-icon-fake-'));
  addPaperIcon(fake, { bytes: '<html><body>not an image</body></html>' });
  assert.throws(() => loadSourcePlugins(fake), /伪图|不符/);

  // 超过上限：拒绝
  const big = copyPaperSource(tempDir('collabra-icon-big-'));
  addPaperIcon(big, { bytes: `<?xml?><svg>${'x'.repeat(MAX_ICON_BYTES)}</svg>` });
  assert.throws(() => loadSourcePlugins(big), /icon 超过/);

  // 带路径分隔的文件名：拒绝（避免图标落到任意子目录）
  const nested = copyPaperSource(tempDir('collabra-icon-nested-'));
  mkdirSync(join(paperVersionDir(nested, '1.0.0'), 'assets'), { recursive: true });
  writeFileSync(join(paperVersionDir(nested, '1.0.0'), 'assets', 'icon.svg'), SVG);
  const manifestPath = join(paperVersionDir(nested, '1.0.0'), 'enso-plugin.json');
  const manifest = readJson(manifestPath);
  manifest.icon = 'assets/icon.svg';
  writeJson(manifestPath, manifest);
  assert.throws(() => loadSourcePlugins(nested), /包根下的单个文件名/);

  // 可执行/可嵌入内容一律拒绝：script、foreignObject、javascript:、任意 on* 事件属性
  const hostile = {
    script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    foreignObject:
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>',
    javascriptHref: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>',
    onload: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    onmouseover: '<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="alert(1)"/></svg>',
    onanimationstart:
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onanimationstart=alert(1) /></svg>',
    onClickUpper: '<svg xmlns="http://www.w3.org/2000/svg"><rect onClick="alert(1)"/></svg>',
  };
  for (const [label, bytes] of Object.entries(hostile)) {
    const dir = copyPaperSource(tempDir(`collabra-icon-${label}-`));
    addPaperIcon(dir, { bytes });
    assert.throws(
      () => loadSourcePlugins(dir),
      /不允许包含脚本或事件属性/,
      `${label} 必须被拒绝`
    );
  }

  // 正常 SVG 不被误伤：data 内联图片、渐变、动画元素（非事件属性）都应通过
  const benign = copyPaperSource(tempDir('collabra-icon-benign-'));
  addPaperIcon(benign, {
    bytes: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">',
      '<image href="data:image/webp;base64,UklGRg==" width="8" height="8"/>',
      '<animate attributeName="opacity" values="0;1" dur="1s"/>',
      '<linearGradient id="g"><stop offset="0"/></linearGradient>',
      '</svg>',
    ].join(''),
  });
  const benignPlugin = loadSourcePlugins(benign).plugins[0];
  assert.equal(benignPlugin.versions[0].icon.path, 'media/collabra.paper/1.0.0/icon.svg');
  rmSync(root, { recursive: true, force: true });
});

test('build：图标写进 v1/media，索引与 ledger 记录同一条路径与哈希', () => {
  const { root, sources, keys } = setup();
  const icon = addPaperIcon(sources);
  const out = join(root, 'out');
  const result = testBuild({
    sources,
    history: join(root, 'none'),
    out,
    keys,
    now: fixedNow,
  });
  const plugin = result.index.plugins.find((item) => item.id === 'collabra.paper');
  assert.equal(plugin.icon, 'media/collabra.paper/1.0.0/icon.svg');
  const written = join(out, 'v1', plugin.icon);
  assert.equal(existsSync(written), true, 'media 文件没有写出');
  assert.deepEqual(readFileSync(written), icon.bytes);

  testSign({ out, history: join(root, 'none'), keys });
  const ledger = readJson(join(out, 'v1', historyLedgerPath(1)));
  const artifact = ledger.artifacts.find((item) => item.pluginId === 'collabra.paper');
  // 独立从原始 SVG 字节算哈希，不从 ledger 读回来做自证
  const expectedSha = createHash('sha256').update(icon.bytes).digest('hex');
  assert.deepEqual(artifact.icon, {
    path: 'media/collabra.paper/1.0.0/icon.svg',
    sha256: expectedSha,
    size: icon.bytes.length,
  });
  assert.equal(
    createHash('sha256').update(readFileSync(written)).digest('hex'),
    expectedSha,
    '写出的 media 文件也必须是同一份字节'
  );
  // 图标也进了签名历史：重新加载必须通过
  loadHistory(out, { publicKeyPem: keys.publicPem, allowTestKey: true });
});

test('history：已发布图标不可篡改、不可替换、不可移除，旧条目也不许补图', async (t) => {
  const { root, sources, keys } = setup();
  addPaperIcon(sources);
  const history = join(root, 'history');
  const first = join(root, 'first');
  testBuild({ sources, history: join(root, 'none'), out: first, keys });
  testSign({ out: first, history: join(root, 'none'), keys });

  // 1) 正常增量：图标不变，可以继续构建
  const second = join(root, 'second');
  testBuild({ sources, history: first, out: second, keys });
  testSign({ out: second, history: first, keys });
  assert.equal(readJson(join(second, 'v1', 'index.json')).sequence, 2);

  // 2) 篡改 dist 里的图标字节：下一轮构建必须失败
  const tampered = join(root, 'tampered');
  testBuild({ sources, history: second, out: tampered, keys });
  testSign({ out: tampered, history: second, keys });
  const mediaFile = join(tampered, 'v1', 'media', 'collabra.paper', '1.0.0', 'icon.svg');
  writeFileSync(mediaFile, `<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>`);
  assert.throws(
    () => testBuild({ sources, history: tampered, out: join(root, 'after-tamper'), keys }),
    /图标哈希不匹配|图标大小不匹配/
  );

  // 3) 模拟"功能上线前的历史"：整条 ledger 链都没有 icon（重新签过），
  //    此时源端补图必须被拒——旧版本不能事后补图标
  const stripped = join(root, 'stripped');
  testBuild({ sources, history: second, out: stripped, keys });
  testSign({ out: stripped, history: second, keys });
  for (const sequence of [1, 2, 3]) {
    const ledgerPath = join(stripped, 'v1', historyLedgerPath(sequence));
    const ledger = readJson(ledgerPath);
    for (const artifact of ledger.artifacts) delete artifact.icon;
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    writeFileSync(
      join(stripped, 'v1', historyLedgerSignaturePath(sequence)),
      `${signBytes(readFileSync(ledgerPath), keys.privatePem)}\n`
    );
  }
  //    a) 只从 ledger 里摘掉 icon 但媒体文件还在 → 被"未入账产物"拦下
  assert.throws(
    () => testBuild({ sources, history: stripped, out: join(root, 'after-strip-a'), keys }),
    /未在 signed ledger 中的产物/
  );
  //    b) 连媒体文件一起删掉（等价于图标功能上线前的历史）→ 无法事后补图
  rmSync(join(stripped, 'v1', 'media'), { recursive: true, force: true });
  assert.throws(
    () => testBuild({ sources, history: stripped, out: join(root, 'after-strip'), keys }),
    /不能补发图标/
  );

  // 4) 源端把图标删掉：同版本的图标不能被移除
  const noIcon = copyPaperSource(join(root, 'no-icon'));
  assert.throws(
    () => testBuild({ sources: noIcon, history: second, out: join(root, 'after-remove'), keys }),
    /图标被移除|包内容被修改/
  );
  rmSync(history, { recursive: true, force: true });
});
