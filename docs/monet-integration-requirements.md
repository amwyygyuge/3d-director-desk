# Monet 宿主接入需求 — 截图/录制产物出口定制

> 需求方：Monet（dm-tapnow）画布，经 `input-3d-director` 节点嵌入导演台。
> 状态：R1 / R2 / R3 / R4 / R5 组件方已交付且 Monet 已接线（2026-09-02）。

## 背景

Monet 画布中的导演台节点，用户在导演台内编排场景后，截图/录制产物的去向是 **Monet 画布**（经宿主通道落为 `input-image` / `input-video` 节点，供下游生成节点消费），而非本地下载。

产物回传通道已就绪（`host.reportCapture` 的 blobUrl 宿主已接：转 File → 上传 OSS → 落画布节点）。本清单只涉及 **产物出口的 UI 语义与扩展位**。

## 需求清单

### R1 截图/录制按钮文案可自定义 —— ✅ 已交付并接线

**实际形态**（组件方 API：`DirectorDeskProps.presentation`，创建期注入、运行期不变）：

```tsx
<DirectorDesk
    presentation={{
        captureImage: { label: "截图到画布", tooltip: "截图并添加到画布" },
        captureVideo: { label: "录制到画布", tooltip: "录制并添加到画布" },
    }}
/>
```

**行为**：

- 传 `label` 后按钮呈「图标 + 文字」可见形态，tooltip 同步替换；录制中切换为 `stopLabel`（可定制，缺省「停止录制」）
- 不传保持纯图标默认态（向后兼容）

**Monet 接线**：插件仓 `DirectorDesk` 包装层固定注入上述文案。即 Monet 用户视角的「导图到节点 / 导视频到节点」按钮 = 工具栏采集区的截图 / 录制按钮（图标 + 文字形态，不再需要凭图标猜测）。

### R2 工具栏外部接入按钮位 —— ✅ 机制已交付，「从画布导入」用例作废

**实际形态**（双槽位，均为 `presentation` 入参）：

| 槽位                 | 位置                          | 形态               | 用途                  |
| -------------------- | ----------------------------- | ------------------ | --------------------- |
| `toolbarExtensions`  | 动作区扩展位（截图/录制右侧） | 图标+文字 / 纯图标 | 宿主业务动作          |
| `trailingExtensions` | 最右扩展位（全屏预览右侧）    | 纯图标             | 宿主窗口控制（见 R3） |

扩展项契约 `ToolbarExtensionInit`：`key` / `icon` / `label?` / `tooltip?` / `disabled`（支持函数形态响应式求值）/ `onClick`（宿主全接管，组件不附加默认行为）；空表不渲染、不占位。

**需求变更（2026-09-02）**：Monet 场景资产**使用导演台内置模型库**，不需要「从画布导入 Monet 模型」——原 `import-from-canvas` 用例作废，`host.onImportModel` 宿主接线需求同步取消（保持空操作）。`toolbarExtensions` 当前无消费方，机制保留备用。

### R3 桌面端窗口形态 —— ✅ 已交付（窗口控制实现方式修订）

**形态**（不变）：desktop 导演台窗口为 headless（`frame: false`），尺寸固定 = Monet 主窗口 contentBounds 并跟随主窗口移动。

**窗口控制实现修订（2026-09-02）**：Monet 最初在 `/director` 页面以 `fixed` 悬浮注入缩小/关闭按钮，实测与工具栏右侧「全屏预览」按钮**重叠遮挡**。现修订为：

- Monet 经 `presentation.trailingExtensions` 注入缩小/关闭（纯图标），按钮进入工具栏布局流，排在「全屏预览」右侧——**从结构上杜绝遮挡**，无需组件方预留空间
- 页面侧不再 fixed 注入任何窗口控制浮层
- 组件方零改动（`trailingExtensions` 槽位即为此场景预留）

**验收**（Monet 侧自查）：

- 缩小/关闭按钮位于工具栏最右，与内置按钮同区同风格，不遮挡「全屏预览」
- 窗口无边框，尺寸与主窗口一致，主窗口移动/缩放时实时跟随；主窗口关闭时导演台跟随销毁

### R5 停止导出必须交付视频 —— ✅ 已交付

**落地方式**：工具栏 Stop 调用 `capture.video-stop`，它在当前已完成帧后收口按工程帧率采样的确定性 MP4 导出，并经 `host.reportCapture` 交付产品；`capture.video-cancel` 放弃导出，绝不创建产物。两条路径都会在任务 finally 中复原预览态与循环设置。

**验收**：

- 导出中点击 Stop 后，`host.reportCapture` 恰好收到一次 `kind: "video"` 的 MP4 产物
- Monet 上传后创建 `input-video` 节点，并与导演台建立溯源边
- 点击明确的 Cancel 才丢弃视频且不创建节点

### CAPTURE_PRODUCED 产物协议（破坏性变更）

`director-desk:capture-produced` 的 payload 已改为带类型的 `CaptureProduct`。旧的 `{ blobUrl, width, height, requestId }` 形状不再受支持；Monet 必须读取下列字段：

| 字段              | 说明                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `kind`            | `"image"` 或 `"video"`；据此分别创建 `input-image` / `input-video` 节点 |
| `mimeType`        | 浏览器实际编码的 MIME，例如 `image/png` 或 `video/mp4`                  |
| `durationSeconds` | 视频实际导出秒数；截图为 `null`                                         |

其余 `blobUrl`、`width`、`height`、`requestId` 字段保持为产品值对象的一部分。

### R4 内置资产目录混入测试资产引用 —— ✅ 已修复（2026-09-02）

`builtin.fox` 已从 `public/builtin-assets/catalog.json` 移除。狐狸模型仅保留为 Storybook 播种资产，内置资产目录现在只声明并承载 `/builtin-assets/**` 下的资源。

**验收**：catalog 内全部条目 `url` 均为 `/builtin-assets/` 前缀；Monet 环境资产面板所有条目可正常加载。

## 宿主供给契约（Monet 侧已实现，2026-09-02）

组件方以下两处**源站根路径硬编码**构成宿主供给契约，Monet 已按约挂载；组件方若调整路径（或改为可配置 baseUrl）需同步通知 Monet：

| 路径                          | 内容                                    | Monet 挂载方式                                                                                                                      |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/builtin-assets/**`          | 内置资产目录（catalog.json + 条目文件） | 前端 `public/builtin-assets` 软链 → 组件方 `public/builtin-assets`；dev 经 vite 直出，prod 由 vite build 解引用拷入 dist 随前端发布 |
| `/3d-director-desk/style.css` | 组件方样式产物                          | 前端 `public/3d-director-desk/style.css` 软链 → 组件方 `dist/style.css`（既有机制，经 `vendorAssets.resolve` 运行时注入）           |

> 「没有模型」问题根因即首行契约未挂载：`BuiltinAssetProvider` 固定 fetch 源站根 `/builtin-assets/catalog.json`，宿主未供给时静默失败（catch → 空目录）。Monet 挂载后已实测 4 条内置资产全部可达（catalog `application/json` 200，glb/gltf 字节级 200）。

## 边界说明

- 本清单只涉及 UI 出口层；产物数据通道（reportCapture）与命令层均已具备，不在范围内
- 截图/视频导出的**能力触发**本身（capture / exportVideo）由组件方提供，Monet 只定制文案与扩展位落位
