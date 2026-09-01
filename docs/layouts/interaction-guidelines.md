# 3D Director Desk — 界面交互与设计规范 (UI/UX Guidelines)

基于最新的“综合悬浮工作流 (方案D)”，本规范定义了 3D 导演台界面的整体结构、视觉原则与交互逻辑，作为后续组件开发的准则。

---

## 一、 整体版图与架构 (Layout & Architecture)

核心理念是 **Liquid UI（液态/悬浮界面）** + **Content First（内容优先）**。放弃传统的四边形包裹窗口，将 3D 画布引擎铺满全屏作为底层，所有的 UI 控件如漂浮的岛屿覆盖其上。

### 1. 空间层级 (Z-Index Hierarchy)
* **Z: 0 (底层)**：全屏的 3D Viewport (`Canvas`)，接收全局的平移、缩放、旋转指令。
* **Z: 10 (基底 UI)**：安全区边界、视口操作提示，以及一些弱视觉的角落水印。
* **Z: 20 (悬浮面板)**：顶部的药丸工具栏（Pills）、左侧可展开的大纲库、右侧动态属性面板。
* **Z: 30 (编排中枢)**：底部时间线控制台，能够跨层级推拉展开。

### 2. 交互阻断原则 (Pointer Events)
必须使用原生的 `pointer-events: none` 来管理鼠标穿透。UI 的根容器**不应吃掉全局点击**。
* 底层容器必须放行鼠标事件：`pointer-events-none`。
* 在具体的药丸按钮、悬浮面板本身重新声明拦截：`pointer-events-auto`。
* 这样用户可以在两个浮窗中间的“空隙”拖拽镜头，实现无缝操作。

---

## 二、 悬浮四区的具体防干扰与交互 (Zones)

### 1. 顶部：极简操控中枢 (Top Pills)
* **位置**：紧贴顶部安全区边缘，横向分为左、中、右三个胶囊/药丸（Pill）模块。
* **左侧 Pill**：全局入口与项目标识。点击汉堡包图标拉出全局菜单（保存、导出、设定）。
* **中部 Pill**：视口高频控制区。核心是用来切换 **导演视图 (Render Cam)** 与 **漫游视图 (Free Cam)**。
* **右侧 Pill**：撤销/重做、截图、以及高亮的“全屏预览播放”按钮。
* **动效**：按钮 Hover 状态下应有明确的白膜反馈（`hover:bg-white/10`）。

### 2. 左侧：抽屉式资产中枢 (Left Drawer)
* **问题**：在 3D 软件中，图层树和库通常很长，非常占屏幕。
* **交互 (Hover-to-Expand)**：平时收缩为只有 `3.5rem` 宽的纯图标竖列（大纲、相机、模型、灯光、动作）。当用户鼠标移入该区域时触发平滑的 `width` 过渡，向右弹出至 `15rem` 的抽屉。
* **逻辑**：展开后，鼠标离开区域，抽屉应有一定的延迟（如 200ms）再收起，避免用户误触滑回。点击具体的菜单项后，可以在抽屉旁边引出二级的细分列表（如具体的模型缩略图）。

### 3. 右侧：情境感知检查器 (Context-Aware Inspector)
* **逻辑**：它不是一个万能侧边栏。当没有对象选中时，或者用户双击画布空白处时，这个面板应该**完全消失**（或透明度降至极低）。
* **出现触发**：在视口或大纲中点击了一个机位/模型。右侧面板从右向左浮现。
* **内容组织**：
  * **选相机**：展示焦距 (FOV)、光圈、聚焦对象跟踪开关，以及坐标 (Transform)。
  * **选角色**：展示当前赋予的动作片段 (Motion Clip)、循环设置，以及坐标。
* **交互点**：
  * 面板带有关闭按钮 (`✕`) 允许用户强制退回极简模式。
  * 数值输入框不应仅仅是键盘输入，必须支持**按住并左右拖动**来实时阻尼微调数值。

