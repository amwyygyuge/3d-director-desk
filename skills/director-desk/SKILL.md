---
name: director-desk
description: 驱动 3D 导演台(布景/动作/时间轴/运镜/灯光/截图)完成分镜搭建与参考成片。当任务涉及操作导演台页面、摆放 3D 模型、挂载动作、编排时间轴、设计运镜、打光或导出参考帧时使用。
---

# Director Desk 驱动手册

导演台是一个嵌入页面的 3D 分镜工具。你**不点 UI**，一切通过页面上的 `window.__directorDesk` 句柄用 JS 完成。

## 心智模型(三条铁律)

1. **写操作只走命令层**:`__directorDesk.dispatcher.dispatch({ type, payload }, __directorDesk)`。禁止直写任何 store/实体——命令层带幻觉围栏(坐标有限性、id 存在性、fov 范围),越界会被拦并告诉你怎么改。
2. **读操作走 query 或直读**:`dispatcher.query({ type, payload }, __directorDesk)` 返回结构化数据;也可以直读 observable 状态(见「感知」)。
3. **失败是结构化的**:`dispatch` 返回 `{ ok: false, issues: [...] }`,issues 带原因,部分带 `suggestions`(下一步可选项,如 `wait-for-model`)。读到失败就按 issues 修正重试,**不要换 payload 格式乱试**。

## 自检(拿到页面先做)

```js
const desk = window.__directorDesk;
desk.dispatcher.listCapabilities(); // 能力清单:type/version/kind(command|query)/permissions
desk.dispatcher.listCommands(); // 全部可写命令 type
```

句柄不存在 → 页面不是 playground 或导演台未就绪,等就绪回调后再试。

## 感知(怎么看懂场景)

| 你要知道的                  | 怎么拿                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 资源目录(发现可用模型/动作) | `query({ type: "assets.list", payload: { kind?: "model"\|"action", category?: "character.human"\|"character.animal"\|"plant"\|"furniture" } })` → 条目含 license/skeletonFamily/embeddedClips                                                                                                                |
| 生效相机位姿                | `query({ type: "camera.get-pose", payload: {} })` → live(实际相机)+ motionSampled(当前时刻运镜期望值),并排即断言                                                                                                                                                                                             |
| 截图溯源                    | capture 后读 `desk.ui.lastCaptureMeta` → requestId/timeSeconds/cameraPose/尺寸(requestId = 命令幂等键,连发截图按它对账)                                                                                                                                                                                      |
| 机位表                      | `query({ type: "camera.list-shots", payload: {} })` → `{ shots: [{ id, shot }], activeShotId }`                                                                                                                                                                                                              |
| 同框断言                    | `query({ type: "camera.check-framing", payload: { subjectIds: [...] } })` → `[{ id, inFrame, marginNdc }]`;`marginNdc < 0` 即出画。激活机位时按机位定义测量,与渲染帧时序无关                                                                                                                                 |
| 播放态                      | `query({ type: "transport.get-state", payload: {} })` → `{ time, isPlaying, isLooping, durationSeconds }`                                                                                                                                                                                                    |
| 时间轴文档                  | `dispatcher.query({ type: "timeline.get-document", payload: {} }, desk)` → 时长/轨道/关键帧                                                                                                                                                                                                                  |
| 运镜编排                    | `query({ type: "motion.get", payload: {} })` → `{ clips: [{ id, cameraId, startTimeSeconds, durationSeconds, keys: [{ id, progress, position, target, fov, handleMode, inHandle, outHandle }], focus, follow, easing }], program, activeProgramCameraId, timelineDurationSeconds, viewMode, previewClipId }` |
| 灯光                        | `query({ type: "lighting.list", payload: {} })`                                                                                                                                                                                                                                                              |
| 骨骼(姿态编辑前必查)        | `query({ type: "pose.bones.discover", payload: { objectId } })`                                                                                                                                                                                                                                              |
| 眼睛(构图确认,仅美学用)     | `dispatch({ type: "capture.frame", payload: {} })` 截图,产物元数据读 `desk.ui.lastCaptureMeta`                                                                                                                                                                                                               |

**分工:度量问数据,美学问截图。默认断言驱动:每步操作后用 query 断言结果,断言过了不截图;只有断言失败(排查)或验收构图(美学)才截图。**

### 资源目录(优先用目录,别手搓 URL)

