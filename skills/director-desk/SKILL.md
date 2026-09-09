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
- **骨架就绪判据:`getRuntime()` 非空不算就绪(已修,`actionProvisioning.ts`)**。
  `subjectBounds.ts` 早有注释「runtime 外层组在内容加载前就绑定,不能当 loaded 证据」,
  但挂载路径没遵守。拿内容未就位的外层组做骨骼预检必然得 0%,被 `validate` 当成
  `bone-incompatible` 拒下——实测真实骨架 33/33 = 100% 匹配,手动补挂立即成功。
  空白页面导入工程时约 280ms 必然触发,三人动作全部挂不上。
  已改为「`entityLoadState` 为 loaded/none」**或**「骨架实测已绑定 SkinnedMesh」的并集。
  只信结局表不行:它未落账时默认返回 `loading`,而「从未发起加载」与「正在加载」
  在该表里不可区分,只等结局表会让前者永久静默等待(实测三人 `loading` 21s 无提示)。
- **挂载失败原因被伪装成超时(已修,`actionProvisioning.ts`)**:`mountWhenReady` 原来对
  「运行时没就绪」和「命令层校验拒绝」都返回 `false`,调用方一律上报「动作挂载等待运行时超时」。
  真实的骨骼不兼容 / 时段交叠因此被说成超时,把排查方向指向完全错误的地方。已改为返回 `MountOutcome`
  (`{ok:true}` / `{ok:false,reason:"timeout"}` / `{ok:false,reason:"rejected",issues}`),
  校验 issues 原样进 `applicationNotice`。
- **窗口在后台时模型不会加载**:浏览器暂停 rAF,R3F 视口不渲染,实体永远停在 `loading`
  且 `models.cache`/`inflight` 全空(加载请求从未发起)。这是浏览器行为不是缺陷,
  但会让「导入后动作没恢复」看起来像 bug。用 CDP 驱动时先
  `Emulation.setFocusEmulationEnabled` + `Page.bringToFront`,或直接把窗口切到前台。
- **`assets.mount` 的 `dispatch` 返回 ok 只代表命令入队**,真正挂载在异步流水线里
  (取资产 → 注册 clip → 等运行时 → 挂载)。断言挂载必须轮询 `scene.describe` 的 `actionSequence`,
  别看 dispatch 的返回值。失败原因看 `desk.ui.applicationNotice`。

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
6. **验收(先脚本后眼睛)**:注入 `probes/geometry-audit.js` + `probes/checks.js` → `__audit.all()` 四项全 `pass` → 再取一帧只问打光与美感。四项没过就别录制,`firstHit` / `violations` 直接指出改哪个实体;
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
- **`capture.video` 在非安全上下文静默失败(必踩)**:远程 http 源(如 `http://10.226.102.153:4000`)下 `dispatch` 返回 `ok: true`,但 `videoExport.currentState` 一直停在 `"idle"`,`ui.lastVideoUrl` / `lastVideoMeta` 永远是 `null`,**页面上没有任何 toast**。真实原因只在 console 里:`[capture] MP4 export failed Error: VideoEncoder is not available in this environment; this may be because this page is running in an insecure context.` —— WebCodecs 的 `VideoEncoder` 是 secure-context-only API,`MediaRecorder` 存在也没用(它只报 webm,导出走的是 MP4/h264 编码路径)。
    - **先诊断,别瞎试**:`dispatch` 的 ok 无意义。判定录制真的起来了要看 `desk.videoExport.currentState` 是否离开 `idle`。要拿到根因就在页面里 hook console(工具侧的 `page.on("console")` 抓不到这个 frame):
        ```js
        // 在 tab.evaluate 里装一次
        window.__logs = [];
        const oe = console.error;
        console.error = (...a) => {
            window.__logs.push(a.map(String).join(" "));
            oe(...a);
        };
        // 然后 dispatch capture.video,等几秒读 window.__logs
        ```
    - **解决方案:让浏览器把该源当成安全上下文重开**(不需要证书、不改代码、不改部署):
        ```bash
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
          --remote-debugging-port=9444 --user-data-dir=/tmp/dd-chrome-secure --no-first-run \
          --unsafely-treat-insecure-origin-as-secure=http://10.226.102.153:4000 \
          "http://10.226.102.153:4000/" &
        ```
        `--user-data-dir` 必须给一个**新目录**(该 flag 只在全新 profile 的进程上生效);源串要精确到 `scheme://host:port`,不带路径、不带尾斜杠。附着后断言 `window.isSecureContext === true && typeof VideoEncoder !== "undefined"`,两者都为真才录。其它可行路径:把页面挂到 `localhost`(端口转发 `ssh -L 4000:10.226.102.153:4000`,localhost 天然是安全上下文)或给部署上 HTTPS。
    - **换窗口重录不要用 `desk.export-document` → `desk.import-document` 搬场景**:实测导入后动作恢复是异步流水线,会卡在「动作挂载等待运行时超时:hero / aide」,`scene.describe` 的 `actionSequence` 长期停在 0(只有部分实体恢复),而且 `actor.appearance` / `build` 不随文档往返。补挂 `assets.mount` 也不生效。可靠做法是在新窗口**按命令重放布景脚本**(place → identity → appearance/build → pose → timeline → mount → shots → motion → lights),重放是幂等且快的。

