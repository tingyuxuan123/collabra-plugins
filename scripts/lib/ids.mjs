import { MAX_PLUGIN_ID_LENGTH } from './constants.mjs';

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const RELEASE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export const isPluginId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_PLUGIN_ID_LENGTH &&
  PLUGIN_ID.test(value);

/** Strict three-integer release version, as required by the signed v2 index. */
export const isReleaseVersion = (value) => {
  if (typeof value !== 'string' || !RELEASE_VERSION.test(value)) return false;
  return value.split('.').every((part) => Number.isSafeInteger(Number(part)));
};

export function parseVersion(value) {
  if (!isReleaseVersion(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`不是严格版本号：${a} / ${b}`);
  for (let i = 0; i < 3; i++) {
    const diff = left[i] - right[i];
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export const isNewerVersion = (candidate, current) => compareVersions(candidate, current) > 0;

/**
 * Safe package/index relative path. Rejects traversal, absolute paths, drive
 * letters, backslashes, control characters and Windows-reserved names.
 */
export function isSafeRelativePath(value, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes('//')) return false;
  for (const segment of value.split('/')) {
    if (!segment) return false;
    if (!allowDot && (segment === '.' || segment === '..')) return false;
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;
    if (/[<>:"|?*#]/.test(segment)) return false;
    if (WINDOWS_RESERVED.test(segment)) return false;
  }
  return true;
}

export const isHttpsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};