- `assets.list` 发现 → `assets.place { assetId, transform? }` 放模型；内置模型的姿势与动作来自自身 `embeddedClips`，不再提供独立内置动作条目；
- 同一 `assetId` 可重复 `assets.place`，命令会固化一个新 UUID 场景实体 id；
- 内置资源已入库缓存（许可随目录条目可审计）；宿主注入条目可标记 `source: "injected"`，远程条目用 `"remote"`；
- 目录为空 → 内置 catalog.json 加载失败,停止并报告(别改用 URL 硬编)。

### 断言驱动验收协议

| 步骤     | 断言(query/直读)                                                                                                 | 失败时                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 放模型   | `scene.describe` → 该实体 `loadState` 变 `loaded`,`bounds.size` 合理(≈2 单位×scale);`mountedActionId` 回读挂载态 | `failed` → 换资产;`loading` 超 10s → 查 URL           |
| 尺度断言 | `bounds.size` 之比 = 设计尺度比(如机甲:怪兽 ≈ 1.4:1)                                                             | 调 transform.scale,勿目测                             |
| 挂动作   | `pose.bones.discover` ready → mount 返回 ok                                                                      | bone 类 issue → 按 suggestions 换方案                 |
| 运镜     | `camera.get-pose`:seek 后 `live` 应逼近 `motionSampled`                                                          | 不符 → 检查是否播放中录 key 被拒                      |
| 截图     | `lastCaptureMeta.timeSeconds` == 目标时刻                                                                        | 不符 → capture 时机错,重新 seek+capture               |
| 视频     | `lastVideoMeta.durationSeconds` == 目标时长,文件头 EBML(0x1A45DFA3)                                              | 录制被拒 → 已有录制在进行(cancel 或等完成)            |
| 文档接管 | import 后 `scene.describe` 与导出前一致;动作 actionId 恢复                                                       | 动作恢复失败 → 看 applicationNotice(资产 URL 不可达?) |

## 核心命令速查

坐标系:右手系,y 向上;transform = `{ position:[x,y,z], rotation:[rx,ry,rz](弧度), scale:[sx,sy,sz] }`。

### 布景

```js
// 放模型(url 由宿主/资产侧提供);kind 只有 model/camera/light,摆几何体请用 assets.place 的内置条目
dispatch({ type: "object.place", payload: { id: "mecha", kind: "model", sourceUrl, format: "glb" } })
// 移动/删除
dispatch({ type: "object.move", payload: { id: "mecha", transform: {...} } })
dispatch({ type: "object.remove", payload: { id: "mecha" } })
// 语义摆位(别手算坐标):参考系 = 当前导演相机视线;距离 = 双方包围球表面间距(米)
dispatch({ type: "object.place-relative", payload: { id: "mecha", anchorId: "monster", relation: "left-of", distance: 2 } })
dispatch({ type: "object.place-relative", payload: { id: "mecha", anchorId: "monster", relation: "facing" } }) // 面朝锚点,不动位置
// relation 词表:left-of | right-of | in-front-of(更靠近相机) | behind | facing
```

#### 布景配方(多人/组合构图的首选入口)

一条命令摆好一组实体,距离按包围球半径和自适应尺度(人偶与机甲同配方同呼吸感):

```js
dispatch({
    type: "scene.stage",
    payload: {
        presetId: "face-off",
        slots: [
            { slot: "a", objectId: "hero" },
            { slot: "b", objectId: "monster" },
        ],
    },
});
```

| presetId       | 槽位    | 效果                                          |
| -------------- | ------- | --------------------------------------------- |
| `face-off`     | a, b    | 对峙双人:b 在画面右 1.5×半径和,互朝           |
| `side-by-side` | a, b    | 并肩:b 在画面右 0.6×半径和,同朝观众           |
| `triangle`     | a, b, c | 三角群像:a 顶角靠前,b/c 两翼对称靠后,同朝观众 |
| `depth-lineup` | a, b    | 前后纵深:b 沿视线拉开 3×半径和,互朝           |