### 契约偏差(以实测为准)

- `assets.place`:`id` 实际必填(能力元数据标的是可选),缺 id 报 `command-construction-failed`;同一 assetId 摆多个实例时各给各的 id。
- `scene.describe` 的 `value` 是实体数组本体,不是 `{ entities: [...] }`——轮询 loadState 别取错层。
- `actor.build.set` / `actor.build.apply-preset`:播放期拒改,issue `transport-playing` 自带 `pause-transport` 选项——先暂停→改→恢复播放。`actor.appearance.set`(上色)不受播放限制。
- `light.adjust`:intensity 围栏 0~100,超了报 `lighting.invalid-payload` 并指名 `light.intensity`。物理衰减下嫌暗优先降 `decay`、拉近灯距,别硬堆强度。
- `motion.get` 的 clip **不带 `cameraId` 字段**(只有 id/startTimeSeconds/durationSeconds/keys/focus/follow/easing)。按机位找片段要匹配 `id`(`motion.author` 生成的 id 形如 `take-<机位名>-<move>-<start>`),不要读 `c.cameraId` —— 会得到 undefined 然后炸在 `.keys`。
- `timeline.set-duration` **不联动播放范围**:`program.review` 的 `range.outSeconds` 仍是旧值。改时长后补一条 `timeline.set-playback-range { inSeconds, outSeconds }`,否则录制/输出按旧范围截断。
- `capture.video` 的产物在当前环境是 **MP4/h264**(`ftypisom` 头),不是 WebM/EBML。验收查 `lastVideoMeta.durationSeconds` + `ffprobe`,不要断言 EBML 魔数。**前提是安全上下文**,否则永远拿不到产物(见「页面环境」)。
- `motion.create-take` **不吃 `cameraId`**(手册示例里的 `cameraId` 会被 `payload-contract-violation` 拦下,报 `payload.cameraId 为未知字段`)。片段身份只有 `id`;要绑机位就先 `camera.frame-subject` 建机位,再用同名前缀的 clip id 自己记账。`motion.author` 反过来**必须**带 `cameraId`。
- `timeline.add-marker` 的字段是 **`{ id, timeSeconds, label }` 平铺**,不是 `{ marker: {...} }`。
- `assets.mount` 的排期含 release 尾巴,**超出时间轴时长会被拒**(`动作时段和回收不能超出时间轴时长`)。收尾动作排到接近 `duration` 时先 `timeline.set-duration` 留出 1~2s 余量,再挂。
- `scene.describe` 的 `bounds`(size/center)对 scenery **在 `object.move` 改 scale 后不刷新**,读到的是旧包围盒。要算遮挡/间距请用 `transform.position × transform.scale × 资产基础尺寸`(wall `2×1.5×0.1`、column `0.7×2×0.7`、platform `2×0.2×2`),或读 `desk.scene.manager.getRuntime(id)`。
- `motion.set-focus` 的 `worldOffset` 是**注视点相对主体原点的偏移**,不是"抬高一点"的微调量:人偶(1.75m)给 `[0,1.4,0]` 会瞄到头顶以上,把主体挤出画。胸腹高度 `[0,0.9,0]` 才稳。

