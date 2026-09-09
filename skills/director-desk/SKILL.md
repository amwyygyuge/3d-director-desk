---
name: director-desk
description: 驱动 3D 导演台(布景/动作/时间轴/运镜/灯光/截图)完成分镜搭建与参考成片。当任务涉及操作导演台页面、摆放 3D 模型、挂载动作、编排时间轴、设计运镜、打光或导出参考帧时使用。
---

# Director Desk 驱动手册

导演台是一个嵌入页面的 3D 分镜工具。你**不点 UI**，一切通过页面上的 `window.__directorDesk` 句柄用 JS 完成。

## 心智模型(三条铁律)

1. **写操作只走命令层**:`__directorDesk.dispatcher.dispatch({ type, payload }, __directorDesk)`。禁止直写任何 store/实体——命令层带幻觉围栏(坐标有限性、id 存在性、fov 范围),越界会被拦并告诉你怎么改。
2. **读操作只走 query**:`dispatcher.query({ type, payload }, __directorDesk)` 返回结构化数据。AI 不直读 observable/store；先 `desk.inspect`，再按需调用专用查询。
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
| 低上下文场景索引            | `query({ type: "desk.inspect", payload: { detail: "brief" } })` → 实体身份/装载态/量纲；要几何细节再用 `focused` + `entityIds`                                                                                                                                                                               |
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

| 步骤     | 断言(query)                                                                                       | 失败时                                                 |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 放模型   | `scene.describe` → 该实体 `loadState` 变 `loaded`,`bounds.size` 合理;`mountedActionId` 回读挂载态 | `failed` → 换资产;`loading` 超 10s → 查 URL            |
| 量纲断言 | `desk.inspect focused` → `spatialScale.kind`;只有 `actor-meters`/`reference-meters` 可用真实米数  | `relative` → 改用比例或补 `physicalMaxDimensionMeters` |
| 角色身份 | `scene.set-identity` 后 `desk.inspect brief` 回读 `{ role, label }`                               | 消歧失败 → 用稳定 label 而非猜资源名                   |
| 运镜     | `camera.get-pose`:seek 后 `live` 应逼近 `motionSampled`                                           | 不符 → 检查是否播放中录 key 被拒                       |
| 截图     | `lastCaptureMeta.timeSeconds` == 目标时刻                                                         | 不符 → capture 时机错,重新 seek+capture                |
| 视频     | `lastVideoMeta.durationSeconds` == 目标时长,文件头 EBML(0x1A45DFA3)                               | 录制被拒 → 已有录制在进行(cancel 或等完成)             |
| 文档接管 | import 后 `scene.describe` 与导出前一致;动作 actionId 恢复                                        | 动作恢复失败 → 看 applicationNotice(资产 URL 不可达?)  |

## 核心命令速查

坐标系:右手系，`Y` 向上，`X/Z` 是地面平面；transform = `{ position:[x,y,z], rotation:[rx,ry,rz](弧度), scale:[sx,sy,sz] }`。导演语言的左/右/前/后**永远以当前导演相机水平视线解释**，用语义摆位命令，不把固定世界轴当成画面语义。长度仅在 `spatialScale.kind` 为 `actor-meters` 或 `reference-meters` 时可解释为米；`relative` 资产只能做相对构图。

