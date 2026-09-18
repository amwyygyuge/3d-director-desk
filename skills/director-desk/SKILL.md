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

## 通讯架构与多客户端驱动 (RPC Bridge & Multi-Client Protocol)

为了支持外部 AI、自动化脚本与多个浏览器窗口协同,导演台在**本地开发**提供标准化的 **多客户端 RPC 桥接服务 (`scripts/bridge.mjs`)**。

### 为什么需要 RPC 桥接？

1. **多浏览器实例与存储隔离**:不同浏览器进程维护各自独立的 JS 内存与 `localStorage`,直接向单个浏览器下发指令会导致其他窗口不同步。
2. **桌面应用沙箱限制**:部分桌面客户端的内置浏览器运行在受限沙箱中,外部调试探针无法穿透读取宿主页面的 `window` 原型链或挂载对象。
3. **多 Calling Client 并发**:支持多个 AI 会话、测试脚本同时并发调用 `http://127.0.0.1:4005/rpc`,内部通过基于 UUID 的 `reqId` 严格隔离响应,互不干扰、不会串号。

### 安全边界(必须先读)

桥接服务**默认只绑定 127.0.0.1**,不接受局域网访问,本机调用**免鉴权**——跨域浏览器请求由 Origin 白名单(默认仅 `localhost`/`127.0.0.1` 的 :4002)拦截,本机脚本/curl 直接调:

```bash
curl -X POST http://127.0.0.1:4005/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"dispatch","action":{"type":"transport.play","payload":{}}}'
```

### 部署形态(本机 / 内网 / 公网)

桥有两种角色:**本机**(默认,`bun run dev` 自动启动)与**集中式**(一台机器跑桥,多个远程展示端接入)。

| 形态       | 启动方式                                                                 | 展示端如何接入                                                              | 调用方如何接入                                                   |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 本机(默认) | `bun run dev` 或 `bun run bridge`                                        | 打开 `http://127.0.0.1:4002/`,页面自动连 `ws://127.0.0.1:4005`              | 同机任意进程 POST `http://127.0.0.1:4005/rpc`                    |
| 内网共享   | `bun run bridge --host=0.0.0.0 --origins=http://<bridge机器IP>:4002`     | 打开 `http://<bridge机器IP>:4002/?bridge=ws://<bridge机器IP>:4005`          | 内网任意机器 POST `http://<bridge机器IP>:4005/rpc`               |
| 公网       | 自行用带鉴权的 Caddy/Nginx 终结 TLS,反代到桥的 4005;桥仍绑回环或内网地址 | 打开部署好的 `https://amwyygyuge.github.io/3d-director-desk/?bridge=wss://bridge.your-domain.com` | 公网 POST `https://bridge.your-domain.com/rpc`(鉴权由反代层负责) |

要点:

- **桥本身没有任何鉴权**。本机回环下这是安全的:浏览器的跨域请求带 Origin,白名单之外的直接 403;能发裸 HTTP 的本机进程本来就有本地执行权。一旦 `--host=0.0.0.0`,内网里任何人都能直接驱动你的导演台——只在可信网络这么干;公网必须由反代层补鉴权。
- **`--origins` 必须与展示端页面的实际 Origin 完全一致**(协议+主机+端口,不含路径),GitHub Pages 项目站点就是 `https://<user>.github.io`(仓库子路径不属于 Origin),否则 WS 握手会被拒。
- **`?bridge=` 参数控制页面连哪台桥**;不给时非 localhost 页面不连桥(纯观赏模式)。
- **公网必须走 WSS/HTTPS 反代**;桥自身只讲明文 WS/HTTP。
- 内网共享形态下,多个浏览器标签页连同一台桥,`dispatch` 广播镜像到全部页面;读操作由首个活跃端应答,指定 `targetClientId` 单播。

### 接口与调用契约

服务端口监听在 `http://127.0.0.1:4005`(启动命令:`bun run bridge`,或随 `bun run dev` 自动启动):

#### 1. 状态查询 (`GET /status`)

返回当前在线的所有浏览器展示端列表与元数据(`clientId`/`userAgent`/`viewport`/`readyState`),以及 `evalAllowed` 标记。

#### 2. 技能文档 (`GET /skill` · `GET /skill.json`)

把本手册经 HTTP 提供给 AI 端——**AI 不应依赖本地文件路径读 SKILL.md**(远程 agent、沙箱环境都读不到盘)。`/skill` 返回 Markdown 原文,`/skill.json` 返回 `{ name, filePath, sizeBytes, rawContent }` 结构化包装。均只读、免鉴权、禁缓存。

#### 3. 命令调度 (`POST /rpc`)

- **写操作 (dispatch)**:默认广播到当前所有已连接的浏览器标签页;要单播就传 `targetClientId`。
    ```json
    {
        "method": "dispatch",
        "action": {
            "type": "assets.place",
            "payload": { "id": "hero", "assetId": "builtin.humanoid-generic" }
        }
    }
    ```
- **读操作 (query)**:向首个活跃客户端(或指定 `targetClientId`)发起查询并返回结构化数据。

**多端广播是镜像,不是强一致**:各标签页持有独立的导演台实例,广播只是把同一条命令分别发给各端执行。凡是命令内部生成 id 的(省略 `id` 的 `assets.place`、省略 `startTimeSeconds` 的 `assets.mount` 按播放头排期、`lighting.author` 依赖各端既有灯状态),各端结果会分叉。需要各端一致时,payload 里显式给全 id 与时刻;响应为多端汇总,任一端失败会以 HTTP 207 + `failures` 列表返回,不会静默吞掉。