### 4. 底部：折叠态时间线 (Folding Timeline)
* **平时状态 (Mini Player)**：高度压缩在 `3.5rem` (`h-14`)。表现为一个优雅的播放条，展示播放控件、中央时间码，以及一个微缩的轨道波形（仅显示红色的 Playhead 与非常小的关键帧点指示）。
* **展开交互 (Push-up)**：用户鼠标向下滑入并停留（或点击向上的箭头把手），面板像窗帘一样向上推起（至 `16rem` 或更高），呈现专业的时间线网格。
* **专业编排**：
  * 左侧为轨道头（Track Headers），显示运镜轨道与动作轨道。
  * 右侧横向滚动时间网格。按住空格/滚轮应对齐实现平移 (Pan) 与缩放 (Zoom)。

---

## 三、 视觉语言与组件风格 (Visual Language)

### 1. 材质设定 (Glassmorphism)
我们选用较深沉的亚克力毛玻璃风格来衬托 3D 的光影。
* **基底**：`bg-[#16171a]` 或 `rgba(22, 23, 26, 0.7)`
* **模糊**：`backdrop-blur-2xl` 到 `3xl` 级别（推荐 `blur(28px)`）。
* **外轮廓**：必须使用白色的极细边框提神 `border border-white/10` 或 `rgba(255,255,255,0.08)`。
* **自发光投影**：主面板和关键按钮下方需要一圈深邃的大阴影防混合，如 `shadow-[0_10px_50px_rgba(0,0,0,0.5)]`。

### 2. 品牌色与状态色
* **主体色调**：**Indigo (靛蓝)**，取代传统的亮蓝色。作为轨道高亮、活动相机标识。如 Tailwind 中的 `indigo-500` (`#6366f1`)。
* **运镜与关键帧**：运镜轨迹属于空间信息，相关指示（游标、折线）使用 Indigo。
* **动作片段**：属于时间段信息（Clips），使用较纯正的 **Blue** (`blue-500`) 或 **Cyan** 填充。
* **播放中轴 (Playhead)**：醒目的 **Red** (`red-500`)，以保证在复杂的暗色网格中一眼锁定当前帧。

### 3. 表单与排版 (Typography)
* **微观字号**：为了贴近专业创作软件的密度，属性板中的 Label (如 Transform, Lens) 使用 `10px` 到 `11px`，开启全大写 `uppercase` 和拉宽字距 `tracking-widest`，字重加粗，颜色使用极灰 `text-gray-500`。
* **数值防跳**：播放条的时间码 (`00:04:15`)、Transform 坐标系 (`X: 1.24`) 等所有随时间/拖拽改变的数字，必须强制设定为**等宽字体 (`font-mono`)**。

---

## 四、 键盘与快捷交互 (Keyboard & Shortcuts)

对于桌面端的 Web 应用，快捷键是工作流及格线。
1. **播放控制**：全局监听 `Space` 键（空格）启停播放。
2. **打点触发**：当位于主摄像机视图时，移动视角，按下 `K` 键（或特定的记录键）立即在当前 Playhead 位置打上一个 Transform 关键帧。
3. **取消选择**：按 `Esc` 键清除当前对象选择，关闭右侧检查器，视口重归纯净。
4. **工具切换**：参照传统软件，`W` (Translate), `E` (Rotate) 用来切换激活选中的骨骼/对象的控制 Gizmo 模式。

### 五、 后续开发建议

这套 UI 设计（方案 D）对于 React 状态链路提出了要求：由于 UI 面板高度依赖当前是否选中对象、是否处于播放状态，我们必须依赖现有的 MobX Store（如 `SelectionStore`, `TimelineStore`）通过 `@observer` 直接驱动这四个区域的组件显示层级与动画。应确保动画采用 CSS Transition 处理（如使用通过状态控制 `className` 变动），以此保证渲染帧数不受 JS 重绘拖累。

---

## 六、 落地映射与偏差记录 (Implementation)

