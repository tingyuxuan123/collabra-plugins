import assert from 'node:assert/strict';
import { linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadSourcePlugins } from '../scripts/lib/source.mjs';
import {
  MAX_PACKAGE_DEPTH,
  MAX_PACKAGE_DIRECTORIES,
  SUPPORTED_PERMISSIONS,
} from '../scripts/lib/constants.mjs';
import {
  copyPaperSource,
  paperMarketPath,
  paperVersionDir,
  readJson,
  repoRoot,
  tempDir,
  writeJson,
} from './helpers.mjs';

test('仓库自带的 collabra.paper 是纯调色板、零权限、无 JS 入口', () => {
  const { plugins, warnings } = loadSourcePlugins(join(repoRoot, 'plugins'));
  assert.deepEqual(warnings, []);
  assert.equal(plugins.length, 1);
  const plugin = plugins[0];
  assert.equal(plugin.id, 'collabra.paper');
  assert.equal(plugin.meta.name, 'Collabra Paper');
  assert.equal(plugin.versions.length, 1);
  const version = plugin.versions[0];
  assert.deepEqual(version.permissions, []);
  assert.deepEqual(version.compatibility.testedSurfaces, []);
  assert.equal(version.compatibility.host, 'collabra');
  assert.equal(version.compatibility.apiVersion, 1);
  assert.equal(version.compatibility.minAppVersion, '0.2.80');
  const manifest = readJson(join(paperVersionDir(join(repoRoot, 'plugins'), '1.0.0'), 'enso-plugin.json'));
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.renderer, undefined);
  assert.deepEqual(manifest.contributes.themes, [
    { id: 'paper', name: 'Paper', path: 'themes/paper.json' },
  ]);
  const theme = readJson(join(paperVersionDir(join(repoRoot, 'plugins'), '1.0.0'), 'themes', 'paper.json'));
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
  for (const mode of ['light', 'dark']) {
    assert.deepEqual(Object.keys(theme[mode]).sort(), [...paletteKeys].sort());
    for (const value of Object.values(theme[mode]))
      assert.match(value, /^#[0-9a-f]{6}$/i);
  }
  const readme = readFileSync(
    join(paperVersionDir(join(repoRoot, 'plugins'), '1.0.0'), 'README.md'),
    'utf8'
  );
  assert.match(readme, /ZIP/);
  assert.match(readme, /Tested surfaces: none/);
  const license = readFileSync(
    join(paperVersionDir(join(repoRoot, 'plugins'), '1.0.0'), 'LICENSE'),
    'utf8'
  );
  assert.match(license, /MIT License/);
});

test('缺少 README 或许可证被拒绝', () => {
  const sources = copyPaperSource(tempDir());
  const dir = paperVersionDir(sources, '1.0.0');
  rmSync(join(dir, 'README.md'));
  assert.throws(() => loadSourcePlugins(sources), /README/);

  const sources2 = copyPaperSource(tempDir());
  rmSync(join(paperVersionDir(sources2, '1.0.0'), 'LICENSE'));
  assert.throws(() => loadSourcePlugins(sources2), /LICENSE/);
});

test('清单 id/版本不匹配、market 元数据错误被拒绝', () => {
  const sources = copyPaperSource(tempDir());
  const manifestPath = join(paperVersionDir(sources, '1.0.0'), 'enso-plugin.json');
  const manifest = readJson(manifestPath);
  manifest.version = '1.0.1';
  writeJson(manifestPath, manifest);
  assert.throws(() => loadSourcePlugins(sources), /清单版本不匹配/);

  const sources2 = copyPaperSource(tempDir());
  const market = readJson(paperMarketPath(sources2));
  market.tier = 'featured';
  writeJson(paperMarketPath(sources2), market);
  assert.throws(() => loadSourcePlugins(sources2), /tier/);

  const sources3 = copyPaperSource(tempDir());
  const manifest3 = readJson(join(paperVersionDir(sources3, '1.0.0'), 'enso-plugin.json'));
  manifest3.unexpected = true;
  writeJson(join(paperVersionDir(sources3, '1.0.0'), 'enso-plugin.json'), manifest3);
  assert.throws(() => loadSourcePlugins(sources3), /未知顶层字段/);

  const sources4 = copyPaperSource(tempDir());
  const market3 = readJson(paperMarketPath(sources4));
  market3.versions['1.0.0'].compatibility.minAppVersion = '0.2.79';
  writeJson(paperMarketPath(sources4), market3);
  assert.throws(() => loadSourcePlugins(sources4), /minAppVersion/);
});

test('未声明的版本目录、符号链接、硬链接和隐藏文件被拒绝', () => {
  const sources = copyPaperSource(tempDir());
  writeJson(join(sources, 'collabra.paper', 'versions', '2.0.0', 'enso-plugin.json'), {
    schemaVersion: 1,
  });
  assert.throws(() => loadSourcePlugins(sources), /未在 market.json 声明/);

  const sources2 = copyPaperSource(tempDir());
  const dir2 = paperVersionDir(sources2, '1.0.0');
  symlinkSync('/etc/passwd', join(dir2, 'escape.txt'));
  assert.throws(() => loadSourcePlugins(sources2), /符号链接/);

  const sources3 = copyPaperSource(tempDir());
  const dir3 = paperVersionDir(sources3, '1.0.0');
  linkSync(join(dir3, 'README.md'), join(dir3, 'README-hardlink.md'));
  assert.throws(() => loadSourcePlugins(sources3), /硬链接/);

  const sources4 = copyPaperSource(tempDir());
  writeFileSync(join(paperVersionDir(sources4, '1.0.0'), '.DS_Store'), 'x');
  assert.throws(() => loadSourcePlugins(sources4), /禁止的文件/);

  const sources5 = copyPaperSource(tempDir());
  const marketPath = paperMarketPath(sources5);
  const target = join(tempDir(), 'outside-market.json');
  writeFileSync(target, readFileSync(marketPath));
  rmSync(marketPath);
  symlinkSync(target, marketPath);
  assert.throws(() => loadSourcePlugins(sources5), /符号链接|普通文件/);
});