**朝向约定(人偶正面是 -Z)**:rotation.y = 0 时人偶正面朝 **-Z**,即 yaw 的朝向向量是 `(-sin yaw, 0, -cos yaw)`(与 `TimelineSampler` 的切线朝向、`yawFacing` 同一约定)。要判断"A 是否面朝 B",算 `dot(朝向向量, 归一化(B.pos - A.pos))`,≈ `+1` 才是面对面,`-1` 是背对背。这条断言是精确的,**别用截图判断朝向**——视觉复核对人偶正背面的判读会反复摇摆。
`camera.frame-subject` 的 `azimuth` 是另一套参数化:`atan2(z, x)`,从 **+X** 起量的水平方位角(不是 yaw)。要把相机放到主体正面,传 `azimuth = atan2(-cos yaw, -sin yaw)`;再 `+0.5~0.7` 弧度得到三四分之侧面(比正面或 90° 侧面都更立体,侧面还会让手臂与大腿轮廓糊在一起)。

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
// 为后续自然语言引用建立稳定身份；role: protagonist | antagonist | supporting | prop | set
dispatch({ type: "scene.set-identity", payload: { id: "mecha", identity: { role: "protagonist", label: "机甲主角" } } })
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
- **零截图验收协议**:stage → `camera.frame-subject { subjectIds: [...全体槽位实体] }` → `camera.check-framing { subjectIds }` 全部 `inFrame: true` → `scene.describe` 对账间距。`relative` 资产只验相对包围盒关系；参与物理距离约束的实体必须是米制。截图只留美学终审。

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

#### 多段动作序列(一次性 → 循环 → 一次性)

一个实体可以在一条时间线上依次表演多个动作。`action.mount` / `assets.mount` **默认追加**,
传 `replace: true` 才是整表替换(旧的单动作行为)。

```js
// 1) 一次性:被驱赶的反应
dispatch({
    type: "assets.mount",
    payload: { objectId: "actor", assetId: "builtin.action.hands-on-head", startTimeSeconds: 0, durationSeconds: 2.8 },
});
// 2) 循环:走路 —— 时段声明为「对齐到走位轨的某个关键帧区间」,不手填时间
dispatch({
    type: "assets.mount",
    payload: {
        objectId: "actor",
        assetId: "builtin.action.walking",
        alignToTrack: { trackId: "walk-actor", fromKeyframeId: "k-turn-out", toKeyframeId: "k-walk-end" },
    },
});
// 3) 一次性:收尾
dispatch({
    type: "assets.mount",
    payload: { objectId: "actor", assetId: "builtin.action.thumbs-down", startTimeSeconds: 10.3, durationSeconds: 2.5 },
});
```

读回:`scene.describe` 的 `actionSequence`(按起始升序,含 `performanceId` 与 `alignedToTrackId`)。
`performanceId` 是**段身份**——改某一段、删某一段都用它定位。
`mountedActionId` / `actionSchedule` 只是**首条**的兼容投影,多动作场景别用它们判断「当前在演什么」。

**`alignToTrack` 是自动对齐的入口,优先用它而不是手填两份时间。** 走路动作必须与走位区间同起同止,
手填的排期在轨道重定时(拖关键帧 / `retime-track` / `timeline.scale`)后不会跟着动,必然漂;
声明对齐后时段是走位轨的派生量,轨道一动排期自动跟随。实测:把终点关键帧从 10s 拖到 8s,
对齐的走路排期自动从 4→10 收缩为 4→8;整轨 retime 后变 2→5,对齐关系保留。

踩坑清单:

- **排期不得交叠,但首尾相接允许**("走完立刻倒地"正是相接)。交叠返回结构化
  `action-overlapping-performance` 并报出已占区间。
- **一次性动作的实际占用含 release 尾巴**:`[start, start + duration + releaseSeconds]`。
  走位段 4→10s 的动作实际占到 10.25s,在 10s 挂下一段会被拒——从 `releaseEndTimeSeconds` 之后接。
- **循环动作才吃步频同步**:`locomotion: "sync"` 只驱动当前生效的 `loop` 动作;
  一次性动作有自己的时间语义,不会被位移改写。
- **走路资产**:`builtin.action.walking` / `builtin.action.running`(loop)。其余 21 个内置动作都是手势,
  只有 `挥手`/`左侧移步`/`催促离开` 是 loop,其余全 `once`——`assets.list` 的 `loopMode` 字段可查。
- **`action.set-range` 在多段下要带 `performanceId`** 定位改哪一段,缺省改首段。显式改时段会**解除对齐**
  (作者的直接操作胜过声明式派生),想保留对齐就别用它。拖到与邻段交叠会被
  `action-overlapping-performance` 拒下。