### 运镜与验收

- `motion.author { move: "orbit" }` 只生成约 90° 弧段(4 枚 key),不是整圈。要无缝 360° 环绕:从首 key 反解圆心(target)、半径、起始角,`motion.replace-clip` 重写 5 枚 key(0/0.25/0.5/0.75/1,首尾同位),easing 必须 `linear`——`smooth` 会在循环接缝处减速,每圈卡顿一次。
- `camera.get-pose` 的 `live ≈ motionSampled` 断言只在镜头视角(`view.set-mode { mode: "lens" }`)下成立;导演视角的 live 是自由相机,poseDist 大是预期、不是运镜没生效。
- **`camera.check-framing` 只测视锥包含,不测遮挡也不测可读性**:全部 `inFrame: true` 的镜头里,主体可能被立柱挡住、可能只有十几像素、也可能与背景同色糊成一片。它是必要条件不是充分条件。
- **`camera.frame-subject` 按主体联合包围球定距,`shotSize` 越紧越容易把单个主体挤出画**:人偶 `close-up`/`medium` 常直接 `marginNdc < 0`。收尾特写从 `medium-long` 起步,想更近就改 key 位置(把末 key 往首 key 方向 lerp 0.3~0.4),别硬调 `shotSize`。
- **改了机位定义,已有运镜片段不会跟着变**:`camera.frame-subject` 重设机位后必须 `motion.remove-clip` + 重新 `motion.author`,否则片段还在放旧 key。
- **人偶默认肤色 `#d8d3ca` 和内置几何体(墙/柱)几乎同色**,贴在一起时画面上完全糊掉。多人布景先 `actor.appearance.set` 给对立双方分色(如主角 `#e8dcc0` sheen / 对手 `#8c2f2a` matte),再把 scenery 往深处推(墙 z ≤ -10、柱子挪出主体横向车道),否则后面所有"看不见人"的排查都是在追这个色差。
- **`scene.stage` / `place-relative facing` 的 180° 朝向 bug(已修)**:`yawToward` 原按"角色面朝 +Z"算,把人偶的**后背**对准目标——`face-off` 的"互朝"实际是背对背,`VIEW_DIRECTION.FRONT` 的"正视图"实际是背影。已统一到 `placementCommands.yawFacing`(-Z 正面约定),`FramingService` 的 `front` 改为 `[0,0,-1]`。若在旧版本上工作,朝向点积断言会给 `-1`,自己补 `+π`。

### 布景与运镜美学:能算的一律用脚本算

**穿模、遮挡、裁切、构图、绕行、速度、曝光 —— 全是几何/运动学/光度学问题,都有闭式判定。禁止靠视觉复核决定这些。**

实测视觉复核在这类问题上双向出错:把三维间距 2.26m 的场景连续两帧报成「穿模」(实为屏幕空间投影重叠),
同时漏报真实的 0.65m 人物间隙(跑步摆臂已互穿);把 meanLuma 215 的过曝帧说成「整体偏暗」,
把 133 的正常帧说成「略偏亮」。它对朝向的判读还会在同一场景的不同帧之间自相矛盾。

探针在 `skills/director-desk/probes/`,按序注入(后两个依赖第一个):

```js
for (const f of ["geometry-audit", "checks", "kinematics", "staging-aesthetics"]) {
    await tab.evaluate(await Bun.file(`skills/director-desk/probes/${f}.js`).text());
}
// 几何四项一起跑;任一 pass=false 就别录制
JSON.parse(await tab.evaluate(`JSON.stringify(window.__audit.all({ step: 0.1 }))`));
```

**页面刷新会清掉 window 上的探针(场景还在)。** 把注入包成一个函数,每轮验收前先跑一次,
别假设上次注入还在——我为此炸过两次。