test('插件包内出现 node_modules 或额外 .zip 被拒绝', () => {
  const sources = copyPaperSource(tempDir());
  const dir = paperVersionDir(sources, '1.0.0');
  writeFileSync(join(dir, 'bundle.zip'), 'x');
  assert.throws(() => loadSourcePlugins(sources), /禁止的文件/);

  const sources2 = copyPaperSource(tempDir());
  mkdirSync(join(paperVersionDir(sources2, '1.0.0'), 'node_modules'), { recursive: true });
  writeFileSync(join(paperVersionDir(sources2, '1.0.0'), 'node_modules', 'x'), 'x');
  assert.throws(() => loadSourcePlugins(sources2), /node_modules/);

  const sources3 = copyPaperSource(tempDir());
  writeFileSync(join(paperVersionDir(sources3, '1.0.0'), 'native.node'), 'x');
  assert.throws(() => loadSourcePlugins(sources3), /原生/);
});

test('versions 目录或主题父目录为符号链接时拒绝读取外部', () => {
  const sources = copyPaperSource(tempDir());
  const outside = join(tempDir(), 'outside-versions');
  mkdirSync(join(outside, '1.0.0'), { recursive: true });
  writeFileSync(
    join(outside, '1.0.0', 'enso-plugin.json'),
    JSON.stringify({ schemaVersion: 1, id: 'outside.plugin', version: '1.0.0', name: 'x', permissions: [] })
  );
  rmSync(join(sources, 'collabra.paper', 'versions'), { recursive: true, force: true });
  symlinkSync(outside, join(sources, 'collabra.paper', 'versions'));
  assert.throws(() => loadSourcePlugins(sources), /符号链接/);

  const sources2 = copyPaperSource(tempDir());
  const outsideTheme = tempDir();
  writeFileSync(
    join(outsideTheme, 'paper.json'),
    readFileSync(join(paperVersionDir(sources2, '1.0.0'), 'themes', 'paper.json'))
  );
  rmSync(join(paperVersionDir(sources2, '1.0.0'), 'themes'), { recursive: true, force: true });
  symlinkSync(outsideTheme, join(paperVersionDir(sources2, '1.0.0'), 'themes'));
  assert.throws(() => loadSourcePlugins(sources2), /符号链接/);
});

test('JSON 硬链接与缺失的 main 引用被拒绝，错误包含插件 id', () => {
  const sources = copyPaperSource(tempDir());
  const manifestPath = join(paperVersionDir(sources, '1.0.0'), 'enso-plugin.json');
  linkSync(manifestPath, join(paperVersionDir(sources, '1.0.0'), 'manifest-hardlink.json'));
  assert.throws(() => loadSourcePlugins(sources), /硬链接/);

  const sources2 = copyPaperSource(tempDir());
  const manifest2Path = join(paperVersionDir(sources2, '1.0.0'), 'enso-plugin.json');
  const manifest2 = readJson(manifest2Path);
  manifest2.main = 'main.mjs';
  writeJson(manifest2Path, manifest2);
  assert.throws(
    () => loadSourcePlugins(sources2),
    /collabra\.paper@1\.0\.0 清单 main 指向的文件不存在/
  );
});

test('manifest 权限必须属于宿主支持集合', () => {
  assert.equal(SUPPORTED_PERMISSIONS.includes('fs.read'), true);
  assert.equal(SUPPORTED_PERMISSIONS.includes('unknown.permission'), false);
  const sources = copyPaperSource(tempDir());
  const manifestPath = join(paperVersionDir(sources, '1.0.0'), 'enso-plugin.json');
  const manifest = readJson(manifestPath);
  manifest.permissions = ['fs.read', 'unknown.permission'];
  writeJson(manifestPath, manifest);
  assert.throws(() => loadSourcePlugins(sources), /未知权限/);
});

test('包目录深度与目录条目数有独立上限', () => {
  const sources = copyPaperSource(tempDir());
  let dir = paperVersionDir(sources, '1.0.0');
  for (let i = 0; i <= MAX_PACKAGE_DEPTH; i++) {
    dir = join(dir, `d${i}`);
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, 'file.txt'), 'x');
  assert.throws(() => loadSourcePlugins(sources), /深度/);

  const sources2 = copyPaperSource(tempDir());
  const base = paperVersionDir(sources2, '1.0.0');
  for (let i = 0; i < MAX_PACKAGE_DIRECTORIES + 1; i++) {
    mkdirSync(join(base, `dir${i}`), { recursive: true });
  }
  assert.throws(() => loadSourcePlugins(sources2), /目录条目数/);
});
