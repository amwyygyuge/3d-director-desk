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

| 你要知道的           | 怎么拿                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| 场景里有什么         | `desk.scene.manager.list().map(e => e.toJSON())` → id/kind/name/transform/灯光/姿态         |
| 机位表               | `desk.camera.director.listShots()` → `[id, CameraShot]`;当前激活:`desk.camera.activeShotId` |
| 时间轴文档           | `dispatcher.query({ type: "timeline.get-document", payload: {} }, desk)` → 时长/轨道/关键帧 |
| 运镜路径             | `query({ type: "motion.get", payload: {} })` → 关键帧 + 可创作条件                          |
| 灯光                 | `query({ type: "lighting.list", payload: {} })`                                             |
| 骨骼(姿态编辑前必查) | `query({ type: "pose.bones.discover", payload: { objectId } })`                             |
| 多机位连续性体检     | `query({ type: "continuity.check", payload: { subjectId, shotIds } })`                      |
| 眼睛(构图确认)       | `dispatch({ type: "capture.frame", payload: {} })` 截图;多模态看画面,度量看上面的数据       |

**分工:度量问数据(距离/朝向/尺度从 transform 算),美学问截图。** 不要凭截图猜坐标。

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

```js
dispatch({ type: "action.mount", payload: { objectId: "mecha", actionId } }); // actionId 从 animations 资产表查
dispatch({ type: "transport.play", payload: {} });
dispatch({ type: "transport.seek", payload: { time: 2.0 } }); // 秒
dispatch({ type: "transport.pause", payload: {} });
```

### 时间轴(走位/姿态关键帧)

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
// timeline.move-key / remove-key / set-key-easing 同族
```

easing 只有两档:`"linear"` / `"smooth"`。**节奏靠关键帧密度 + easing 组合表达**(见「运镜语言」)。

### 机位与运镜

```js
// 静态机位
dispatch({
    type: "camera.set-shot",
    payload: { id: "机位 01", shot: { position: [0, 1.6, 4.2], target: [0, 0.9, 0], fov: 45 } },
});
dispatch({ type: "camera.activate", payload: { id: "机位 01" } });
dispatch({ type: "camera.deactivate", payload: {} });
// 运镜关键帧(沿时间轴的相机轨迹);shot 可显式给,也可省略 = 记录当前导演视角
dispatch({
    type: "motion.add-key",
    payload: { id: "mk1", timeSeconds: 0, easing: "smooth", shot: { position: [8, 3, 8], target: [0, 1, 0], fov: 45 } },
});
```

约束:运镜关键帧时间唯一且 ≤ 时间轴时长;播放中/掌镜中不能记录(issues 会告诉你)。

### 灯光与成片

```js
dispatch({ type: "scene.set-lighting-mode", payload: { mode: "studio" | "custom" } })
dispatch({ type: "light.adjust", payload: {...} })   // 细节先 lighting.list 看现状
dispatch({ type: "capture.frame", payload: {} })     // 截图(隐藏辅助物)
dispatch({ type: "view.frame", payload: {} })        // 导演视角取景到场景内容
```

## 工作流配方(标准成片路径)

1. **布景**:放模型 → 摆位(面对面 = 两实体 position 相对 + rotation 朝向对方)→ `view.frame` 取景;
2. **动作**:挂 clip → 骨骼不兼容会收到 `bone-incompatible` 类 issue,换一个动作或换模型,别硬试;
3. **时间轴**:set-duration → 打关键帧(走位用 timeline,姿态用 pose.add-key);
4. **运镜**:motion.add-key 逐时间点写相机快照;
5. **灯光**:studio 兜底,custom 微调;
6. **验收**:播放/seek 逐段截图,多模态审构图;continuity.check 体检;
7. **导出**:capture.frame 逐时间点 seek + 截图 = 参考帧序列。

## 运镜语言速查(语义 → 参数)

| 说法                 | 落地                                                  |
| -------------------- | ----------------------------------------------------- |
| 由快到慢             | 前段关键帧间距大+easing smooth,末段间距小             |
| 急停/打击感          | 打击时刻前后各打一帧(位置几乎不动),形成速度阶梯       |
| 推近                 | 关键帧序列 position 向 target 收拢,fov 可同步略降     |
| 全景交代             | 远景 position + fov 40~50;特写 = 近距离 + fov 30 上下 |
| 尺度感(如 50 米机甲) | 用 scale 断言 + 低机位仰拍(target.y 高于 position.y)  |

## 纪律

- 一切数值先过脑子再过围栏:NaN/Infinity 必被拦;id 不存在必被拦——先 `list()` 确认。
- 撤销/重做是命令层自动的(逆命令回放),你不需要管理历史。
- 禁止把 three 对象(Object3D/Material)抓出来玩;你碰不到也不该碰。
- 同一批相关改动连续 dispatch 即可,每条的 issues 独立返回。
