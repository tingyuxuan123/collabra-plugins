# 来源记录

本包是主题的 Collabra 适配版，社区收录，不是角色权利方的官方插件。以下只记录事实。

## 素材来源

- 上游插件：`enso.naiwa` 0.1.2，仓库
  <https://github.com/J3n5en/enso-plugins>，固定快照 commit
  `bb796a9942368db6740ee557aeb8ac4e8cbebb02`（2026-11-06，
  `fix(naiwa): 输入框探头只挂在装着输入框的列…，升到 0.1.2`）。
- 该版本是上游 `packages/enso.naiwa` 在该 commit 的内容；
  `enso-plugin.json`、`themes/naiwa.json`、`themes/naiwa.css`、`icon.svg` 与
  `themes/assets/*` 均按字节沿用，未做图像处理或重新编码。
- 与上游 0.1.2 的差异只有 CSS（挂点、全局覆盖、紧凑窗口规则）与清单 id / 版本号。
- 上游 0.1.2 的 README 带一张素材表，逐项列出同人仓库
  （`Nailong-Studio/NaiWa-Wallpaper`、`Maple498/nai-wa-codex-pet`、
  `sandytruant/codex-pet-naiwa`、`liaosongjie/Codex-Voice-Input`、
  `DevourerM/dsh-naiwa-theme`）与各自声明的 MIT / CC BY 4.0。此处只转述该表的
  存在与内容，不对授权范围作判断。

## 上游许可声明（事实记录，不做解释性扩展）

- 上游仓库根目录没有 LICENSE；`packages/enso.naiwa/` 内没有 LICENSE / NOTICE；
  `enso-plugin.json` 没有 `license` 字段。

## 本包改了什么（代码层）

- 删除 `:root{--radius: 0.875rem}`：不改全局圆角。上游 0.1.2 没有覆盖字体，
  本包也不加。
- 失效挂点按 Collabra 真实 DOM 重写（README 有对照说明）。
- 新增宿主窗口护栏 `:has([data-enso="sidebar"])` / `[data-slot="chat-view"]`。
- 新增紧凑窗口媒体查询 `@media (max-height: 680px), (max-width: 960px)`：只在该条件下
  不画输入框外探头、右侧面板角落大图和空时间线大背景/欢迎动图，素材文件未删除。

## 许可边界

- `LICENSE` 的 MIT 只覆盖本包作者撰写的适配文件（CSS、README、NOTICE）。
- 角色形象与上游素材的权利归各自权利人所有；本 NOTICE 不对其再分发许可作任何断言。

## 版本记录（本包自身）

- 1.0.0：首个市场版本，兼容元数据声明 macOS / 最低 `0.2.81`（当时验收客户端的版本）。
- 1.0.1：只改市场兼容元数据（`platforms` 增加 Windows，最低版本仍是 `0.2.81`）；
  包内 CSS、素材与图标与 1.0.0 逐字节一致，未做素材替换或重新编码。
