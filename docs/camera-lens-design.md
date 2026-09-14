# 镜头(Camera Lens)设计 —— 焦距、光圈与对焦

> 状态:**领域层与 UI 已交付**;景深渲染**未兑现**(已决策暂缓,见 §5)。
> 命令词汇:`camera.set-lens`(写)、`camera.get-pose` 的 `lens` / `liveFocalLengthMm`(读)。
> 关联:[camera-motion-authoring.md](./camera-motion-authoring.md)(机位与运镜地基)、[ai-control.md](./ai-control.md)(S4 机位语义)。

---

## 1. 命题:导演台需要摄影语言,不只是渲染量

`CameraShot` 原本只有 `fov`。这是渲染器的量,不是摄影师的量——「85mm 人像」
「f/1.4 浅景深」「失焦开场」在模型里无法表达,作者与 AI 只能去换算一个视场角。

镜头这一层要解决的是**词汇错位**:导演说焦距和光圈,系统只认 fov。

## 2. 核心设计:焦距是 fov 的派生视图,不入档

| 量           | 落点                             | 是否持久化                      |
| ------------ | -------------------------------- | ------------------------------- |
| 焦距(mm)     | 由 `CameraShot.fov` 双向换算     | **否**——存两份必然漂移          |
| 光圈(f 值)   | `CameraLens.apertureFStop`       | 是                              |
| 对焦距离(米) | `CameraLens.focusDistanceMeters` | 是(`null` = 自动对焦到注视目标) |

`CameraLens` 只放 **fov 表达不了的光学量**。焦距经 `focalLengthFromFov` /
`fovFromFocalLength` 换算,写入 `camera.set-lens` 时即落成 fov,不另存一份。

三条由此派生的纪律:

1. **换算必须带画幅宽高比**。three 的 `getFilmHeight()` 是 `filmGauge / max(aspect, 1)`,
   同一支 50mm 在 16:9 与 1:1 上垂直视场角不同。宽高比取**项目输出画幅**而非画布尺寸——
   焦距是成片属性,拖编辑窗口不该让标称焦距漂移。
2. **换算口径唯一**。`OutputSettings.aspectRatioFor(canvasSize)` 是唯一入口,
   命令层与检查器读同一处。两份必然漂移出「界面标 50mm、命令按别的画幅算」。
3. **焦距围栏不独立立界**,由 `FOV_MIN`/`FOV_MAX` 经 `focalLengthRangeMm(aspect)` 换算。
   独立立界会出现「焦距合法但换算出的 fov 越界」这种自相矛盾的输入。

`FOV_MIN`/`FOV_MAX` 定义在 `CameraLens` 而非 `CameraShot`:焦距围栏由它派生,
而 `CameraShot` 又要引用 `CameraLens`,反向会形成模块环(两侧都有顶层常量求值,
环上求值顺序不可靠)。`CameraShot` re-export 保持既有调用点不变。

### 2.1 `null` 对焦距离是有意义的取值

`focusDistanceMeters: null` = **自动对焦到注视目标**,这是导演台常态(机位本就由
「位置 + 注视点」定义,对焦面自然落在被摄体上)。显式数值用于「失焦开场」
「对焦转移」这类刻意脱焦的表达。

因此 payload 契约用 `nullable()` 表达,**不拿 `undefined` 兼作两义**——
`undefined` 已经承担「本次不改这个字段」,再兼表「自动」会让「只改光圈」
与「切回自动对焦」在线上无法区分。

## 3. 几何写入不得擦除镜头(踩过的坑)

`camera.set-shot` 的 payload 里 `lens` 是可选的,而摆位手势与坐标/视角输入
**一律只带 `position`/`target`/`fov`**——它们只关心几何。

若按 `CameraShot` 的构造缺省兑现,`lens` 缺省就是 f/2.8 + 自动对焦,于是:

> AI 设了 f/1.4,作者在视口里动一下机位或拖一次 fov 滑杆,光圈与对焦距离静默回默认值。

撤销栈能还原(`invert` 存的是执行前的 `prev.toJSON()`),但作者不会知道自己丢了东西。

**定规:`lens` 缺省 = 保持原镜头,不是回默认值。** 要显式改镜头走 `camera.set-lens`。

收口在命令层而非各调用点:

