# 动作轨(Action Track)设计 · 任务 A

> 状态:**部分已交付**。前置任务 B(实体多段动作排期 + 走位轨自动对齐)见 commit `f66a348`;
> 「多段可见 + 分段寻址」已单独交付(见 §1.3),不依赖 ACTION kind。
> 本文档余下部分描述把排期序列升格为一等公民「动作轨」的设计与成本,不含实现。

## 1. 背景:B 解决了什么,没解决什么

### B 之前的硬阻塞

`SceneObject.mountedAction` 是单字段,`AnimationBinder.mount()` 进门即 `unmount()` 旧动作。
一个实体在一条时间线上只能表演一个动作,因此「被驱赶(一次性) → 调头 → 走路(循环) → 倒地(一次性)」
这类最普通的表演序列无法编排。这不是循环动作特殊,而是**任何两个动作都不能共存**。

### B 已经交付的能力

| 能力                     | 落点                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| 一个实体持有多段动作排期 | `SceneObject.mountedActions`(按起始升序)+ `actionPerformanceAt(t)` 按时刻裁决           |
| 运行时同时持有多个 clip  | `AnimationBinder` 每对象一个 `MountedSequence`,`applySequenceTime` 选出生效者并停掉其余 |
| 追加语义 + 重叠围栏      | `action.mount` 默认追加;交叠返回 `action-overlapping-performance`,首尾相接允许          |
| 走位轨自动对齐           | `alignToTrack { trackId, fromKeyframeId, toKeyframeId }`,时段由关键帧区间派生           |
| 对齐自动跟随重定时       | `reresolveAlignedActions` 挂在六条改关键帧时刻的命令之后                                |
| 循环动作步频同步         | 只驱动当前生效的 `loop` 动作(一次性动作不被位移改写)                                    |
| 文档往返                 | v16:`mountedOn` 逐条导出多段排期并持久化 `alignment`                                    |
| AI 可读回                | `scene.describe` 的 `actionSequence`(含 `alignedToTrackId`)                             |
| 缺失的位移动作资产       | catalog 新增 `builtin.action.walking` / `.running`(复用人偶 GLB 内嵌 clip)              |

### B 遗留的缺口

1. ~~**动作排期在时间轴 UI 上不可见**~~。**已澄清并交付**,见 §1.3:动作行/段条/吸附/拖拽本就存在,
   真实缺口是「只画首段」,已修。
2. ~~**排期不是可编辑对象**~~。**已交付**:段条可拖、可选中、可按段删除、吸附到相邻段的占用末端。
3. **序列语义散落在两处裁决**。`SceneObject.actionPerformanceAt` 与
   `AnimationBinder.applySequenceTime` 各自实现了一遍「哪一段在此刻生效」,
   两处必须保持一致(当前靠注释约束,不是靠类型)。**仍未解决**——这是 A 的主要剩余收益。
4. **同一实体只能有一条动作序列**。想表达「上半身挥手 + 下半身走路」需要并行动作轨,B 无解。

### 1.3 已交付:多段可见 + 分段寻址(不含 ACTION kind)

原文档把「排期在 UI 上不可见」列为 A 的头号缺口,这一判断与代码不符:`TimelineLayout.actionRows`
早已投影出 `TIMELINE_ROW_KIND.ACTION` 行,`ActionTrackBody` 渲染它,段条与 Program/运镜/走位共用
同一套手势层,拖拽落到 `action.set-range`。真实缺口是**按实体寻址**:行内只画
`entity.actionPerformance`(首段),段条 id 即实体 id,于是第二段起不可见、拖任一条都改首段、
Delete 走 `action.unmount` 会卸掉该实体全部动作。

已交付的修正(文档版本 v17):

| 变更               | 落点                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| 排期段有稳定身份   | `ActionPerformance.id`;binder 的 clip、时间轴段条、选中态、文档 `mountedOn` 全按它定位            |
| 逐段投影           | `actionRows` 输出每段一条段条,`TimelineBar.ownerId` 带出所属实体                                  |
| 分段寻址           | `action.set-range { performanceId }`;新增 `action.unmount-performance` 只删一段                   |
| 段级 Delete        | `TimelineSelection.actionClip(objectId, performanceId)`,删除命令改指 `action.unmount-performance` |
| 吸附到真实占用末端 | `TimelineBar.occupancyEndSeconds`(一次性动作含 release 尾巴),解决 §5.2 的「假重叠」               |
| AI 可寻址          | `scene.describe` 的 `actionSequence.performanceId`                                                |
| 内容下界逐段计价   | `TimelineContentSpan` 取最后一段收尾,`fit-duration` 不再截断后续段                                |