#### 4. 文件落盘 (`POST /save-file`)

将浏览器端 `capture.frame`/`capture.video` 的产物以 base64 持久化到工程内的 `bridge-output/` 目录(目录自动创建,`filename` 只允许纯文件名,路径穿越会被拒):

```json
{
    "filename": "cinematic_reference.mp4",
    "dataBase64": "<base64 encoded binary data>"
}
```

#### 5. MCP 接入(`bun run mcp`)

MCP 客户端(Claude Code / Cursor / Codex)改走 `scripts/mcp-server.mjs`(仓库根有 `.mcp.json` 模板),不直接摸本节的 HTTP 端点。行为约定:

- 工具面经桥 RPC 的 `list-tools` 方法从页面能力契约现取——与 `listCapabilities` 单一真相源,命令 type 的点映射为下划线(`assets.place` → `assets_place`)。
- 页面未连桥时只有 `desk_status` / `desk_refresh_tools` 两个元工具;页面连上后调 `desk_refresh_tools`,全量工具随 `list_changed` 通知到达。
- 写/读仍按 capability.kind 分流到 dispatch/query,本手册的命令契约、校验与错误语义原样适用。

### 通用调用代码模板 (Node.js / Python)

```js
// Node.js / Bun 调用范例(本机免鉴权)
async function deskRpc(method, action, options = {}) {
    const res = await fetch("http://127.0.0.1:4005/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, action, ...options }),
    });
    return res.json();
}

// 调度命令 (广播镜像到各端)
await deskRpc("dispatch", { type: "transport.play", payload: {} });

// 查询数据 (由活跃端响应)
const state = await deskRpc("query", { type: "transport.get-state", payload: {} });
```

## 自检(拿到页面先做)

```js
const desk = window.__directorDesk;
desk.dispatcher.listCapabilities(); // 能力清单:type/version/kind(command|query)/permissions
desk.dispatcher.listCommands(); // 全部可写命令 type
```

句柄不存在 → 页面不是 playground 或导演台未就绪,等就绪回调后再试。

## 感知(怎么看懂场景)

| 你要知道的                      | 怎么拿                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 资源目录(发现可用模型/动作)     | `query({ type: "assets.list", payload: { kind?: "model"\|"action", category?: "character.human"\|"scenery.geometry"\|"action.performance" } })` → 条目含 license/skeletonFamily(内置人形是 `ue`)/loopMode/embeddedClips                                                                                      |
| 低上下文场景索引                | `query({ type: "desk.inspect", payload: { detail: "brief" } })` → 实体身份/装载态/量纲；要几何细节再用 `focused` + `entityIds`                                                                                                                                                                               |
| 生效相机位姿                    | `query({ type: "camera.get-pose", payload: {} })` → live(实际相机)+ motionSampled(当前时刻运镜期望值),并排即断言                                                                                                                                                                                             |
| 截图溯源                        | capture 后读 `desk.ui.lastCaptureMeta` → requestId/timeSeconds/cameraPose/尺寸(requestId = 命令幂等键,连发截图按它对账)                                                                                                                                                                                      |
| 机位表                          | `query({ type: "camera.list-shots", payload: {} })` → `{ shots: [{ id, shot }], activeShotId }`                                                                                                                                                                                                              |
| 同框断言                        | `query({ type: "camera.check-framing", payload: { subjectIds: [...], atTimeSeconds? } })` → `[{ id, inFrame, marginNdc }]`;`marginNdc < 0` 即出画。缺省按激活机位定义测量(与渲染帧时序无关);给 `atTimeSeconds` 按该时刻 Program 排期测量(运镜片段解析式采样/静态机位定义),无排期或采样失败时按无位姿测量     |
| 播放态                          | `query({ type: "transport.get-state", payload: {} })` → `{ time, isPlaying, isLooping, durationSeconds }`                                                                                                                                                                                                    |
| 时间轴文档                      | `dispatcher.query({ type: "timeline.get-document", payload: {} }, desk)` → 时长/轨道/关键帧                                                                                                                                                                                                                  |
| 运镜编排                        | `query({ type: "motion.get", payload: {} })` → `{ clips: [{ id, cameraId, startTimeSeconds, durationSeconds, keys: [{ id, progress, position, target, fov, handleMode, inHandle, outHandle }], focus, follow, easing }], program, activeProgramCameraId, timelineDurationSeconds, viewMode, previewClipId }` |
| 灯光                            | `query({ type: "lighting.list", payload: {} })`                                                                                                                                                                                                                                                              |
| 灯光发现面(色温词表 + 情绪配方) | `query({ type: "lighting.presets.list", payload: {} })` → 可说的灯色词与 5 档打光情绪                                                                                                                                                                                                                        |
| 单灯详情                        | `query({ type: "lighting.get", payload: { id } })`                                                                                                                                                                                                                                                           |
| 演播室档位                      | `query({ type: "studio.get", payload: {} })` → 地板边长(含 2~~100 合法区间)/画质档/曝光(含 0.2~~3 区间)/环境光照与投影开关/实心地面开关/地板色 + 按影调排布的地板色词表                                                                                                                                      |
| 画面度量(不截图断言曝光影调)    | `query({ type: "capture.measure-frame", payload: {} })` → `{ meanLuma, contrast, clippedHighlights, clippedShadows, subjectLuma, backgroundLuma, subjectSeparation }`,全部 0~1(分离度带符号)                                                                                                                 |
| 输出画幅                        | `query({ type: "output.get-format", payload: {} })` → 预览安全框/PNG/MP4/同框断言共用的中心裁切口径                                                                                                                                                                                                          |
| 骨骼(姿态编辑前必查)            | `query({ type: "pose.bones.discover", payload: { objectId } })`                                                                                                                                                                                                                                              |
| 眼睛(构图确认,仅美学用)         | `dispatch({ type: "capture.frame", payload: {} })` 截图,产物元数据读 `desk.ui.lastCaptureMeta`                                                                                                                                                                                                               |