本规范已按方案 D 落地。以下是规范条目到代码的对应关系,以及与规范字面不同的六处决策与理由。

### 1. 组件与状态映射

| 规范区域 | 组件 | 驱动状态 |
|---|---|---|
| 顶部药丸(左:项目 / 右:输出) | `src/ui/workspace/TopPillBar.tsx` | `UiStore.gizmoMode`、`CommandHistory`、`UiStore.videoRecording` |
| 左侧抽屉 | `src/ui/workspace/AssetRail.tsx` | `WorkbenchLayoutStore.railSection` + 纯 CSS `:hover` 宽度切换 |
| 右侧检查器 | `src/ui/workspace/InspectorSheet.tsx` | `SelectionStore.primaryId` |
| 底部时间线 | `src/ui/workspace/TimelineConsole.tsx` | `WorkbenchLayoutStore.timelinePinned` + `useHoverIntent` 局部瞬时态 |
| 表面材质 | `src/ui/shell/theme.ts` | MUI `Paper` 的 `pill` / `panel` 变体(不用 Tailwind 写视觉) |

大纲(`ui/outline/OutlinerPanel`)是机位与场景实体的统一索引:两组各绑一个数据源
(`CameraDirector` / `SceneManager`),共享同一份 `SelectionStore`。
机位的选中、进出机位视图、删除只有这一个入口,机位面板不再重复列一份(Rule of Two)。
通用外壳 `ui/outline/OutlineRow`、`ui/outline/OutlineSection` 无领域身份,按叶子例外收值;
领域行 `ShotOutlineRow` / `EntityOutlineRow` 各自 `observer` 自取状态。

壳层显隐的唯一开关是 `WorkbenchLayoutStore.authoringVisible`,悬浮四区与场景辅助物
(机位标记、灯光标记、运镜轨迹、地面网格)共用它——全屏预览时画面只剩成片内容。

### 2. 偏差:`Space` 不做播放启停,改用 `P`

规范 §四.1 要求全局 `Space` 启停播放,但 `Space` 已被飞行导航长期占用
(`useFlyNavigation` 的 WASD+Space/Shift 升降,自由视角与掌镜都生效,且掌镜提示里已公示)。
双绑会让"抬升相机"与"启停时间轴"同时触发。播放启停因此绑 `P`,全屏预览绑 `Shift+P`。

### 3. 偏差:废除工作区阶段,预览模式接管 Program 回放

旧 `WorkspaceStage`(布景/运镜/成片)既管工具组显隐,又暗中门控"Program 输出是否写入
R3F 相机"这一运行时行为。方案 D 的顶部中区留给视图模式后阶段无处安放,故整体废除:
工具常驻,辅助物按 `authoringVisible` 显隐,而 Program 回放绑定归位到真正表达它的概念——
全屏预览(`desk.enter-presentation` / `desk.exit-presentation`)。

### 4. 偏差:顶部只剩两块药丸,中部药丸整体取消

规范草图的中部药丸是「导演视图 (Render Cam) / 漫游 (Free Cam)」二态。两个问题:
一是词汇与代码相反——代码里"导演视角"历来指自由轨道编辑视角;
二是这组按钮是重复入口——选中机位后 `Enter`(或双击机位标记)即进入,`Esc` 即退出,
两条路径都在 `ViewportInteractionHints` 常驻提示里。

去掉视图二态后中部只剩 gizmo 三态,不值得单占一块药丸,已并入右侧输出药丸的正中:
`撤销/重做 │ 移动/旋转/缩放 │ 截图/录制 │ 全屏预览`。
三态用与同排一致的 `IconButton` 渲染(激活态只以主色区分),不套 `ToggleButtonGroup`——
后者自带描边圆角,嵌在药丸里会形成"胶囊套胶囊"的双重样式。
顶部中间空出来的位置留给提示条(见下条)。

### 5. 偏差:时间线 hover 展开带延迟,并让位左右两区