顺带修掉的、注册 ACTION kind 当天就会咬人的硬约束(原 §3.1 只列了查重键一条):

| 陷阱                                         | 原行为                                          | 现状                                        |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| 导入校验按 `targetId` 判重                   | 同一实体的第二种轨道 → 工程打不开               | 查重键改 `(targetId, kind)`                 |
| 走位重画清该对象**全部**轨道                 | `removeObjectTracks(targetId)` 会顺带删掉别种轨 | 收窄为 `(targetId, TRANSFORM)`              |
| 改帧率把每枚关键帧重建为 `TransformKeyframe` | 别种轨道过不去                                  | 改走 `keyframeCodecFor(track.kind)`         |
| 删对象的撤销快照含全部轨道                   | 与只接受 transform 的恢复校验冲突               | 快照收窄为 transform,并在两处注明须同批扩张 |
| `evaluateTarget` / 路径辅助物不按 kind 过滤  | 会采到/画出非位姿轨                             | 均已按 `TRANSFORM` 过滤                     |

## 2. 设计:动作轨是第二种 TrackKind

### 2.1 核心取向

`TIMELINE_TRACK_KIND` 当前只注册了 `TRANSFORM`。A 的本质是注册第二种 `ACTION`,
让动作排期成为**轨道上的关键帧**,而不是挂在实体上的旁挂状态。

```
TIMELINE_TRACK_KIND = {
    TRANSFORM: "transform",   // 走位:关键帧 = 位姿
    ACTION: "action",         // 表演:关键帧 = 一段动作演出
}
```

收益不是「更整齐」,而是三件具体的事:

1. **UI 免费**。时间轴已有的轨道渲染、段条拖拽、选中、吸附、缩放、重定时全部复用。
   B 方案里这些都要为动作排期单独写一遍。
2. **命令族免费**。`timeline.set-track` / `retime-track` / `set-key` / `move-key`
   已经是「改轨道」的唯一写入口,动作排期直接继承其撤销、量化、围栏。
3. **裁决唯一**。「此刻演哪一段」变成 `TimelineSampler` 对 ACTION 轨的求值,
   B 里散落两处的裁决(`SceneObject.actionPerformanceAt` 与
   `AnimationBinder.applySequenceTime`)收敛成一处。

### 2.2 关键帧形状

`TransformKeyframe` 的 `value` 是位姿;`ActionKeyframe` 的 `value` 是一段演出:

```ts
interface ActionKeyframeValue {
    readonly actionId: string;
    readonly durationSeconds: number; // 演出时长(不含回收)
    readonly attackSeconds: number;
    readonly releaseSeconds: number;
}
```

关键帧的 `time` 即排期起点,`value.durationSeconds` 给出段长——是**段条**而非**点**,
这是它与位姿关键帧的形状差异,也正是 `keyframeCodecFor(kind)` 预留的扩展点
(`TimelineTrack` 构造期按 kind 取 codec,见 `src/timeline/keyframeCodecs.ts`)。

`trajectory` 对 ACTION 轨恒为 `null`:动作没有空间曲线,codec 的 `trajectory()` 直接返回 null。

### 2.3 对齐层如何迁移

B 的 `ActionAlignment` 是「排期 → 走位轨区间」的声明。进入 A 之后它仍然需要——
「走路段与走位区间同起同止」是跨轨约束,不因动作变成轨道而消失。

迁移方式:`ActionAlignment` 从 `ActionPerformance` 的字段变成 `ActionKeyframe` 的字段;
`reresolveAlignedActions` 从「遍历实体排期」变成「遍历 ACTION 轨关键帧」。
解析函数 `resolveActionRange` **不变**——它只依赖 `AlignableTrack` 最小形状,
当初就是为了这次迁移才抽成独立函数而不是塞进 `TimelineTrack`。