**分工:度量问数据,美学问截图。默认断言驱动:每步操作后用 query 断言结果,断言过了不截图;只有断言失败(排查)或验收构图(美学)才截图。**

### 资源目录(优先用目录,别手搓 URL)

- `assets.list` 发现 → `assets.place { id, assetId, transform? }` 放模型 / `assets.mount { objectId, assetId, ... }` 挂动作;内置目录含 6 个模型(人形 + 5 个几何体)与 28 条动作条目,动作骨架族统一 `ue`;
- 同一 `assetId` 可重复 `assets.place`，命令会固化一个新 UUID 场景实体 id；
- 内置资源已入库缓存（许可随目录条目可审计）；宿主注入条目可标记 `source: "injected"`，远程条目用 `"remote"`；
- 目录为空 → 内置 catalog.json 加载失败,停止并报告(别改用 URL 硬编)。

### 断言驱动验收协议

| 步骤     | 断言(query)                                                                                          | 失败时                                                      |
| -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 放模型   | `scene.describe` → 该实体 `loadState` 变 `loaded`,`bounds.size` 合理;`mountedActionId` 回读挂载态    | `failed` → 换资产;`loading` 超 10s → 查 URL                 |
| 量纲断言 | `desk.inspect focused` → `spatialScale.kind`;只有 `actor-meters`/`reference-meters` 可用真实米数     | `relative` → 改用比例或补 `physicalMaxDimensionMeters`      |
| 角色身份 | `scene.set-identity` 后 `desk.inspect brief` 回读 `{ role, label }`                                  | 消歧失败 → 用稳定 label 而非猜资源名                        |
| 运镜     | `camera.get-pose`:seek 后 `live` 应逼近 `motionSampled`                                              | 不符 → 检查是否播放中录 key 被拒                            |
| 截图     | `lastCaptureMeta.timeSeconds` == 目标时刻                                                            | 不符 → capture 时机错,重新 seek+capture                     |
| 视频     | `lastVideoMeta.durationSeconds` == 目标时长,文件头 `ftypisom`(MP4/h264,**不是** EBML)                | 录制被拒 → 已有录制在进行(cancel 或等完成)                  |
| 画面影调 | `capture.measure-frame`:`clippedHighlights`/`clippedShadows` < ~0.02、`subjectSeparation` 明显偏离 0 | 过曝 → 降 `studio.set-exposure`;糊在一起 → 换地板色或开投影 |
| 文档接管 | import 后 `scene.describe` 与导出前一致;动作 actionId 恢复                                           | 动作恢复失败 → 看 applicationNotice(资产 URL 不可达?)       |

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
- 装载闸门:涉及实体未 `loaded` 时 stage/place-relative 拒绝并带 `wait-for-model` 选项——先等 `scene.describe` 全 loaded,别硬试。`loaded` 语义 = 壳层归一化已落账,`camera.frame-subject`/`check-framing` 与包围盒测量**可立刻用**,不需要人为 sleep 等沉降。
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
// 1) 一次性:受击反应
dispatch({
    type: "assets.mount",
    payload: { objectId: "actor", assetId: "builtin.action.hit-chest", startTimeSeconds: 0, durationSeconds: 2.8 },
});
// 2) 循环:走路 —— 时段声明为「对齐到走位轨的某个关键帧区间」,不手填时间
dispatch({
    type: "assets.mount",
    payload: {
        objectId: "actor",
        assetId: "builtin.action.walk",
        alignToTrack: { trackId: "walk-actor", fromKeyframeId: "k-turn-out", toKeyframeId: "k-walk-end" },
    },
});
// 3) 一次性:收尾倒地
dispatch({
    type: "assets.mount",
    payload: { objectId: "actor", assetId: "builtin.action.death01", startTimeSeconds: 10.3, durationSeconds: 2.5 },
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
- **走路/奔跑资产**(全部 loop):`builtin.action.walk`(常速)、`walk-formal`(正式步态)、`jog-fwd`、`sprint`、
  `crouch-fwd`(蹲行)、`swim-fwd`。内置共 28 条动作,骨架族统一 `ue`,**18 条 loop / 10 条 once**——
  待场类(`idle`、`idle-talking`、`sitting-idle`、`idle-torch`、`dance`、`push`、`driving`、`fixing-kneeling` 等)是 loop,
  事件类(`sitting-enter`/`sitting-exit`、`jump-start`/`jump-land`、`interact`、`pickup-table`、`roll`、
  `hit-chest`、`hit-head`、`death01`)是 once。**别猜 id**,`assets.list` 的 `id` 与 `loopMode` 是唯一依据。
- **`action.set-range` 在多段下要带 `performanceId`** 定位改哪一段,缺省改首段。显式改时段会**解除对齐**
  (作者的直接操作胜过声明式派生),想保留对齐就别用它。拖到与邻段交叠会被
  `action-overlapping-performance` 拒下。
- **删一段用 `action.unmount-performance { objectId, performanceId }`**;`action.unmount` 是清空该实体
  **全部**动作,多段序列下用错会把其余几段一起抹掉。
- **每段排期在时间轴上各自成条**,段条 id 即 `performanceId`;拖条、选中、Delete 都按段生效。

#### 时段填充策略(拉长段条 ≠ 慢放)

排期时长与 clip 原生时长不等时,由 `fillPolicy` 决定怎么铺满这段时间。三态各回答不同的问题:

| fillPolicy | 拉长时段的效果   | 典型用法                       |
| ---------- | ---------------- | ------------------------------ |
| `repeat`   | 演更久(原速接续) | 走路/待场等可无缝循环的动作    |
| `hold`     | 保持终态更久     | 倒地/受击/取物等一次性事件     |
| `stretch`  | 慢放(变速铺满)   | 刻意的慢动作/快动作,必须显式选 |

```js
dispatch({
    type: "action.set-fill-policy",
    payload: { objectId: "actor", performanceId: "perf-walk", fillPolicy: "repeat" },
});
// fillPolicy: null = 第四态「跟随资产」:loop 资产落 repeat,once 资产落 hold
```

- **`null` 不是 `repeat` 的别名**,是「跟随资产循环语义」的独立状态;`assets.mount` 缺省即 `null`。
- 三条分支都是纯函数(相位取模、不累积状态),scrub / 倒放 / 跳帧复现同一帧。
- 多段序列下传 `performanceId` 定位(缺省改首段);只改填充方式,**不动段的起止**。
- `action.set-range` 改时段**不会**顺带改填充策略——想「走更久」改时段就够,不必碰 stretch。
- 段条选中后检查器/时间轴有同一入口(UI 与 AI 共读同一模型),随文档往返。

### 时间轴（走位关键帧）

```js
dispatch({ type: "timeline.set-duration", payload: { duration: 5 } });
dispatch({
    type: "timeline.add-key",
    payload: {
        trackId: "track-mecha",
        targetId: "mecha", // 轨道已存在时可省略(沿用轨道归属对象);新建轨道必填
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

// 镜头参数(按摄影语言,不用 fov 这个渲染量);机位须已存在,只改给出的字段
dispatch({
    type: "camera.set-lens",
    payload: { id: "机位 02", focalLengthMm: 85, apertureFStop: 1.8, focusDistanceMeters: null },
});

// 推荐入口：一次落地可编辑的运镜片段和 Program 输出。
dispatch({
    type: "motion.create-take",
    payload: {
        id: "take-push-01",
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

`CameraKey` 是一帧完整画面：`position`、`target`、`fov`。`fov: null` 表示**写入时**取当时激活机位的 fov(无激活机位取默认 45)——是一次性快照,写入后机位再改不跟随。`focus` 是可选的注视覆盖层，非空时接管 key 的 `target`，`null` 则回到 key 的 target 插值。`follow` 是可选跟拍绑定：其局部坐标是内部实现细节，AI 应优先传 `follow.approach` 与 `frame` 枚举，不根据世界轴手写相对偏移。`progress ∈ [0,1]` 是**片段内轨迹参数**（不是时间比例）：整段时间曲线 `easing` 把归一化时间映射成它，`smooth` 下 `progress = 3p² - 2p³`（`p` = 归一化时间），`linear` 下两者相等；反解 `p = 0.5 - sin(asin(1 - 2·progress) / 3)`。拉伸或重定时片段不改变运镜形状。要在「某个时刻」落画面，用 `motion.set-key` 前先按上式换算，或直接在镜头视角摆好画面让 UI 落键。

编辑命令：`motion.set-key`（存在即覆盖）/ `motion.move-key` / `motion.remove-key` / `motion.set-key-handle` / `motion.reset-key-handles` / `motion.set-clip-easing` / `motion.set-clip-range` / `motion.set-focus` / `motion.remove-clip`。`motion.preview.enter` / `motion.preview.exit` 控制指定片段预览：进入预览时若 playhead 不在片段内会自动 seek 到片段起点，且预览片段的取景优先于 Program 排期；`view.set-mode { mode: "director" | "lens" }` 切换导演/镜头视角；`transport.set-loop { loop: boolean }` 控制整段循环。

跟拍命令速查：

| 命令                       | payload                                                                                   | 行为                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `motion.replace-clip`      | `{ clip }`                                                                                | 整片段覆盖写入；片段须已存在                     |
| `motion.bind-follow`       | `{ id, objectId, anchorOffset, frame: "world"\|"heading", lagSeconds, smoothingSeconds }` | 绑定跟拍，关键帧改为相对主体坐标；绑定时画面不跳 |
| `motion.unbind-follow`     | `{ id }`                                                                                  | 解除跟拍，烘回世界坐标；解绑时画面不跳           |
| `motion.set-follow-params` | `{ id, objectId, anchorOffset, frame: "world"\|"heading", lagSeconds, smoothingSeconds }` | 只改参数，不重算关键帧                           |

`motion.author` 的 `move` 词汇：`dolly-in`、`dolly-out`、`pan`、`tilt`、`truck`、`crane`、`orbit`、`hold`。同一机位片段不得重叠；`motion.create-take` 若其它机位占用 Program 时段会返回结构化 `program-overlapping-clip`，按 options 重试，不要手工补 Program。

镜头(`camera.set-lens`)是**机位的光学层**,与几何(position/target)分开写:

- `focalLengthMm` 写入即换算成 `fov`(派生量,不另存两份),换算吃**输出画幅**比例——同一支 50mm 在 16:9 与 1:1 上视场角不同,所以改 `output.set-format` 后标称焦距对应的视场角会跟着变。惯用值:24 广角 / 50 标准 / 85 人像特写;围栏由 fov 围栏按画幅反算,越界会报出该画幅下的合法区间。
- `apertureFStop` 在 f/0.7~~f/22,越小景深越浅;`focusDistanceMeters` 为 `null` 表示自动对焦到注视点,否则 0.05~~500 米。
- **只改给出的字段**,便于「只改光圈」这类单点调整;反过来 `camera.set-shot` 不给 `lens` 时保持原镜头,不会把刚设好的光圈静默清掉。
- 读回走 `camera.get-pose` 的 `liveFocalLengthMm`(按当前画幅从 live fov 反算),机位表读 `shot.lens`。随文档往返(v23)。

### 灯光与成像

```js
// 情绪打光(聚合命令,一步撤销):切 custom → 清旧情绪灯 → 放灯组 → 设曝光 → 设投影
dispatch({ type: "lighting.author", payload: { mood: "low-key", subjectId: "hero" } });
// mood 词表:neutral 中性均匀 | low-key 低调暗部 | silhouette 逆光剪影 | golden-hour 黄金时刻 | night 夜景冷调
dispatch({ type: "scene.set-lighting-mode", payload: { mode: "studio" | "custom" } });
dispatch({ type: "light.adjust", payload: { id: "key-light", light: { intensity: 40 } } }); // 部分更新:缺省字段沿用现灯;带 type 换灯型时 color/intensity 随身、专属参数(distance/decay/angleDegrees/penumbra)回新灯型默认再叠给出的字段。现状先 lighting.list / lighting.get,灯色词表查 lighting.presets.list

// 成像档位(工程级,随文档往返;凡影响性能必可关)
dispatch({ type: "studio.set-exposure", payload: { exposure: 1.2 } }); // 0.2~3
dispatch({ type: "studio.set-environment-lighting", payload: { enabled: true } }); // IBL,金属度/粗糙度才参与成像
dispatch({ type: "studio.set-shadows", payload: { enabled: true } }); // 实时投影,接地感主来源(缺省关)
dispatch({ type: "studio.set-floor-surface", payload: { enabled: true } }); // 实心地面(缺省关)
dispatch({ type: "studio.set-floor-color", payload: { color: "#3b2f2a" } }); // 6 位十六进制,色名词表查 studio.get
dispatch({ type: "studio.set-grid-size", payload: { meters: 12 } }); // 参考地板边长 2~100 米,是空间基准
dispatch({ type: "studio.set-render-quality", payload: { quality: "high" } }); // high 满像素比+抗锯齿 / performance 换帧率
```

**打光的验收是数值,不是截图**:`lighting.author` 之后用 `capture.measure-frame` 断言影调——
`clippedHighlights` / `clippedShadows` 高就是细节已裁掉(降 `studio.set-exposure`),
`contrast` 过低是灰平一片(开 `studio.set-shadows` 或换地板色),
`subjectSeparation` 接近 0 说明主体没从背景跳出来。**分离度是带符号的**:负值是剪影/逆光,
那是有效的电影语言而不是错误——做 `silhouette` 时就该看到负值。

`lighting.author` 只接管**自己产出**的灯(按 id 前缀识别),作者手放的灯不动;
灯位按被摄体包围球半径定尺(给 `subjectId` 更准,缺省取全场景模型合并包围球),
所以同一情绪对人偶与建筑都成立。它是聚合命令——撤销一步回到打光前的灯组 + 曝光 + 投影。

地板颜色只在实心地面开启时可见:要用地板压反差,`set-floor-color` 与 `set-floor-surface` 成对下。
人偶默认肤色 `#d8d3ca`,与内置几何体几乎同色——多人布景仍要 `actor.appearance.set` 分色。

### 成片采集

```js
dispatch({ type: "capture.frame", payload: { requestId: "shot-01" } }); // 截图(隐藏辅助物);requestId 可选,产物元数据原样回带
dispatch({ type: "capture.video", payload: {} }); // 录 MP4/h264(缺省=当前播放范围;产物在 ui.lastVideoUrl/lastVideoMeta)
dispatch({ type: "capture.video-stop", payload: {} }); // 在当前帧边界收尾并交付产物
dispatch({ type: "capture.video-cancel", payload: {} }); // 放弃录制(丢弃产物)
dispatch({ type: "output.set-format", payload: { formatId: "16:9" } }); // 画幅:安全框/PNG/MP4/同框断言共用;合法值 auto | 21:9 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16(不是 "landscape-16-9")
dispatch({ type: "view.frame", payload: {} }); // 导演视角取景到场景内容
dispatch({ type: "scene.clear", payload: {} }); // 一次清空全部对象(连带运镜与 Program),一步可撤销;场景已空时结构化拒绝
```

### 文档导出/接管

```js
// 导出整桌为一份 JSON(实体/机位+镜头/运镜/时间轴/动作排期/灯光/演播室档位)——存档或交给另一个控制台接管
const doc = query({ type: "desk.export-document", payload: {} }).value;
// 导入(替换式,清空重建;动作 clip 按 URL 异步重取并恢复挂载;可撤销)
dispatch({ type: "desk.import-document", payload: { document: doc } });
```

- 文档版本门:当前 `DESK_DOCUMENT_VERSION = 23`,版本不符直接结构化拒绝(`document-version-unsupported`),旧档不迁移——重导前先重新导出。别把手册里的版本号当常量抄,以 `desk.export-document` 回带的 `version` 为准。
- v23 起机位带镜头光学参数(`shot.lens`:光圈 + 对焦距离);v22 起演播室档位带实心地面开关。曝光/IBL/投影/地板色与动作段的 `fillPolicy` 都随文档往返。
- `actions[].mountedOn` 是实体 id 数组:同一动作挂 N 个实体,导入后全部恢复挂载且共享同一动作实例。
- `lighting.mode` 随文档往返:custom 模式导入后不回退 studio;灯本体是实体,参数在 `entities[].light`。
- 动作恢复是异步流水线(重取资产 → 注册 → 等运行时就绪 → 挂载):import 返回 ok ≠ 已挂载,断言挂载要轮询 `scene.describe` 的 `actionSequence`。

## 工作流配方(标准成片路径)

1. **感知**:`desk.inspect brief` → 对候选实体 `focused`；先读取身份、装载态、量纲，不截屏。
2. **布景**:放模型 → 等 `loaded` → `scene.set-identity` → **摆自然初始姿态(见下)** → `scene.stage` / `object.place-relative` → 朝向点积断言 → `camera.frame-subject` → `camera.check-framing`;
3. **动作**:`assets.mount` 按目录条目挂(id 与 loopMode 从 `assets.list` 读,别猜)→ 骨骼不兼容会收到 `bone-incompatible` 类 issue,换一个动作或换模型,别硬试;时段与 clip 时长不等时用 `action.set-fill-policy` 选 repeat/hold/stretch;
4. **时间轴与运镜**:set-duration → 打关键帧（仅走位使用 timeline）；优先 `motion.create-take` 一次创建片段和 Program 输出;镜头光学参数走 `camera.set-lens`;
5. **灯光与成像**:`lighting.author` 给情绪打底(studio 兜底,custom 微调)→ `capture.measure-frame` 断言影调 → 需要接地感就开 `studio.set-shadows` + `studio.set-floor-surface`;
6. **验收**:以 `scene.describe`、`camera.get-pose`、`camera.check-framing`、`capture.measure-frame` 做位置/尺寸/同框/影调断言；只有美学终审才截图;
7. **导出**:`output.set-format` 定画幅 → capture.frame 逐时间点 seek + 截图 = 参考帧序列;整段成片走 capture.video。

### 初始姿态:人偶落地就是 T-pose,必须摆

`assets.place` 的人偶默认停在 **T-pose(侧平举)**,任何场景下都出戏。放完模型、在 stage 之前先摆一个该场景下的自然姿态:

```js
// 两段式:下半身定站/坐/跪,上半身定手臂。merge 才能分别叠加,replace 会互相覆盖。
dispatch({ type: "pose.apply-preset", payload: { objectId: "hero", presetId: "lower-stand", mode: "merge" } });
dispatch({
    type: "pose.apply-preset",
    payload: { objectId: "hero", presetId: "upper-stand-natural", mode: "merge" },
});
```

`pose.presets.list` 读全表(内置 21 项,分 `lower` / `upper` 两部位),**id 以查询回带的为准**。
下半身:`lower-stand`(站立)、`lower-sit-chair`(椅上坐)、`lower-crouch`(蹲伏)、`lower-kneel`(单膝跪)、
`lower-swim`、`lower-lying`(倒地)、`lower-airborne`(腾空)。
上半身:`upper-stand-natural`(站姿·自然,对峙/待场默认)、`upper-talking`(交谈)、`upper-sit-rest`(坐姿·垂手)、
`upper-sit-talking`、`upper-crouch-balance`、`upper-kneel-work`、`upper-walk-swing`、`upper-run-swing`、
`upper-jump-spread`、`upper-reach`、`upper-push`、`upper-hit`(受击·护胸)、`upper-dance`、`upper-swim`。
自定义预设走 `pose.preset.save` / `pose.preset.remove`,误删内置用 `pose.preset.restore` 恢复。

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

- **Windows 下克隆目录落在 8.3 短路径下(`C:\Users\CAIJUN~1\...`),`bun run dev` 起服即崩**(libuv fs-event 断言):Vite 文件监听拿短路径与真实长路径对不上。修法:克隆到长路径目录(如 `C:\dev\`),或把 `TEMP` 显式设为长路径后再起服。macOS/Linux 无此问题。

- **非安全上下文(http 非 localhost)**:旧部署里 `crypto.randomUUID` 不存在,`desk.animations.register`、文档导入的动作恢复、检查器动作置备全部抛 `crypto.randomUUID is not a function`(导入侧表现为 toast「动作 "X" 恢复失败」)。先用 `crypto.getRandomValues` 注入 UUIDv4 polyfill 再操作。源码已修(统一 `createId` 兜底,getRandomValues 优先),重新部署后不再需要 polyfill。
- **浏览器驱动**:页面 JS 必须在 `tab.evaluate` 里执行(工具运行域没有 `window`);等句柄用 `wait(() => tab.evaluate(...))` 轮询,`tab.waitForFunction` 不存在。Chrome 已有实例在跑时 spawn 会 CDP 超时,加 `--user-data-dir` 隔离配置重试。
- **有头浏览器观测**:`browser.open` 走 relay/`app.path` 都可能失败(relay 扩展未连、spawn 后无 page target)。可靠路径是自己起 Chrome 再 CDP 附着:`"/Applications/Google Chrome.app/.../Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/xxx <url> &`,然后 `browser.open({ app: { cdp_url: "http://127.0.0.1:9333" } })`。
- **`tab.evaluate` 有 30s 硬上限**:每次 capture 约需 1s 沉降,多时间点/多实体的循环审计务必拆成一次一个探针的多次调用,否则整段超时且 VM 状态被重置。
- **`tab.screenshot()` 拿不到 WebGL 画面**:返回的是页面截图文件路径(webp),画布内容可能全黑;同理在页面里 `createImageBitmap(canvas)` 读回可能全 0。要看渲染结果只信 `capture.frame` 的产物(`desk.ui.lastCaptureUrl`,blob URL,每次 capture 换新)。
- **`capture.video` 在非安全上下文静默失败(必踩)**:远程 http 源(如 `http://192.0.2.10:4000`)下 `dispatch` 返回 `ok: true`,但 `videoExport.currentState` 一直停在 `"idle"`,`ui.lastVideoUrl` / `lastVideoMeta` 永远是 `null`,**页面上没有任何 toast**。真实原因只在 console 里:`[capture] MP4 export failed Error: VideoEncoder is not available in this environment; this may be because this page is running in an insecure context.` —— WebCodecs 的 `VideoEncoder` 是 secure-context-only API,`MediaRecorder` 存在也没用(它只报 webm,导出走的是 MP4/h264 编码路径)。
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
          --unsafely-treat-insecure-origin-as-secure=http://192.0.2.10:4000 \
          "http://192.0.2.10:4000/" &
        ```
        `--user-data-dir` 必须给一个**新目录**(该 flag 只在全新 profile 的进程上生效);源串要精确到 `scheme://host:port`,不带路径、不带尾斜杠。附着后断言 `window.isSecureContext === true && typeof VideoEncoder !== "undefined"`,两者都为真才录。其它可行路径:把页面挂到 `localhost`(端口转发 `ssh -L 4000:192.0.2.10:4000`,localhost 天然是安全上下文)或给部署上 HTTPS。
    - **换窗口重录不要用 `desk.export-document` → `desk.import-document` 搬场景**:实测导入后动作恢复是异步流水线,会卡在「动作挂载等待运行时超时:hero / aide」,`scene.describe` 的 `actionSequence` 长期停在 0(只有部分实体恢复),而且 `actor.appearance` / `build` 不随文档往返。补挂 `assets.mount` 也不生效。可靠做法是在新窗口**按命令重放布景脚本**(place → identity → appearance/build → pose → timeline → mount → shots → motion → lights),重放是幂等且快的。

### 契约偏差(以实测为准)

- `assets.place`:`id` 实际必填(能力元数据标的是可选),缺 id 报 `command-construction-failed`;同一 assetId 摆多个实例时各给各的 id。
- `scene.describe` 的 `value` 是实体数组本体,不是 `{ entities: [...] }`——轮询 loadState 别取错层。
- `actor.build.set` / `actor.build.apply-preset`:播放期拒改,issue `transport-playing` 自带 `pause-transport` 选项——先暂停→改→恢复播放。`actor.appearance.set`(上色)不受播放限制。
- `light.adjust`:intensity 围栏 0~100,超了报 `lighting.invalid-payload` 并指名 `light.intensity`。物理衰减下嫌暗优先降 `decay`、拉近灯距,别硬堆强度。payload 是**部分更新**:只传要改的字段即可,不必回传整套灯参。
- `motion.get` 的 clip **不带 `cameraId` 字段**(只有 id/startTimeSeconds/durationSeconds/keys/focus/follow/easing)。按机位找片段要匹配 `id`(`motion.author` 生成的 id 形如 `take-<机位名>-<move>-<start>`),不要读 `c.cameraId` —— 会得到 undefined 然后炸在 `.keys`。
- `timeline.set-duration` **不联动播放范围**:`program.review` 的 `range.outSeconds` 仍是旧值。改时长后补一条 `timeline.set-playback-range { inSeconds, outSeconds }`,否则录制/输出按旧范围截断。
- `capture.video` 的产物在当前环境是 **MP4/h264**(`ftypisom` 头),不是 WebM/EBML。验收查 `lastVideoMeta.durationSeconds` + `ffprobe`,不要断言 EBML 魔数。**前提是安全上下文**,否则永远拿不到产物(见「页面环境」)。
- `motion.create-take` **不吃 `cameraId`**(传了会被 `payload-contract-violation` 拦下,报 `payload.cameraId 为未知字段`)。片段身份只有 `id`;要绑机位就先 `camera.frame-subject` 建机位,再用同名前缀的 clip id 自己记账。`motion.author` 反过来**必须**带 `cameraId`。
- `timeline.add-marker` 的字段是 **`{ id, timeSeconds, label }` 平铺**,不是 `{ marker: {...} }`。
- `assets.mount` 的排期含 release 尾巴,**超出时间轴时长会被拒**(`动作时段和回收不能超出时间轴时长`)。收尾动作排到接近 `duration` 时先 `timeline.set-duration` 留出 1~2s 余量,再挂。
- `scene.describe` 的 `bounds`(size/center)对 scenery **在 `object.move` 改 scale 后不刷新**,读到的是旧包围盒。要算遮挡/间距请用 `transform.position × transform.scale × 资产基础尺寸`(wall `2×1.5×0.1`、column `0.7×2×0.7`、platform `2×0.2×2`),或读 `desk.scene.manager.getRuntime(id)`。
- `motion.set-focus` 的 `worldOffset` 是**注视点相对主体原点的偏移**,不是"抬高一点"的微调量:人偶(1.75m)给 `[0,1.4,0]` 会瞄到头顶以上,把主体挤出画。胸腹高度 `[0,0.9,0]` 才稳。
- `camera.set-lens` 的 `id` 必填且机位**须已存在**(它只改光学层,不建机位);焦距围栏随 `output.set-format` 变——换画幅后同一个 `focalLengthMm` 可能从合法变越界,报错里会带该画幅下的合法区间。
- `action.set-fill-policy` 的 `fillPolicy` 允许 `null`(跟随资产),这是**有效值而非省略**:省略字段与传 `null` 语义不同,契约里它是 nullable 而非 optional。
- `lighting.author` 是聚合命令:它会把灯光模式切到 `custom` 并改写曝光与投影开关。要保留手工曝光就在它之后再下 `studio.set-exposure`,否则被情绪配方的建议值覆盖。
- `capture.measure-frame` 需要渲染器已就绪(Canvas `onCreated` 之后),否则结构化拒绝「渲染器未就绪」;它会强制渲一帧后取 64×64 降采样,开销恒定,与画布分辨率无关。
- `studio.set-floor-color` 只吃 **6 位十六进制**字符串(`"red"` 这类颜色名会被拒);颜色要可见需同时 `studio.set-floor-surface { enabled: true }`。

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

**"断言全绿但视觉说只看到一个人"时,先用 `capture.measure-frame` 再用像素探针,不要靠反复问截图。** 实测里三个人偶全部 `inFrame: true`,视觉却只认出一个——真因是 scenery 挡在主体前面且被主光打到接近纯白(采样 RGB `[240,242,245]`),人偶贴在上面等于消失。这类问题现在有一步到位的数值信号:`capture.measure-frame` 的 `subjectSeparation` 接近 0 就是「主体没从背景跳出来」,`clippedHighlights` 高就是过曝已裁掉细节。要定位到具体是哪个主体,再走下面的探针链路(每步都是可证伪的数值):

1. 从 `camera.get-pose` 的 `live`(position + direction + fov)自己算主体的屏幕坐标:构相机基 `r = normalize(dir × [0,1,0])`、`u = r × dir`,投影 `nx = (x/z)/(tan(fov/2)·aspect)`、`ny = (y/z)/tan(fov/2)`,再映射到像素。
2. `capture.frame` 后把产物画进 `OffscreenCanvas`,在每个主体的像素位置 `getImageData` 取 25×25 均值。**同色即消失**:主体与近邻背景 RGB 差 < ~20 就是画面上糊掉了,和构图无关。
3. 疑似遮挡就做射线-AABB 相交:相机 → 主体中心的线段对每个 scenery 盒求交(盒子按 `transform × 基础尺寸` 算,别用 `bounds`)。命中即遮挡。
4. 想确认视觉复核有没有漏读,把投影点画成彩色圆圈叠在截图上再送去问"哪个圈里有人"——比开放式提问可靠得多。
5. 验证假设最快的办法是**临时把 scenery `object.move` 到 y = -200**(撤销一步即回),再取一帧:三个人立刻都认出来了 → 遮挡/同色成立。

修法优先级:降主光 `intensity` / 提 `decay` / 降 `studio.set-exposure` 压掉过曝 → 换 `studio.set-floor-color` 拉开主体与地面的反差 → scenery 往深处推(墙 z ≤ -20、柱子挪出主体横向车道)→ 最后才动机位。每步之后用 `capture.measure-frame` 复核 `subjectSeparation` 有没有真的拉开,别靠再截一张图猜。

**"人偶悬在网格虚空里"用 `studio.set-floor-surface { enabled: true }`**(配 `studio.set-floor-color`),不要再摆 `builtin.scenery.platform` 当地面——实心地面是成像档位的一部分,随文档往返、承载投影接收面,且开 `studio.set-shadows` 才有接地阴影。旧手册里的 platform 变通只是当时没有这个开关。

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- payload 结构有契约:字段名写错、缺必填、类型不符会被 `payload-contract-violation` 拦下并指名字段(dev/playground 直接 throw)。按报错改字段名,不要换格式乱试;字段定义以 `listCapabilities()` 返回的 `payload` 契约为准。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