规范 §二.4 的原型用纯 CSS `:hover` 展开,鼠标划过屏幕底部就会弹起遮画面。
实现改为进入停留 200ms 才展开、离开 400ms 才收起,把手点击可钉住(钉住后不自动收起)。
悬浮岛在左栏与检查器之间居中:检查器出现时整条左移,两块面板不互相压盖。

提示条(命令失败与常驻操作提示)统一收敛为 `ui/workspace/ViewportToast`,停在顶部药丸条正下方
(`top: 76px`)、水平居中、文案居中,外观走 `panel` 变体。MUI 默认的 bottom center 会压在
时间线控制台上;默认的 `SnackbarContent` 在暗色主题下是反色浅底,与整套壳层割裂。
注意 MUI 在 `sm` 断点里另给 `anchorOriginTopCenter` 一个 `top`,`sx` 必须用响应式对象覆盖,
单值写法会被它盖掉。

### 补充:渲染画质开关(唯一影响成片质量的性能杠杆)

`WorkbenchLayoutStore.renderQuality` 二档,入口在项目菜单:

| 档位 | `dpr` | `antialias` | 说明 |
|---|---|---|---|
| 高画质(默认) | `[1, 2]` | `true` | retina 满分辨率 + MSAA |
| 高性能 | `[1, 1.5]` | `false` | 限像素比、关 MSAA,换帧率 |

`antialias` 是 WebGL 上下文属性,只能靠重建上下文切换,故 `<Canvas key={renderQuality}>`。
切档会重挂画布:场景实体、机位、时间轴均由 store 持有,重挂后自动重建运行时,已实测无丢失。
**这两项影响截图与录制成片的画质**,故不做成隐式优化,由用户显式选择。

### 6. 偏差:不做毛玻璃,不做布局过渡(性能优先级高于视觉)

规范 §三.1 要求 `backdrop-blur` 亚克力材质、§五 建议用 CSS Transition 做展开动画。
两者都在活动的 WebGL 画布上代价高昂,已按「性能第一」的决策取消:

| 规范要求 | 实际做法 | 原因 |
|---|---|---|
| `backdrop-filter: blur(28px)` | 不透明底色 `#1e1f22` / `#161719` | 画布每帧重绘都要求合成器重新读回并模糊背景;播放期 60fps × 四块壳层 |
| `shadow-[0_10px_50px]` | `0 2px 8px` | 大半径阴影同样按层重绘计价 |
| width / height / padding 过渡 | 直接切换,无过渡 | 这三个属性无法交给合成器,过渡期每帧重排,与画布渲染叠加 |
| — | 保留 `opacity` 过渡 | 只有 opacity 是纯合成属性,零重排 |

壳层另加 `contain: layout paint`,把脏区限制在面板自身。

### 7. 播放期重渲染纪律(踩过的坑)

`playhead` 是帧级 observable(经 `PlayheadDisplay` 节流到 12Hz)。最初 `TimelineConsole`
与 `TimelinePanel` 在组件顶层直读它、再把值当 props 传给子组件,结果整张轨道网格
每秒重建 12 次。修法是把读 playhead 的位置收敛到叶子:
`MiniPlayhead` / `TimecodeReadout` / `RulerPlayhead` / `ProgramCutInButton` 各自 `useDirectorDeskStores()` 自取,
父组件一行都不读。收起态更进一步——不挂载 `TimelinePanel`。

实测(Storybook,双机位 Program 播放中,3 秒采样):

| 状态 | DOM 节点增删 | 属性/文本变更 | 帧间隔中位数 |
|---|---|---|---|
| 时间线收起 | 0 | 72(= 12Hz × 2 处) | 16.6ms |
| 时间线展开 | 0 | 108(= 12Hz × 3 处) | 16.6ms |

节点增删为 0 是这条纪律的验收线:播放期不允许有任何 DOM 结构重建。
详细规则见 [state-management.md 的「props 边界纪律」](../state-management.md)。