## 3. 改动面与成本

### 3.1 必须放宽的现有硬约束

`timelineCommands.ts:473-474` 有一条校验:**每个对象只能有一个 transform 轨道**。
它按 `(targetId, kind)` 查重(`TimelineDoc.trackForTarget`),因此注册 ACTION 轨
**不需要**放宽这条——同一实体可以同时有一条 TRANSFORM 轨和一条 ACTION 轨。
这是个好消息:查重键当初就带了 kind。

若后续要做「上半身/下半身并行动作轨」(缺口 4),则必须把查重键从
`(targetId, kind)` 扩成 `(targetId, kind, channel)`,并给 ACTION 轨引入 `channel` 概念。
**建议不在 A 里做**,留作独立任务:它牵动骨骼分层混合,是另一个量级的问题。

### 3.2 逐文件成本

| 文件                                          | 改动                                                                 | 量级 |
| --------------------------------------------- | -------------------------------------------------------------------- | ---- |
| `timeline/TimelineTrack.ts`                   | 注册 `ACTION` kind                                                   | 小   |
| `timeline/ActionKeyframe.ts`                  | 新增值对象(参照 `TransformKeyframe`)                                 | 中   |
| `timeline/keyframeCodecs.ts`                  | 注册 action codec(`owns` / `fromInit` / `trajectory` → null)         | 小   |
| `timeline/TimelineSampler.ts`                 | ACTION 轨求值:按时刻选中段,输出生效 `actionId` + clip 局部时刻       | 中   |
| `timeline/PlaybackCoordinator.ts`             | 动作驱动改为读 ACTION 轨采样结果,不再读 `entity.actionPerformanceAt` | 中   |
| `animation/AnimationBinder.ts`                | `MountedSequence` 的裁决职责移交采样层,binder 退回「按指令定帧」     | 中   |
| `core/SceneObject.ts`                         | `mountedActions` 退场(或降级为派生只读投影,供 `scene.describe` 兼容) | 中   |
| `command/actionCommands.ts`                   | `action.mount` 语义改为「往 ACTION 轨写关键帧」                      | 大   |
| `command/timelineCommands.ts`                 | `reresolveAlignedActions` 改为遍历 ACTION 轨                         | 小   |
| `ui/timeline/*`                               | ACTION 轨行渲染 + 段条交互(复用 transform 段条组件)                  | 大   |
| `document/DeskDocument.ts`                    | v19:动作排期从 `actions[].mountedOn` 迁到 `timeline.tracks`          | 大   |
| `document/compatibility/builtinMigrations.ts` | **v18 → v19 迁移器须视发布状态决定**(见 3.3)                         | 中   |

### 3.3 文档版本纪律(硬闸门)

`builtinMigrations.ts` 有一条构造期完整性断言:
`registry.resolvePath(MINIMUM_SUPPORTED, CURRENT)` 断链即抛错,导演台构造直接失败。
当前 `MINIMUM_SUPPORTED === DESK_DOCUMENT_VERSION`(功能未发布,注册表出厂为空)。
**「多段可见 + 分段寻址」已把文档抬到 v17**(`mountedOn[].id` 落盘),
**「跨度外保持」再抬到 v18**(`policies.extrapolation` 落盘);两次都未写迁移器——未发布阶段按红线 11
清洁切换,旧档判不支持。

两种情形:

- **A 在首个正式发布之前落地**:继续同步抬 `MINIMUM_SUPPORTED`,不写迁移器。
- **A 在发布之后落地**:必须在同一次交付里写出 v18 → v19 迁移器,
  把 `actions[].mountedOn[]` 搬进 `timeline.tracks` 的 ACTION 轨(段 id 直接转为关键帧 id),
  并补历史 fixture 恢复验收。

这条来自 `AGENTS.md` 红线 11,不可绕过。

### 3.4 总成本判断

B 是 A 的**真子集**:A 的采样器最终也要做「按时刻选中动作」,而 B 已经把这个裁决
写出来并在浏览器里验证过(三段序列逐时刻采样、对齐跟随重定时、文档往返)。

原判断认为 UI 是 A 最大的一块、且是其主要收益。这一点**已经不成立**:多段段条交互已单独交付,
并不需要 ACTION kind。A 的剩余增量因此集中在两块:

