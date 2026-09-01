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

| 你要知道的                  | 怎么拿                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 资源目录(发现可用模型/动作) | `query({ type: "assets.list", payload: { kind?: "model"\|"action", category?: "character.human"\|"character.animal"\|"plant"\|"furniture" } })` → 条目含 license/skeletonFamily/embeddedClips |
| 生效相机位姿                | `query({ type: "camera.get-pose", payload: {} })` → live(实际相机)+ motionSampled(当前时刻运镜期望值),并排即断言                                                                              |
| 截图溯源                    | capture 后读 `desk.ui.lastCaptureMeta` → timeSeconds/cameraPose/尺寸                                                                                                                          |
| 机位表                      | `desk.camera.director.listShots()` → `[id, CameraShot]`;当前激活:`desk.camera.activeShotId`                                                                                                   |
| 时间轴文档                  | `dispatcher.query({ type: "timeline.get-document", payload: {} }, desk)` → 时长/轨道/关键帧                                                                                                   |
| 运镜编排                    | `query({ type: "motion.get", payload: {} })` → `{ clips: [{ id, cameraId, startTimeSeconds, durationSeconds, keys: [{ id, progress, position, target, fov, easingOut, handleMode, inHandle, outHandle }], focus }], program, activeProgramCameraId, timelineDurationSeconds, viewMode, previewClipId }` |
| 灯光                        | `query({ type: "lighting.list", payload: {} })`                                                                                                                                               |
| 骨骼(姿态编辑前必查)        | `query({ type: "pose.bones.discover", payload: { objectId } })`                                                                                                                               |
| 眼睛(构图确认,仅美学用)     | `dispatch({ type: "capture.frame", payload: {} })` 截图,产物元数据读 `desk.ui.lastCaptureMeta`                                                                                                |

**分工:度量问数据,美学问截图。默认断言驱动:每步操作后用 query 断言结果,断言过了不截图;只有断言失败(排查)或验收构图(美学)才截图。**

### 资源目录(优先用目录,别手搓 URL)

- `assets.list` 发现 → `assets.place { assetId, transform? }` 放模型；内置模型的姿势与动作来自自身 `embeddedClips`，不再提供独立内置动作条目；
- 同一 `assetId` 可重复 `assets.place`，命令会固化一个新 UUID 场景实体 id；
- 内置资源已入库缓存（许可随目录条目可审计）；宿主注入条目可标记 `source: "injected"`，远程条目用 `"remote"`；
- 目录为空 → 内置 catalog.json 加载失败,停止并报告(别改用 URL 硬编)。

### 断言驱动验收协议

| 步骤     | 断言(query/直读)                                                                    | 失败时                                                |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 放模型   | `scene.describe` → 该实体 `loadState` 变 `loaded`,`bounds.size` 合理(≈2 单位×scale) | `failed` → 换资产;`loading` 超 10s → 查 URL           |
| 尺度断言 | `bounds.size` 之比 = 设计尺度比(如机甲:怪兽 ≈ 1.4:1)                                | 调 transform.scale,勿目测                             |
| 挂动作   | `pose.bones.discover` ready → mount 返回 ok                                         | bone 类 issue → 按 suggestions 换方案                 |
| 运镜     | `camera.get-pose`:seek 后 `live` 应逼近 `motionSampled`                             | 不符 → 检查是否播放中录 key 被拒                      |
| 截图     | `lastCaptureMeta.timeSeconds` == 目标时刻                                           | 不符 → capture 时机错,重新 seek+capture               |
| 视频     | `lastVideoMeta.durationSeconds` == 目标时长,文件头 EBML(0x1A45DFA3)                 | 录制被拒 → 已有录制在进行(cancel 或等完成)            |
| 文档接管 | import 后 `scene.describe` 与导出前一致;动作 actionId 恢复                          | 动作恢复失败 → 看 applicationNotice(资产 URL 不可达?) |

## 核心命令速查

坐标系:右手系,y 向上;transform = `{ position:[x,y,z], rotation:[rx,ry,rz](弧度), scale:[sx,sy,sz] }`。

### 布景

```js
// 放几何体
dispatch({ type: "object.place", payload: { id: "box-1", kind: "primitive",
  transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } })
// 放模型(url 由宿主/资产侧提供)
dispatch({ type: "object.place", payload: { id: "mecha", kind: "model", sourceUrl, format: "glb" } })
// 移动/删除
dispatch({ type: "object.move", payload: { id: "mecha", transform: {...} } })
dispatch({ type: "object.remove", payload: { id: "mecha" } })
```

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

easing 只有两档:`"linear"` / `"smooth"`。**节奏靠关键帧密度 + easing 组合表达**(见「运镜语言」)。

### 机位与运镜

