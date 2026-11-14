import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareVersions,
  isHttpsUrl,
  isNewerVersion,
  isPluginId,
  isReleaseVersion,
  isSafeRelativePath,
  parseVersion,
} from '../scripts/lib/ids.mjs';

test('插件 ID 遵循客户端反向域名规则', () => {
  for (const id of ['collabra.paper', 'enso.example.notes', 'a.b', 'org.example.hello']) {
    assert.equal(isPluginId(id), true, id);
  }
  for (const id of [
    '',
    'Collabra.paper',
    'paper',
    '.paper',
    'paper.',
    '1paper.test',
    'a..b',
    'a/b',
    'a_b.c',
    'org.example.hello-world',
    `a.${'b'.repeat(40)}`,
    null,
    42,
  ]) {
    assert.equal(isPluginId(id), false, String(id));
  }
});

test('版本号只接受严格三段非负整数', () => {
  for (const version of ['0.0.0', '1.0.0', '0.2.80', '10.20.30']) {
    assert.equal(isReleaseVersion(version), true, version);
    assert.deepEqual(parseVersion(version), version.split('.').map(Number));
  }
  for (const version of [
    '',
    '1',
    '1.0',
    '1.0.0.0',
    '01.0.0',
    '1.00.0',
    '1.0.0-beta',
    'v1.0.0',
    ' 1.0.0',
    '1.0.-1',
    '99999999999999999999.0.0',
    null,
  ]) {
    assert.equal(isReleaseVersion(version), false, String(version));
    assert.equal(parseVersion(version), null, String(version));
  }
});

test('版本比较与递增判断', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.throws(() => compareVersions('1.0', '1.0.0'));
});

test('安全相对路径拒绝越界与平台陷阱', () => {
  for (const path of [
    'README.md',
    'themes/paper.json',
    'images/day-1_preview.png',
    'a/b/c.txt',
    '中文/说明.md',
  ]) {
    assert.equal(isSafeRelativePath(path), true, path);
  }
  for (const path of [
    '',
    '.',
    '..',
    '../escape',
    'a/../../escape',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    'C:/Windows',
    'a\\b',
    'a//b',
    'a/./b',
    'a/b\u0000c',
    'a/b\u001fc',
    'a/b:c',
    'a/b?c',
    'a/b*c',
    'a/b<c',
    'trailing.',
    'trailing ',
    'CON',
    'a/NUL.txt',
    `a/${'x'.repeat(300)}`,
    null,
  ]) {
    assert.equal(isSafeRelativePath(path), false, String(path));
  }
});

test('HTTPS 地址只接受无凭据的 https URL', () => {
  assert.equal(isHttpsUrl('https://example.com/a'), true);
  assert.equal(isHttpsUrl('http://example.com/a'), false);
  assert.equal(isHttpsUrl('https://user:pass@example.com/a'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('not a url'), false);
});