- 原点槽(a)保持其当前位置,其余槽位向它收拢——先把主角放到位,再以它为锚 stage。
- 撤销一步全组回原。
- 装载闸门:涉及实体未 `loaded` 时 stage/place-relative 拒绝并带 `wait-for-model` 选项——先等 `scene.describe` 全 loaded,别硬试。
- **零截图验收协议**:stage → `camera.frame-subject { subjectIds: [...全体槽位实体] }` → `camera.check-framing { subjectIds }` 全部 `inFrame: true` → `scene.describe` 对账间距(表面间距 ≈ (factor−1)×半径和,蒙皮模型包围盒首帧会收敛,容差 ±30%)。全程不需要截图;截图只留美学终审。

### 动作与播放

动作是两段式:先把模型文件里的 clip 注册进动作库,再挂载。**动作不是命令**(clip 是运行时资源),注册这两步直接调句柄:

```js
// 注册(异步):拿模型文件的动画 clip 进动作库;已注册过同名的会复用(duplicate)
const handle = await desk.models.acquire(url, "gltf"); // format: glb/gltf→"gltf", fbx→"fbx", obj→"obj"
const clip = handle.animations.find((c) => /run/i.test(c.name)) ?? handle.animations[0];
const { action } = desk.animations.register({ name: "出拳", url, clip });
handle.release();
// 挂载(命令层):
dispatch({ type: "action.mount", payload: { objectId: "mecha", actionId: action.id } });
// 当前模型的局部预览；不驱动其他模型，也不改全局 Timeline playhead。
dispatch({ type: "action.preview.play", payload: { objectId: "mecha" } });
dispatch({ type: "action.preview.pause", payload: {} });
```

### 时间轴（走位关键帧）

```js
dispatch({ type: "timeline.set-duration", payload: { duration: 5 } });
dispatch({
    type: "timeline.add-key",
    payload: {
        trackId: "track-mecha",
        targetId: "mecha",
        keyframe: {
            id: "k1",
            time: 0,
            value: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    },
});
// timeline.move-key / remove-key / set-key-easing 同族；姿势是模型当前状态，不进入时间轴。
```

easing 只有两档:`"linear"` / `"smooth"`。运镜的 easing 是**整段时间曲线**(clip 级,`motion.set-clip-easing`):smooth = 起落加减速,linear = 全程匀速;**段与段之间的快慢由关键帧的 `progress` 分布表达**,不要给每个关键帧单独设缓动——那会让每过一枚关键帧就停顿一次。

### 机位与运镜

```js
// 静态机位是运镜的起点
dispatch({
    type: "camera.set-shot",
    payload: { id: "机位 01", shot: { position: [0, 1.6, 4.2], target: [0, 0.9, 0], fov: 45 } },
});

// 景别机位(别手算距离):按被摄体联合包围球定距,多被摄体同框是构造保证;方位角缺省取当前导演相机朝向
dispatch({ type: "camera.frame-subject", payload: { shotId: "机位 02", subjectIds: ["mecha"], shotSize: "close-up" } });
dispatch({
    type: "camera.frame-subject",
    payload: { shotId: "双人 01", subjectIds: ["mecha", "monster"], shotSize: "medium-long" },
});
// shotSize 词表:extreme-long | long | medium-long | medium | medium-close | close-up | extreme-close-up

// 推荐入口：一次落地可编辑的运镜片段和 Program 输出。
dispatch({
    type: "motion.create-take",
    payload: {
        id: "take-push-01",
        cameraId: "机位 01",
        startTimeSeconds: 0,
        durationSeconds: 2,
        keys: [
            {
                id: "push-start",
                progress: 0,
                position: [0, 1.6, 4.2],
                target: [0, 0.9, 0],
                fov: null,
                handleMode: "auto",
                inHandle: [0, 0, 0],
                outHandle: [0, 0, 0],
            },
            {
                id: "push-end",
                progress: 1,
                position: [0, 1.6, 2.2],
                target: [0, 0.9, 0],
                fov: null,
                handleMode: "auto",
                inHandle: [0, 0, 0],
                outHandle: [0, 0, 0],
            },
        ],
    },
});

// 语义预设同样产出普通可编辑的 key；UI 预设按钮与 AI 共用此入口。
dispatch({
    type: "motion.author",
    payload: { cameraId: "机位 01", startTimeSeconds: 2, durationSeconds: 2, move: "dolly-in" },
});
```