```js
// 静态机位是运镜的起点
dispatch({
    type: "camera.set-shot",
    payload: { id: "机位 01", shot: { position: [0, 1.6, 4.2], target: [0, 0.9, 0], fov: 45 } },
});

// 推荐入口：一次落地可编辑的运镜片段和 Program 输出。
dispatch({
    type: "motion.create-take",
    payload: {
        id: "take-push-01",
        cameraId: "机位 01",
        startTimeSeconds: 0,
        durationSeconds: 2,
        keys: [
            { id: "push-start", progress: 0, position: [0, 1.6, 4.2], target: [0, 0.9, 0], fov: null, easingOut: "smooth", handleMode: "auto", inHandle: [0, 0, 0], outHandle: [0, 0, 0] },
            { id: "push-end", progress: 1, position: [0, 1.6, 2.2], target: [0, 0.9, 0], fov: null, easingOut: "smooth", handleMode: "auto", inHandle: [0, 0, 0], outHandle: [0, 0, 0] },
        ],
    },
});

// 语义预设同样产出普通可编辑的 key；UI 预设按钮与 AI 共用此入口。
dispatch({ type: "motion.author", payload: { cameraId: "机位 01", startTimeSeconds: 2, durationSeconds: 2, move: "dolly-in" } });
```

`CameraKey` 是一帧完整画面：`position`、`target`、`fov`。`fov: null` 表示跟随机位的静态 fov；`progress ∈ [0,1]` 是片段内归一化时间，拉伸或重定时片段不改变运镜形状；`focus` 是可选的跟拍覆盖层，非空时接管 key 的 `target`，`null` 则回到 key 的 target 插值。

编辑命令：`motion.set-key`（存在即覆盖）/ `motion.move-key` / `motion.remove-key` / `motion.set-key-handle` / `motion.reset-key-handles` / `motion.set-key-easing` / `motion.set-clip-range` / `motion.set-focus` / `motion.remove-clip`。`motion.preview.enter` / `motion.preview.exit` 控制指定片段预览；`view.set-mode { mode: "director" | "lens" }` 切换导演/镜头视角；`transport.set-loop { loop: boolean }` 控制整段循环。

`motion.author` 的 `move` 词汇：`dolly-in`、`dolly-out`、`pan`、`tilt`、`truck`、`crane`、`orbit`、`hold`。同一机位片段不得重叠；`motion.create-take` 若其它机位占用 Program 时段会返回结构化 `program-overlapping-clip`，按 options 重试，不要手工补 Program。

### 灯光与成片

````js
dispatch({ type: "scene.set-lighting-mode", payload: { mode: "studio" | "custom" } })
dispatch({ type: "light.adjust", payload: {...} })   // 细节先 lighting.list 看现状
dispatch({ type: "capture.frame", payload: {} })     // 截图(隐藏辅助物)
dispatch({ type: "capture.video", payload: {} })     // 录 WebM(缺省=时间轴时长;产物在 ui.lastVideoUrl/lastVideoMeta)
dispatch({ type: "capture.video-cancel", payload: {} }) // 提前终止录制(丢弃产物)
dispatch({ type: "view.frame", payload: {} })        // 导演视角取景到场景内容

### 文档导出/接管

```js
// 导出整桌为一份 JSON(实体/机位/运镜/时间轴/动作引用)——存档或交给另一个控制台接管
const doc = query({ type: "desk.export-document", payload: {} }).value;
// 导入(替换式,清空重建;动作 clip 按 URL 异步重取并恢复挂载;可撤销)
dispatch({ type: "desk.import-document", payload: { document: doc } })
````

## 工作流配方(标准成片路径)

1. **布景**:放模型 → 摆位(面对面 = 两实体 position 相对 + rotation 朝向对方)→ `view.frame` 取景;
2. **动作**:挂 clip → 骨骼不兼容会收到 `bone-incompatible` 类 issue,换一个动作或换模型,别硬试;
3. **时间轴**:set-duration → 打关键帧（仅走位使用 timeline）；姿势是当前模型状态，不进入时间轴；
4. **运镜**:优先用 `motion.create-take` 一次创建片段和 Program 输出；需要电影语言时用 `motion.author` 生成可再编辑 key;
5. **灯光**:studio 兜底,custom 微调;
6. **验收**:播放/seek 逐段截图,多模态审构图;
7. **导出**:capture.frame 逐时间点 seek + 截图 = 参考帧序列。

## 运镜语言速查(语义 → 命令)

| 说法                 | 落地                                                          |
| -------------------- | ------------------------------------------------------------- |
| 推近                 | `motion.author { move: "dolly-in" }`                        |
| 拉远                 | `motion.author { move: "dolly-out" }`                       |
| 水平摇镜             | `motion.author { move: "pan" }`                             |
| 俯仰                 | `motion.author { move: "tilt" }`                            |
| 横移                 | `motion.author { move: "truck" }`                           |
| 升降                 | `motion.author { move: "crane" }`                           |
| 环绕                 | `motion.author { move: "orbit" }`                           |
| 定镜                 | `motion.author { move: "hold" }`                            |
| 自定义节奏/构图      | `motion.set-key` 后用 `motion.move-key` / `set-key-easing` 调整 |
| 尺度感(如 50 米机甲) | 用 scale 断言 + 低机位仰拍(target.y 高于 position.y)          |

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