| 命令                   | 行为                                                   |
| ---------------------- | ------------------------------------------------------ |
| `camera.set-shot`      | `lens` 缺省 → 沿用该 id 现有镜头;机位不存在 → 构造缺省 |
| `camera.frame-subject` | 景别只决定构图几何,覆盖既有机位时保留其镜头            |

堵在命令层的理由:UI 有四个 `set-shot` 派发点(坐标轴、fov 滑杆、掌镜手势稳定点、
落幅当起幅),靠每个调用点「记得带上 lens」是纪律而非机制,新增第五个派发点就会漏。

顺带一处修正:`MotionPresetControls` 的「落幅构图当起幅」原先提交
`landing.shot.toJSON()`(整对象),而落幅预览的 `lens` 本身是构造缺省值——
整对象提交等于用默认值覆盖。改为只提交几何三项。

## 4. UI 入口

机位检查器「机位」tab,`变换` 与 `视野` 之间:

| 控件         | 围栏                           | 落命令                                    |
| ------------ | ------------------------------ | ----------------------------------------- |
| 焦距(mm)     | `focalLengthRangeMm(输出画幅)` | `camera.set-lens { focalLengthMm }`       |
| 光圈(f 值)   | f/0.7 ~ f/22                   | `camera.set-lens { apertureFStop }`       |
| 对焦「自动」 | —                              | `focusDistanceMeters: null`               |
| 对焦距离(米) | 0.05 ~ 500                     | `camera.set-lens { focusDistanceMeters }` |
| 焦距预设     | 24 / 35 / 50 / 85mm            | 同焦距字段                                |

与 AI 共用同一条命令路径(红线 8)。两个交互决定:

- **焦距与 fov 是同一个量的两个视图**,并存而非取代:fov 滑杆保留粗调手感,
  焦距字段管精确标称。区标题因此从「镜头」改叫「视野」,与新增的「镜头」区区分。
- **关掉「自动」时落机位到注视点的距离**(自动对焦本就对在那个面上),
  并夹进命令围栏——贴脸机位的真实距离可能小于 0.05m 下界,不夹会让「关掉自动」
  这一步直接被命令拒掉。

焦距预设取摄影常用档而非均分刻度:24 广角带环境 / 35 纪实 / 50 近人眼 /
85 人像特写压缩背景。作者按叙事挑档比拖连续滑杆更快到位;数值仍经命令围栏,
预设只是入口。

## 5. 景深未兑现(已决策)

光圈与对焦距离目前是**成片意图**:随工程往返、AI 可读回校验,但预览与截图
**不渲染虚化**。景深要落到画面需要后处理通道,而 `gl.render` 有四个调用点
(截图、MP4 逐帧导出、画面度量、helper 复原重绘),换成 composer 会让确定性导出
与 `capture.measure-frame` 的度量基线全部需要重新验收。

**决策:暂不做,UI 明说。** 镜头区底部一行说明这是意图而非已兑现效果——
否则作者调 f/1.4 画面纹丝不动,会当成 bug。

重新评估时的三条路(按改动面排序):

1. `postprocessing` + `@react-three/postprocessing`,四处 `gl.render` 换 `composer.render`,
   并给档位开关(红线 14:凡影响性能必可关);
2. 自绘单通道 CoC 模糊 pass,不加依赖但要自己维护着色器与深度纹理;
3. 维持意图态,只在导出到外部渲染器时兑现。

## 6. 文档兼容

机位 `toJSON()` 增 `lens`,`DESK_DOCUMENT_VERSION` 22 → 23,
`shotIssues` 要求 `lens` 存在,**旧档判不支持**(零兼容阶段不写迁移器)。
判据见 `AGENTS.md` 红线 11。

## 7. 已知缺口

| 缺口                       | 影响                                              |
| -------------------------- | ------------------------------------------------- |
| `CameraKey` 不带 lens      | 光圈/对焦不可动画化,「对焦转移」在运镜层无承载    |
| `ShotSizePresets` 只给 fov | `camera.frame-subject` 新建的机位一律构造缺省镜头 |
| 景深未渲染                 | 见 §5                                             |

第一条是最有实际收益的下一步:「对焦转移」是 `camera.set-lens` 立项时就点名的用例,
但它天然是时序表达,只有进 `CameraKey` 才能落地。代价是 key 的 payload 与文档结构同批变更。
