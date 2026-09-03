# Monet 宿主接入需求 — 截图/录制产物出口定制

> 需求方：Monet（dm-tapnow）画布，经 `input-3d-director` 节点嵌入导演台。
> 状态：R1 / R2 / R3 / R4 / R5 / R6 均已交付且 Monet 已接线（2026-09-03）；R7 待组件方交付。

## 背景

Monet 画布中的导演台节点，用户在导演台内编排场景后，截图/录制产物的去向是 **Monet 画布**（经宿主通道落为独立的 `input-image` / `input-video` 节点，供下游生成节点消费），而非本地下载。导演台是孤立工作台：不接受输入、不产生输出，也不与导出的资源节点建立溯源边。

产物回传通道已就绪（`host.reportCapture` 的 blobUrl 宿主已接：转 File → 上传 OSS → 落画布节点）。本清单只涉及产物出口的 UI 语义与扩展位。

## 需求清单

### R1 截图/录制 Tooltip 可自定义 —— ✅ 已交付并接线

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

- 右侧工具栏始终使用带 tooltip 的纯图标按钮；`label` 只提供可访问名与 tooltip 回落，不渲染为可见文字
- 录制中切换为 `stopLabel`（可定制，缺省「停止录制」）
- 项目菜单是右侧工具栏的最右按钮，桌面端窗口控制扩展排在它左侧

**Monet 接线**：插件仓 `DirectorDesk` 包装层固定注入 tooltip 与可访问名。

### R2 工具栏外部接入按钮位 —— ✅ 机制已交付，「从画布导入」用例作废

**实际形态**（双槽位，均为 `presentation` 入参；项目菜单固定在二者右侧）：

| 槽位                 | 位置                          | 形态   | 用途                  |
| -------------------- | ----------------------------- | ------ | --------------------- |
| `toolbarExtensions`  | 动作区扩展位（截图/录制右侧） | 纯图标 | 宿主业务动作          |
| `trailingExtensions` | 全屏预览右侧、项目菜单左侧    | 纯图标 | 宿主窗口控制（见 R3） |

扩展项契约 `ToolbarExtensionInit`：`key` / `icon` / `label?` / `tooltip?` / `disabled`（支持函数形态响应式求值）/ `onClick`（宿主全接管，组件不附加默认行为）。`label` 仅提供可访问名与 tooltip 回落；空表不渲染、不占位。

**需求变更（2026-09-02）**：Monet 场景资产**使用导演台内置模型库**，不需要「从画布导入 Monet 模型」——原 `import-from-canvas` 用例作废，`host.onImportModel` 宿主接线需求同步取消（保持空操作）。`toolbarExtensions` 当前无消费方，机制保留备用。

### R3 桌面端窗口形态 —— ✅ 已交付（窗口控制接入完成）

**形态**（不变）：desktop 导演台窗口为 headless（`frame: false`），尺寸固定 = Monet 主窗口 contentBounds 并跟随主窗口移动。

**当前接入**：Monet 经 `presentation.trailingExtensions` 注入关闭按钮，按钮进入工具栏布局流，不再以 `fixed` 悬浮遮挡内置控件。该槽位实际位于全屏预览右侧、帮助和项目菜单左侧；严格最右端布局由 R7 解决。

**验收**：

- 窗口无边框，尺寸与主窗口一致，主窗口移动/缩放时实时跟随；主窗口关闭时导演台跟随销毁

### R5 停止导出必须交付视频 —— ✅ 已交付

**落地方式**：工具栏 Stop 调用 `capture.video-stop`，它在当前已完成帧后收口按工程帧率采样的确定性 MP4 导出，并经 `host.reportCapture` 交付产品；`capture.video-cancel` 放弃导出，绝不创建产物。两条路径都会在任务 finally 中复原预览态与循环设置。

**验收**：

- 导出中点击 Stop 后，`host.reportCapture` 恰好收到一次 `kind: "video"` 的 MP4 产物
- Monet 上传后创建独立的 `input-video` 节点，不与导演台建立连线
- 点击明确的 Cancel 才丢弃视频且不创建节点

### R6 Monet 产物出口反馈由宿主接管 —— ✅已交付并接线

**目标**：Monet 场景下，截图或录制成功后只显示 Monet 的单条 Toast（「截图已添加到画布」/「视频已添加到画布」）；导演台内部不得再打开、保留或跳转到产物弹窗/预览面板。

**实际契约**（沿用创建期固定的 `presentation` 入参）：

```tsx
<DirectorDesk
    presentation={{
        captureFeedback: "host", // "default" 保持既有行为；"host" 仅回调宿主
    }}
/>
```

**组件方行为**：

- `captureFeedback: "host"` 时，成功产物只调用一次 `host.reportCapture(product)`，不渲染或打开任何导演台内部产物 UI，也不额外显示成功/失败 Toast。
- `host.reportCapture` 应允许返回 `Promise<void>`；组件方等待其完成，以便宿主能在上传 OSS 和创建资源节点成功后再显示成功 Toast。Promise 拒绝时由宿主显示失败反馈，组件方仅恢复采集状态。
- 未配置或 `captureFeedback: "default"` 时，完全保留现有组件行为，保证非 Monet 宿主向后兼容。

**Monet 已接线**：包装层固定注入 `captureFeedback: "host"`；`reportCapture` 异步完成上传和独立资源节点创建后显示成功 Toast，失败时显示「产物导出到画布失败」。

**验收**：

- 截图与视频各完成一次，Monet 画布各新增一个对应的独立输入节点，均无连接边。
- 每次成功仅出现一条 Monet Toast；导演台内不出现产物弹窗、预览面板或重复 Toast。
- 上传或落节点失败时仅出现一条 Monet 失败 Toast，导演台恢复可继续截图/录制状态。

### R7 宿主窗口控制必须占据工具栏最右端 —— ⏳待组件方交付

**问题**：现有 `trailingExtensions` 的实际顺序是「全屏预览 → trailingExtensions → 帮助 → 项目菜单」。关闭/缩小等宿主窗口控制按钮并不在最右端，无法满足 Monet headless 窗口的操作优先级。

**需求**：在 `presentation` 增加独立的 `rightmostExtensions` 槽位（名称可调整，但语义必须固定）：

- 槽位渲染在所有内置控件之后，视觉顺序为「… → 项目菜单 → rightmostExtensions」；`rightmostExtensions` 的最后一个按钮即工具栏最右元素。
- 复用 `ToolbarExtensionInit` 契约，支持多个纯图标宿主动作；Monet 将在该槽位注入最小化与关闭，关闭始终排在最后。
- `trailingExtensions` 保持现有位置和行为，保证已有宿主向后兼容；不得通过 CSS absolute/fixed 或 DOM 重排由宿主绕过布局。

**验收**：

- Monet 导演台中最小化、关闭依次位于项目菜单右侧，关闭按钮是整个工具栏最右元素。
- 全屏预览、帮助、项目菜单保留现有顺序与功能；窗口控制不遮挡、不随窗口宽度变化漂移。

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