`CameraKey` 是一帧完整画面：`position`、`target`、`fov`。`fov: null` 表示跟随机位的静态 fov；`focus` 是可选的注视覆盖层，非空时接管 key 的 `target`，`null` 则回到 key 的 target 插值。`follow` 是可选跟拍绑定：非空时，全部关键帧坐标属于主体跟随系——主体在原点、正面 −Z、+Z 在身后、+X 在右手侧。`progress ∈ [0,1]` 是**片段内轨迹参数**（不是时间比例）：整段时间曲线 `easing` 把归一化时间映射成它，`smooth` 下 `progress = 3p² - 2p³`（`p` = 归一化时间），`linear` 下两者相等；反解 `p = 0.5 - sin(asin(1 - 2·progress) / 3)`。拉伸或重定时片段不改变运镜形状。要在「某个时刻」落画面，用 `motion.set-key` 前先按上式换算，或直接在镜头视角摆好画面让 UI 落键。

编辑命令：`motion.set-key`（存在即覆盖）/ `motion.move-key` / `motion.remove-key` / `motion.set-key-handle` / `motion.reset-key-handles` / `motion.set-clip-easing` / `motion.set-clip-range` / `motion.set-focus` / `motion.remove-clip`。`motion.preview.enter` / `motion.preview.exit` 控制指定片段预览：进入预览时若 playhead 不在片段内会自动 seek 到片段起点，且预览片段的取景优先于 Program 排期；`view.set-mode { mode: "director" | "lens" }` 切换导演/镜头视角；`transport.set-loop { loop: boolean }` 控制整段循环。

跟拍命令速查：

| 命令                       | payload                                                                                   | 行为                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `motion.replace-clip`      | `{ clip }`                                                                                | 整片段覆盖写入；片段须已存在                     |
| `motion.bind-follow`       | `{ id, objectId, anchorOffset, frame: "world"\|"heading", lagSeconds, smoothingSeconds }` | 绑定跟拍，关键帧改为相对主体坐标；绑定时画面不跳 |
| `motion.unbind-follow`     | `{ id }`                                                                                  | 解除跟拍，烘回世界坐标；解绑时画面不跳           |
| `motion.set-follow-params` | `{ id, objectId, anchorOffset, frame: "world"\|"heading", lagSeconds, smoothingSeconds }` | 只改参数，不重算关键帧                           |

`motion.author` 的 `move` 词汇：`dolly-in`、`dolly-out`、`pan`、`tilt`、`truck`、`crane`、`orbit`、`hold`。同一机位片段不得重叠；`motion.create-take` 若其它机位占用 Program 时段会返回结构化 `program-overlapping-clip`，按 options 重试，不要手工补 Program。

### 灯光与成片

````js
dispatch({ type: "scene.set-lighting-mode", payload: { mode: "studio" | "custom" } })
dispatch({ type: "light.adjust", payload: {...} })   // 细节先 lighting.list 看现状
dispatch({ type: "capture.frame", payload: { requestId: "shot-01" } }) // 截图(隐藏辅助物);requestId 可选,缺省自动生成,产物元数据原样回带
dispatch({ type: "capture.video", payload: {} })     // 录 WebM(缺省=时间轴时长;产物在 ui.lastVideoUrl/lastVideoMeta,含 requestId)
dispatch({ type: "capture.video-cancel", payload: {} }) // 提前终止录制(丢弃产物)
dispatch({ type: "view.frame", payload: {} })        // 导演视角取景到场景内容

### 文档导出/接管