| 判定                      | 数学口径                                                   | 阈值                               |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `penetration` 穿模        | 点到 AABB 最短距离,减去身体半径 0.32                       | 人物-障碍 ≥ 0.85m,人物-人物 ≥ 1.2m |
| `occlusion` 视线遮挡      | 线段(相机→主体)与 AABB 的 slab 相交;每主体 5 高度 × 3 横偏 | 命中数 = 0,相机-物件间距 ≥ 1.5m    |
| `visualStanding` 视觉踩盒 | 脚点投影是否落在盒顶面四角的投影包围内                     | = 0                                |
| `composition` 构图        | 头/脚投影的 NDC:头脚一内一外 = 半裁切                      | 半裁切 = 0,头顶余量 0.3~0.8        |

四条必须成对使用的经验(每条都是踩出来的):

- **人物间距要减两个身体半径**。中心距 1.29m 听起来很宽,扣掉 0.32×2 只剩 0.65m —— 跑步摆臂幅度就接近这个数,视觉上就是"手臂插进对方躯干"。只比中心距会漏报。
- **走位样条的实际峰值偏移是关键帧声明值的 1.5~2.3 倍**。`auto` handle 下声明"绕行 1.6m"实测跑到 3.4m。所以**绕行幅度这个参数不可直接约束**——必须对采样轨迹求 `max|x - laneX|`,或先 `handleMode: "manual"` + 零 handle 压平。想按闭式解算最小绕行幅度:`offset ≥ 障碍半宽 + 0.32 + 目标间隙`,再乘过冲系数。
- **改车道宽度必须同步搬障碍物和装饰**。把车道从 ±3.4 拉到 ±4.6 后,跑者绕行峰值到 x≈±8,直接撞进原本"安全"的侧向装饰(实测 -0.32m,即已穿模)。审计要覆盖 `obs-*` 和 `deco-*` 全部,不能只算障碍物。
- **视觉踩盒是纯屏幕空间错觉,靠降机位解决会换来真遮挡**。实测降低同框机位高度消掉踩盒,遮挡从 0 涨到 48。正确修法是压低那几个具体障碍物的 `scale.y`,或让脚点投影离开盒顶投影区。

#### 构图的可计算部分

`composition` 报的三个数直接对应经典构图法则,别凭感觉调:

- **头顶余量 = 1 - head.ny**。**≈ 1.0 是最常见的错**:意味着头顶正好落在画面中心,上半屏全空。目标 `0.3~0.8`。
- **眼高 ny 目标 +0.33**(上三分线)。实测把 `target.y` 从 `1.05` 降到 `-1.0`,眼高从 `-0.06` 提到 `0.32`,头顶余量从 `1.02` 收到 `0.65` —— 相机看得更低,主体在画面里就更高。这是单调关系,二分即可求解。
- **主体高度百分比 = |head.ny - foot.ny| × 50**。低于 ~8% 时视觉复核会开始报"人物过小、看不清动作"。它由群体跨度决定下限:跨度 13.6m 时无论怎么调机位都上不去,得先收窄车道。

**参数搜索必须在页面里一次跑完。** `tab.evaluate` 有 30s 硬上限,逐个组合往返会超时且 VM 状态被重置(实测丢过两次上下文)。把整个 for 循环塞进一次 `tab.evaluate`,粗扫用 `step: 0.3~0.4`,定下来再用 `step: 0.1` 精算。

**参数搜索会留下副作用,搜完必须复位。** 走位构建函数每轮都要 `action.unmount` 再重挂,
搜索结束时场景停在最后一个组合上,动作可能处于卸载态——实测三人动作整批消失,
看起来像 bug 其实是搜索残留。搜完显式重放一次最优参数,并用
`scene.describe` 的 `actionSequence` 断言动作确实回来了。

#### 运动:一顿一顿是数学问题,不是手感问题

注入 `probes/kinematics.js`,用 `__kine.speedProfile(id, { t1 })` 判定。三件事同时做才匀速,少一件就顿:

1. **关键帧时间按累积弦长分配**(等弧长等时间)。等时间分配会让长段飞快、短段龟速。
2. **手柄按相邻段长自适应**:`h = min(相邻段长, 弦长) / 3`。固定系数 0.5 会过冲(实测峰值达声明值 2.3 倍);
   **零手柄会让每个关键帧都变成刹车点**(实测 CV 0.61、25 处顿点、最低速 0.11m/s —— 几乎停住)。
3. **easing 用 `linear`**。`smooth` 是整段时间曲线,会在首尾加减速。

**测量步长必须 ≥ 0.1s(推荐 0.2s)。** `step: 0.05` 时 seek 的时间量化误差被除以极小 dt 放大成假波动:
同一条已匀速轨迹在 0.05s 下测得 CV=0.336、范围 1.64~~4.94,在 0.2s 下测得 CV=0.023、范围 3.29~~3.70。
我按 0.05s 的读数误判过一次"还有残余波动",白搜了两轮参数。

判定尺度:`CV < 0.2` 且顿点为 0 视为匀速。急转弯降速到均值 60% 左右是**真实闪避**,不是缺陷;
掉到 20% 以下才是刹车。人类跑速 3~4.5 m/s,用 `__kine.durationForSpeed(pathLength, 3.7)` 反解时长,
别直接定时长——轨迹一改,速度就跟着变。

#### 布景美学:绕行有效性、曝光、灯光朝向

注入 `probes/staging-aesthetics.js`。这三项都是我靠肉眼看错过、最后被脚本纠正的:

| 判定                             | 口径                                                  | 阈值                    |
| -------------------------------- | ----------------------------------------------------- | ----------------------- |
| `detourEffectiveness` 绕行有效性 | 障碍到「起点→终点」基线的横向距离 vs 轨迹实际峰值偏离 | 见下                    |
| `subjectExposure` 主体曝光       | 只在主体投影像素处取 21×21 均值                       | 均值 90~190,最暗 ≥ 40   |
| `lightingRatio` 三点照明         | key/fill 方位夹角、明暗比、暖冷分离                   | 夹角 90~~135°,比 2~~8:1 |
| `unaimedLights` 漏设朝向         | rotation 全零的非 point 灯                            | = 0                     |

**绕行有效性是最容易自欺的一项。** 轨迹有漂亮的 S 形摆动 ≠ 在绕障碍:

- 实测把车道拉到 ±5.6 而障碍留在 ±3.4 时,`penetration` 全绿、轨迹照样左右摆动,
  但障碍根本不在路上,画面上就是「人在空地上莫名扭动」。脚本对这种情况判 `needsDetour: false`
  并**不计入**,`checked === 0` 直接算失败 —— 这才是那道我先前缺的闸门。
- 反向错误同样常见:**绕得太开也不成立**。全局固定 `offset: 3.2m` 时平均间隙 2.64m,
  障碍半宽却只有 0.35~~0.75m,视觉上是绕大圈而非贴身闪避。正解是**逐障碍求幅度**:
  `offset_i = 障碍_i 半宽 + 0.32 + 目标贴身间隙(1.1)`,得到 1.73~~2.17m 的不同值。
  改完平均间隙 1.31m,既贴身又不穿模。
- 贴身绕行会让转弯更急,顿点可能回升 —— 绕行与运动学要**联合搜索** `ramp`/`hold`,不能分开定。

**曝光只测主体像素,不测全画幅。** 网格地板是深色且占 70~80% 画面,全画幅直方图的最暗两档恒为 80%,
加光完全不动(实测光强 ×2.5→×9,暗部占比一直 80.2%),照它加光只会把主体打到过曝而背景依旧黑。
求解光强用 `intensityBaseline()` 快照 + `scaleIntensity(k, base)` 二分系数,别逐盏手调
(反复缩放不带 baseline 会指数衰减)。