- **删一段用 `action.unmount-performance { objectId, performanceId }`**;`action.unmount` 是清空该实体
  **全部**动作,多段序列下用错会把其余几段一起抹掉。
- **每段排期在时间轴上各自成条**,段条 id 即 `performanceId`;拖条、选中、Delete 都按段生效。

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

走位轨的四个实测陷阱:

- **走位轨驱动的是运行时,不是实体 `transform`**:`scene.describe` 的 `transform` 是**作者态**(你 place/move 写进去的值),
  时间轴采样把位姿写到 Three 运行时。所以 seek 到走路中段时 `transform.position` 仍是 `[0,0,0]`,
  别据此判断"走位没生效"。要断言实际位姿,读 `bounds.center`(它测的是运行时包围盒),
  或在页面里读 `desk.scene.manager.getRuntime(id).position`。
- **`orientation` 默认 `path`(朝向锁死轨迹切线),原地转身无效**:切线为零时朝向不变,
  「调头」必须显式 `policies: { orientation: "keyed" }` 并用关键帧 `rotation.y` 表达(差 π 即 180°)。
- **关键帧轨迹是样条,首尾同值也会过冲**:`auto` handle 下"走到 -7 停住"会在末段冲到 -7.49 再回弹。
  与动作序列无关(卸掉动作曲线一致),介意就改 `handleMode: "manual"` 压平 handle。
- **轨道时段之外默认「保持」(v18)**:`policies.extrapolation` 缺省 `hold`——走完停在末帧位置,
  轨道开始前站在首帧位置(不再弹回实体 `transform`,也不再在轨道起点瞬移)。
  代价:带走位轨的对象在任意时刻用坐标轴拖动都会被下一次采样覆盖;要在时段外自由摆放,
  显式切 `policies: { extrapolation: "rest" }`(检查器「走位」区的「走完停在终点」开关同此)。
  注意 `transport.stop` 与删对象仍走显式回位,读的是实体 `transform`,不受本策略影响。

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

`CameraKey` 是一帧完整画面：`position`、`target`、`fov`。`fov: null` 表示跟随机位的静态 fov；`focus` 是可选的注视覆盖层，非空时接管 key 的 `target`，`null` 则回到 key 的 target 插值。`follow` 是可选跟拍绑定：其局部坐标是内部实现细节，AI 应优先传 `follow.approach` 与 `frame` 枚举，不根据世界轴手写相对偏移。`progress ∈ [0,1]` 是**片段内轨迹参数**（不是时间比例）：整段时间曲线 `easing` 把归一化时间映射成它，`smooth` 下 `progress = 3p² - 2p³`（`p` = 归一化时间），`linear` 下两者相等；反解 `p = 0.5 - sin(asin(1 - 2·progress) / 3)`。拉伸或重定时片段不改变运镜形状。要在「某个时刻」落画面，用 `motion.set-key` 前先按上式换算，或直接在镜头视角摆好画面让 UI 落键。

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

1. **感知**:`desk.inspect brief` → 对候选实体 `focused`；先读取身份、装载态、量纲，不截屏。
2. **布景**:放模型 → 等 `loaded` → `scene.set-identity` → **摆自然初始姿态(见下)** → `scene.stage` / `object.place-relative` → 朝向点积断言 → `camera.frame-subject` → `camera.check-framing`;
3. **动作**:挂 clip → 骨骼不兼容会收到 `bone-incompatible` 类 issue,换一个动作或换模型,别硬试;
4. **时间轴与运镜**:set-duration → 打关键帧（仅走位使用 timeline）；优先 `motion.create-take` 一次创建片段和 Program 输出;
5. **灯光**:studio 兜底,custom 微调;
6. **验收**:以 `scene.describe`、`camera.get-pose`、`camera.check-framing` 做位置/尺寸/同框断言；只有美学终审才截图;
7. **导出**:capture.frame 逐时间点 seek + 截图 = 参考帧序列。

### 初始姿态:人偶落地就是 T-pose,必须摆

`assets.place` 的人偶默认停在 **T-pose(侧平举)**,任何场景下都出戏。放完模型、在 stage 之前先摆一个该场景下的自然姿态:

```js
// 两段式:下半身定站/坐/跪,上半身定手臂。merge 才能分别叠加,replace 会互相覆盖。
dispatch({ type: "pose.apply-preset", payload: { objectId: "hero", presetId: "lower-stand", mode: "merge" } });
dispatch({
    type: "pose.apply-preset",
    payload: { objectId: "hero", presetId: "upper-stand-arms-down", mode: "merge" },
});
```

`pose.presets.list` 读全表(23 项,分 `lower` / `upper` 两部位)。常用上半身:`upper-stand-arms-down`(垂臂,对峙/待场默认)、`upper-stand-natural`(站姿·自然)、`upper-idle`(待机)。下半身:`lower-stand` / `lower-crouch` / `lower-kneel` / `lower-sit-chair` 等。

注意姿态与动作的关系:挂了 `action.mount` 的实体在**动作窗口内**由动作驱动(`scene.describe` 的 `actionSchedule` 给出 `startTimeSeconds`/`durationSeconds`),窗口外才回落到这个基础姿态。所以 t=1 看到手臂张开可能是动作正在演,不是 T-pose 没摆——查 `actionSchedule` 再判断,或取动作结束后的时刻复核。

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
- **有头浏览器观测**:`browser.open` 走 relay/`app.path` 都可能失败(relay 扩展未连、spawn 后无 page target)。可靠路径是自己起 Chrome 再 CDP 附着:`"/Applications/Google Chrome.app/.../Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/xxx <url> &`,然后 `browser.open({ app: { cdp_url: "http://127.0.0.1:9333" } })`。
- **`tab.evaluate` 有 30s 硬上限**:每次 capture 约需 1s 沉降,多时间点/多实体的循环审计务必拆成一次一个探针的多次调用,否则整段超时且 VM 状态被重置。
- **`tab.screenshot()` 拿不到 WebGL 画面**:返回的是页面截图文件路径(webp),画布内容可能全黑;同理在页面里 `createImageBitmap(canvas)` 读回可能全 0。要看渲染结果只信 `capture.frame` 的产物(`desk.ui.lastCaptureUrl`,blob URL,每次 capture 换新)。

### 契约偏差(以实测为准)

- `assets.place`:`id` 实际必填(能力元数据标的是可选),缺 id 报 `command-construction-failed`;同一 assetId 摆多个实例时各给各的 id。
- `scene.describe` 的 `value` 是实体数组本体,不是 `{ entities: [...] }`——轮询 loadState 别取错层。
- `actor.build.set` / `actor.build.apply-preset`:播放期拒改,issue `transport-playing` 自带 `pause-transport` 选项——先暂停→改→恢复播放。`actor.appearance.set`(上色)不受播放限制。
- `light.adjust`:intensity 围栏 0~100,超了报 `lighting.invalid-payload` 并指名 `light.intensity`。物理衰减下嫌暗优先降 `decay`、拉近灯距,别硬堆强度。
- `motion.get` 的 clip **不带 `cameraId` 字段**(只有 id/startTimeSeconds/durationSeconds/keys/focus/follow/easing)。按机位找片段要匹配 `id`(`motion.author` 生成的 id 形如 `take-<机位名>-<move>-<start>`),不要读 `c.cameraId` —— 会得到 undefined 然后炸在 `.keys`。
- `timeline.set-duration` **不联动播放范围**:`program.review` 的 `range.outSeconds` 仍是旧值。改时长后补一条 `timeline.set-playback-range { inSeconds, outSeconds }`,否则录制/输出按旧范围截断。
- `capture.video` 的产物在当前环境是 **MP4/h264**(`ftypisom` 头),不是 WebM/EBML。验收查 `lastVideoMeta.durationSeconds` + `ffprobe`,不要断言 EBML 魔数。
- `motion.set-focus` 的 `worldOffset` 是**注视点相对主体原点的偏移**,不是"抬高一点"的微调量:人偶(1.75m)给 `[0,1.4,0]` 会瞄到头顶以上,把主体挤出画。胸腹高度 `[0,0.9,0]` 才稳。