```js
// 导出整桌为一份 JSON(实体/机位/运镜/时间轴/动作引用/灯光模式)——存档或交给另一个控制台接管
const doc = query({ type: "desk.export-document", payload: {} }).value;
// 导入(替换式,清空重建;动作 clip 按 URL 异步重取并恢复挂载;可撤销)
dispatch({ type: "desk.import-document", payload: { document: doc } })
````

- 文档版本门(v9):版本不符直接结构化拒绝(`document-version-unsupported`),旧档不迁移——重导前先重新导出。
- v9 起 `actions[].mountedOn` 是实体 id 数组:同一动作挂 N 个实体,导入后全部恢复挂载且共享同一动作实例。
- v9 起 `lighting.mode` 随文档往返:custom 模式导入后不回退 studio;灯本体是实体,参数在 `entities[].light`。
- 动作恢复是异步流水线(重取资产 → 注册 → 等运行时就绪 → 挂载):import 返回 ok ≠ 已挂载,断言挂载要轮询 `scene.describe` 的 `mountedActionId`。

## 工作流配方(标准成片路径)

1. **布景**:放模型 → 摆位(面对面 = 两实体 position 相对 + rotation 朝向对方)→ `view.frame` 取景;
2. **动作**:挂 clip → 骨骼不兼容会收到 `bone-incompatible` 类 issue,换一个动作或换模型,别硬试;
3. **时间轴**:set-duration → 打关键帧（仅走位使用 timeline）；姿势是当前模型状态，不进入时间轴；
4. **运镜**:优先用 `motion.create-take` 一次创建片段和 Program 输出；需要电影语言时用 `motion.author` 生成可再编辑 key;
5. **灯光**:studio 兜底,custom 微调;
6. **验收**:播放/seek 逐段截图,多模态审构图;
7. **导出**:capture.frame 逐时间点 seek + 截图 = 参考帧序列。

## 运镜语言速查(语义 → 命令)

| 说法                 | 落地                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| 推近                 | `motion.author { move: "dolly-in" }`                                               |
| 拉远                 | `motion.author { move: "dolly-out" }`                                              |
| 水平摇镜             | `motion.author { move: "pan" }`                                                    |
| 俯仰                 | `motion.author { move: "tilt" }`                                                   |
| 横移                 | `motion.author { move: "truck" }`                                                  |
| 升降                 | `motion.author { move: "crane" }`                                                  |
| 环绕                 | `motion.author { move: "orbit" }`                                                  |
| 定镜                 | `motion.author { move: "hold" }`                                                   |
| 自定义节奏/构图      | `motion.move-key` 调关键帧时间分布定段间快慢;`motion.set-clip-easing` 只管整段起落 |
| 尺度感(如 50 米机甲) | 用 scale 断言 + 低机位仰拍(target.y 高于 position.y)                               |

## 实测陷阱(环境/契约/验收)

### 页面环境

- **非安全上下文(http 非 localhost)**:旧部署里 `crypto.randomUUID` 不存在,`desk.animations.register`、文档导入的动作恢复、检查器动作置备全部抛 `crypto.randomUUID is not a function`(导入侧表现为 toast「动作 "X" 恢复失败」)。先用 `crypto.getRandomValues` 注入 UUIDv4 polyfill 再操作。源码已修(统一 `createId` 兜底,getRandomValues 优先),重新部署后不再需要 polyfill。
- **浏览器驱动**:页面 JS 必须在 `tab.evaluate` 里执行(工具运行域没有 `window`);等句柄用 `wait(() => tab.evaluate(...))` 轮询,`tab.waitForFunction` 不存在。Chrome 已有实例在跑时 spawn 会 CDP 超时,加 `--user-data-dir` 隔离配置重试。

### 契约偏差(以实测为准)

- `assets.place`:`id` 实际必填(能力元数据标的是可选),缺 id 报 `command-construction-failed`;同一 assetId 摆多个实例时各给各的 id。
- `scene.describe` 的 `value` 是实体数组本体,不是 `{ entities: [...] }`——轮询 loadState 别取错层。
- `actor.build.set` / `actor.build.apply-preset`:播放期拒改,issue `transport-playing` 自带 `pause-transport` 选项——先暂停→改→恢复播放。`actor.appearance.set`(上色)不受播放限制。
- `light.adjust`:intensity 围栏 0~100,超了报 `lighting.invalid-payload` 并指名 `light.intensity`。物理衰减下嫌暗优先降 `decay`、拉近灯距,别硬堆强度。

### 运镜与验收

- `motion.author { move: "orbit" }` 只生成约 90° 弧段(4 枚 key),不是整圈。要无缝 360° 环绕:从首 key 反解圆心(target)、半径、起始角,`motion.replace-clip` 重写 5 枚 key(0/0.25/0.5/0.75/1,首尾同位),easing 必须 `linear`——`smooth` 会在循环接缝处减速,每圈卡顿一次。
- `camera.get-pose` 的 `live ≈ motionSampled` 断言只在镜头视角(`view.set-mode { mode: "lens" }`)下成立;导演视角的 live 是自由相机,poseDist 大是预期、不是运镜没生效。

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- payload 结构有契约:字段名写错、缺必填、类型不符会被 `payload-contract-violation` 拦下并指名字段(dev/playground 直接 throw)。按报错改字段名,不要换格式乱试;字段定义以 `listCapabilities()` 返回的 `payload` 契约为准。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
