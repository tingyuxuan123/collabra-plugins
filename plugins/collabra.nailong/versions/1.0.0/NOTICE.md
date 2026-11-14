# 来源记录

本包是主题的 Collabra 适配版，社区收录，不是角色权利方的官方插件。以下只记录事实。

## 素材来源

- 上游插件：`enso.nailong` 0.1.2，仓库
  <https://github.com/J3n5en/enso-plugins>，固定快照 commit
  `6fb08f3a96a12ce7d9bd03534347bd9d96d9e04f`（2026-11-05，
  `fix(nailong): 探头改挂到 task 和 todo 上面，升到 0.1.2`）。
- 该版本是上游 `packages/enso.nailong` 在该 commit 的内容；
  `enso-plugin.json`、`themes/nailong.json`、`themes/nailong.css`、`icon.svg` 与
  `themes/assets/*` 均按字节沿用，未做图像处理或重新编码。
- 与上游 0.1.2 的差异只有 CSS（挂点、全局覆盖、紧凑窗口规则）与清单 id / 版本号。

## 上游许可声明（事实记录，不做解释性扩展）

- 上游仓库根目录没有 LICENSE；`packages/enso.nailong/` 内没有 LICENSE / NOTICE；
  `enso-plugin.json` 没有 `license` 字段。
- 上游 0.1.2 的 README 没有素材许可段，正文提到素材取自「官网 3D 形象」、
  「官网字标」、「暴暴龙」表情与官网白云。
- `themes/assets/rounded-medium.woff2` 在上游包内没有附许可文件。本包删除了对它的
  `@font-face` 引用，因此**不再分发该字体文件**。

## 本包改了什么（代码层）

- 删除 `@font-face` 与 `:root{--font-family-sans}`：不替换宿主字体。
- 删除 `:root{--radius: 0.875rem}`：不改全局圆角。
- 失效挂点按 Collabra 真实 DOM 重写（README 有对照说明）。
- 新增宿主窗口护栏 `:has([data-enso="sidebar"])` / `[data-slot="chat-view"]`。
- 新增紧凑窗口媒体查询 `@media (max-height: 680px), (max-width: 960px)`：只在该条件下
  不画输入框外探头、右侧面板角落大图和空时间线大背景/欢迎动图，素材文件未删除。

## 许可边界

- `LICENSE` 的 MIT 只覆盖本包作者撰写的适配文件（CSS、README、NOTICE）。
- 角色形象与上游素材的权利归各自权利人所有；本 NOTICE 不对其再分发许可作任何断言。