### 运镜与验收

- `motion.author { move: "orbit" }` 只生成约 90° 弧段(4 枚 key),不是整圈。要无缝 360° 环绕:从首 key 反解圆心(target)、半径、起始角,`motion.replace-clip` 重写 5 枚 key(0/0.25/0.5/0.75/1,首尾同位),easing 必须 `linear`——`smooth` 会在循环接缝处减速,每圈卡顿一次。
- `camera.get-pose` 的 `live ≈ motionSampled` 断言只在镜头视角(`view.set-mode { mode: "lens" }`)下成立;导演视角的 live 是自由相机,poseDist 大是预期、不是运镜没生效。
- **`camera.check-framing` 只测视锥包含,不测遮挡也不测可读性**:全部 `inFrame: true` 的镜头里,主体可能被立柱挡住、可能只有十几像素、也可能与背景同色糊成一片。它是必要条件不是充分条件。
- **`camera.frame-subject` 按主体联合包围球定距,`shotSize` 越紧越容易把单个主体挤出画**:人偶 `close-up`/`medium` 常直接 `marginNdc < 0`。收尾特写从 `medium-long` 起步,想更近就改 key 位置(把末 key 往首 key 方向 lerp 0.3~0.4),别硬调 `shotSize`。
- **改了机位定义,已有运镜片段不会跟着变**:`camera.frame-subject` 重设机位后必须 `motion.remove-clip` + 重新 `motion.author`,否则片段还在放旧 key。
- **人偶默认肤色 `#d8d3ca` 和内置几何体(墙/柱)几乎同色**,贴在一起时画面上完全糊掉。多人布景先 `actor.appearance.set` 给对立双方分色(如主角 `#e8dcc0` sheen / 对手 `#8c2f2a` matte),再把 scenery 往深处推(墙 z ≤ -10、柱子挪出主体横向车道),否则后面所有"看不见人"的排查都是在追这个色差。
- **`scene.stage` / `place-relative facing` 的 180° 朝向 bug(已修)**:`yawToward` 原按"角色面朝 +Z"算,把人偶的**后背**对准目标——`face-off` 的"互朝"实际是背对背,`VIEW_DIRECTION.FRONT` 的"正视图"实际是背影。已统一到 `placementCommands.yawFacing`(-Z 正面约定),`FramingService` 的 `front` 改为 `[0,0,-1]`。若在旧版本上工作,朝向点积断言会给 `-1`,自己补 `+π`。

### 美学终审不能省(断言全绿 ≠ 画面成立)

断言驱动只覆盖度量。**每个机位至少取一帧交给视觉复核**,问的问题要具体到能否证伪:"两个人偶是否都完整可见、有无物体从前面横穿、是否同一地平面、有无裁切、手臂是否自然"。实测里断言全绿而视觉发现的真问题:立柱横穿主角躯干、两人踩在不同高度、收尾镜头切掉头顶、人偶还停在 T-pose。

**但朝向不要问截图。** 视觉复核对人偶正面/背面的判读会在同一场景的不同帧之间自相矛盾(实测同一组已验证面对面的人偶,一帧答"面对面"、另一帧答"都朝向镜头")。朝向用上面的点积断言,它是精确的。分工:**能算的用算的,只把"好不好看"留给眼睛。**

捞帧姿势(避开上面所有坑):`capture.frame` → `fetch(desk.ui.lastCaptureUrl)` → 页面内 `OffscreenCanvas` 缩到 1400px 宽 → base64 回传落盘 → 用带具体问题的图像复核。缩图是必要的:原图 2833×1783 直接复核容易把 200px 高的人偶读成"圆柱"。

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- payload 结构有契约:字段名写错、缺必填、类型不符会被 `payload-contract-violation` 拦下并指名字段(dev/playground 直接 throw)。按报错改字段名,不要换格式乱试;字段定义以 `listCapabilities()` 返回的 `payload` 契约为准。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