1. **裁决收敛**(缺口 3)——把两处「哪一段生效」合并到采样层。这是 A 现在的**主要收益**。
2. **文档迁移**——机械但不能省。

核心逻辑(kind 注册、codec、采样、对齐迁移)是中小量级,因为 B 已经把领域模型摆对了;
而段身份(`ActionPerformance.id`)已经就位,迁移时可直接充当 ACTION 关键帧 id。

## 4. 建议分期

A 不必一次落地。按「每期都可独立验收」切:

| 期  | 内容                                                                             | 验收                                                |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| A0  | ~~多段可见 + 分段寻址~~                                                          | **已交付**:逐段段条、段级重定时/删除/撤销、v17 往返 |
| A1  | 注册 `ACTION` kind + `ActionKeyframe` + codec;采样器能对 ACTION 轨求值           | story:给一条 ACTION 轨,逐时刻断言选中段正确         |
| A2  | `PlaybackCoordinator` 改读 ACTION 轨;`SceneObject.mountedActions` 降级为派生投影 | 复跑 B 的三段序列验收,行为不变                      |
| A3  | `action.mount` 改写为往 ACTION 轨写关键帧;对齐层迁移                             | B 的对齐验收全部复现(拖关键帧、整轨 retime)         |
| A4  | 时间轴 UI 改读 ACTION 轨(段条交互复用 A0 已有实现)                               | 段条行为与 A0 一致,无回归                           |
| A5  | 文档 v19 + 迁移器                                                                | v18 fixture 导入后动作序列与对齐完全恢复            |

A1-A3 期间对外契约(`action.mount` payload、`scene.describe.actionSequence`)保持不变,属内部重构;
A4 是投影源替换而非新能力(作者可见能力已由 A0 交付);A5 是持久化收口。

## 5. 风险与已知坑

### 5.1 两个 mixer 同写骨骼

B 实测踩到:非生效 clip 必须显式 `action.stop()`,否则两个 `AnimationMixer`
同时写同一根骨头会互相覆盖(表现为动作抖动/错位)。
A 把裁决移交采样层后,这条纪律**依然成立**——binder 仍要保证同一时刻只有一个 clip 有权重。

### 5.2 release 尾巴造成的「假重叠」

一次性动作的实际占用是 `[start, start + duration + releaseSeconds]`。
B 实测:走位段 4→10s 的走路动作,release 到 10.25s,
此时在 10s 挂倒地会被 `action-overlapping-performance` 正确拦下。
段条吸附必须吸到 `releaseEndTimeSeconds` 而不是 `endTimeSeconds`,否则作者拖出来的段一挂就被拒。
**已交付**:`TimelineBar.occupancyEndSeconds` 承担这件事(循环动作无尾巴,等于演出结束时刻),
吸附候选取它而非视觉末端。

### 5.3 `path` 朝向与原地转身互斥

`TrackPolicies.orientation` 默认 `path`(朝向锁死轨迹切线)。原地转身时切线为零,
朝向不会变——「调头」必须显式切 `keyed` 并用关键帧 `rotation.y` 表达。
这与动作轨无关,但任何「走位 + 转身」的验收场景都会撞上,值得写进 A 的 story。

### 5.4 对齐的解析失败必须结构化

B 的 `action-alignment-unresolved` 覆盖「轨道不存在 / 关键帧 id 不匹配 / 区间零长」。
A 里 ACTION 轨与 TRANSFORM 轨在同一文档内,作者可能删掉被对齐的走位轨——
此时对齐关键帧应保留声明但退回上次解析值(而非静默变成零长段),并在 `program.review` 类查询里可见。

## 6. 不在 A 范围内

- **并行动作轨**(上半身/下半身分层):需要 `channel` 概念 + 骨骼分层混合,独立任务。
- **动作间 blend**:当前 attack/release 是「动作 ↔ 常驻姿势」的过渡,不是「动作 A ↔ 动作 B」。
  跨段交叉淡化需要两个 clip 同时有权重,与 5.1 的纪律冲突,须专门设计。
- **倒地类资产补齐**:B 用现有动作(抱头/否定)验证了序列机制;真实成片需要 falling/death clip,
  属资产任务而非模型任务。
