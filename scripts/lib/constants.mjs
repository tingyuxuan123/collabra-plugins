/** Frozen v1 market contract constants. Keep in sync with SPEC.md. */
export const MARKET_ID = 'collabra';
export const SCHEMA_VERSION = 2;
export const HOST = 'collabra';
export const MARKET_API_VERSION = 1;
export const MIN_APP_VERSION = '0.2.80';

export const PLATFORMS = ['darwin', 'win32', 'linux'];
export const TESTED_SURFACES = ['code', 'bot', 'image-studio', 'taskboard', 'design', 'settings'];
export const MARKET_CATEGORIES = [
  'themes',
  'agent',
  'productivity',
  'integrations',
  'insights',
  'writing',
  'fun',
];
export const TIERS = ['official', 'community'];

/** SHA-256 of the pinned SPKI DER for market-public-key.pem. */
export const PRODUCTION_KEY_FINGERPRINT =
  '731611380199cd338bbb3fcde8ef6f8bf9d7085c56ebe45374af057591f55bd4';

export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
export const MAX_LEDGER_BYTES = 64 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 500000;
export const MAX_HISTORY_DEPTH = 100;
export const MAX_HISTORY_GENERATIONS = 100000;
export const MAX_PACKAGE_FILES = 5000;
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
export const MAX_PACKAGE_DEPTH = 32;
export const MAX_PACKAGE_DIRECTORIES = 512;
export const MAX_PACKAGE_ENTRIES = 6000;
export const MAX_README_BYTES = 256 * 1024;
export const MAX_MANIFEST_BYTES = 256 * 1024;
/** 插件图标：只接受包内声明的位图/SVG，单文件上限 512KB。 */
export const MAX_ICON_BYTES = 512 * 1024;
export const ICON_EXTENSIONS = ['svg', 'png', 'webp', 'gif', 'jpg', 'jpeg'];
export const MAX_PLUGIN_ID_LENGTH = 40;

export const packagePath = (id, version) => `packages/${id}/${version}.zip`;
export const readmePath = (id, version) => `readmes/${id}/${version}.md`;
/**
 * 图标在 v1/ 下的安全相对路径。客户端市场列表按同源 https 解析这条路径
 * （`marketIconUrl`），所以这里必须留在 `media/` 下，不允许外链。
 */
export const mediaPath = (id, version, file) => `media/${id}/${version}/${file}`;

/** Client manifest permission vocabulary; the publisher stays closed over it. */
export const SUPPORTED_PERMISSIONS = [
  'agent.tool',
  'ui.slot',
  'ui.view',
  'ui.notify',
  'composer.draft',
  'fs.read',
  'fs.write',
  'net.fetch',
  'mcp.server',
  'mcp.call',
  'agent.observe',
  'agent.intercept',
  'agent.inject',
  'process.background',
  'plugin.call',
  'ui.clipboard',
  'ui.openExternal',
  'session.read',
  'session.readAll',
  'session.focus',
  'session.create',
];

export const HISTORY_LEDGER_SCHEMA_VERSION = 1;
export const historySnapshotPath = (sequence) => `history/${sequence}.json`;
export const historySnapshotSignaturePath = (sequence) => `history/${sequence}.json.sig`;
export const historyLedgerPath = (sequence) => `history/${sequence}.ledger.json`;
export const historyLedgerSignaturePath = (sequence) =>
  `history/${sequence}.ledger.json.sig`;