**灯光朝向是最隐蔽的坑:光轴本地是 -Z,由实体 rotation 决定,不会自动指向场景中心。**
实测 16 盏灯全部 `rotation: [0,0,0]`,挂在 11m 高的聚光是**水平射出**的,跑道上一点没照到 ——
表现为「怎么加灯都还是暗」,查 intensity 永远查不出来。放完灯先跑 `unaimedLights()`,
再用 `aimAt(id, point)` 反解(`yaw = atan2(-dx,-dz)`、`pitch = asin(dy)`)。

**不要用几何体当地板。** `builtin.scenery.platform` 铺大板会把全部灯光反射回来,画面直接过曝
(实测 meanLuma 从 39 跳到 215、73.5% 像素挤在最亮档)。要地面基准就 `studio.set-grid-size`
把参考网格放大(上限 100m),网格不参与光照。

### 美学终审不能省(断言全绿 ≠ 画面成立)

断言驱动只覆盖度量。**每个机位至少取一帧交给视觉复核**,但只问它上面脚本算不出来的东西:打光是否沉闷、颜色是否难看、场景是否空、气质对不对。

**别问截图这些(全部有脚本判定,见上一节):** 有没有穿模、有没有被挡住、是否同一地平面、有没有裁切、人物是否过小、朝向对不对。实测视觉复核在这些问题上会自相矛盾——同一组已验证面对面的人偶,一帧答"面对面"另一帧答"都朝向镜头";三维间距 2.26m 的场景被连续两帧报成"穿模";而真实存在的 0.65m 互穿它没提。

分工铁律:**能算的用算的(几何/构图/朝向),只把"好不好看"留给眼睛。** 视觉复核报了几何问题时,先跑脚本证伪,不要直接照它改。

捞帧姿势(避开上面所有坑):`capture.frame` → `fetch(desk.ui.lastCaptureUrl)` → 页面内 `OffscreenCanvas` 缩到 1400px 宽 → base64 回传落盘 → 用带具体问题的图像复核。缩图是必要的:原图 2833×1783 直接复核容易把 200px 高的人偶读成"圆柱"。

**"断言全绿但视觉说只看到一个人"时,用像素探针定位,不要靠反复问截图。** 实测里三个人偶全部 `inFrame: true`,视觉却只认出一个——真因是 scenery 挡在主体前面且被主光打到接近纯白(采样 RGB `[240,242,245]`),人偶贴在上面等于消失。诊断链路(每步都是可证伪的数值):

1. 从 `camera.get-pose` 的 `live`(position + direction + fov)自己算主体的屏幕坐标:构相机基 `r = normalize(dir × [0,1,0])`、`u = r × dir`,投影 `nx = (x/z)/(tan(fov/2)·aspect)`、`ny = (y/z)/tan(fov/2)`,再映射到像素。
2. `capture.frame` 后把产物画进 `OffscreenCanvas`,在每个主体的像素位置 `getImageData` 取 25×25 均值。**同色即消失**:主体与近邻背景 RGB 差 < ~20 就是画面上糊掉了,和构图无关。
3. 疑似遮挡就做射线-AABB 相交:相机 → 主体中心的线段对每个 scenery 盒求交(盒子按 `transform × 基础尺寸` 算,别用 `bounds`)。命中即遮挡。
4. 想确认视觉复核有没有漏读,把投影点画成彩色圆圈叠在截图上再送去问"哪个圈里有人"——比开放式提问可靠得多。
5. 验证假设最快的办法是**临时把 scenery `object.move` 到 y = -200**(撤销一步即回),再取一帧:三个人立刻都认出来了 → 遮挡/同色成立。

修法优先级:scenery 往深处推(墙 z ≤ -20、柱子挪出主体横向车道)→ 降主光 `intensity` / 提 `decay` 压掉过曝 → 最后才动机位。**另外补一块实心地面**(`builtin.scenery.platform` scale 到 `[22, 0.8, 26]`、y 略低于 0)能消掉"人偶悬在网格虚空里"的观感,这是视觉复核最常提的意见。

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- payload 结构有契约:字段名写错、缺必填、类型不符会被 `payload-contract-violation` 拦下并指名字段(dev/playground 直接 throw)。按报错改字段名,不要换格式乱试;字段定义以 `listCapabilities()` 返回的 `payload` 契约为准。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
