# 阶段一·基础实现 — 任务拆分与类设计

## 扩展性审计(对阶段二~四)

| 未来需求          | 结构结论                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| 二·运镜轨迹       | `CameraShot` 保持静态值对象;运镜引入 `CameraMotionPath` 兄弟类型,不动现有 API                                 |
| 二·时间轴编排     | **已预埋 `TimeTransport`**:统一 playhead,播放 `tick(delta)` / 定位 `seek(t)`;`AnimationBinder.setTime` 已就位 |
| 二·多机位         | `CameraDirector` 多机位 Map + 激活切换,已满足                                                                 |
| 二·姿态精修       | `SceneObject` 加 pose 字段,兼容变更                                                                           |
| 二·灯光           | `SceneObjectKind` 加 `"light"` 成员,兼容变更                                                                  |
| 三·喂 AI / 风格化 | `CaptureService` → `HostBridge` 链路已通,AI 渲染在 Monet 侧                                                   |
| 三·游戏音频       | 挂 `TimeTransport`,吃统一时钟红利                                                                             |
| 四·引擎/DCC 导出  | **已立纪律**:场景状态全纯数据、可 JSON 往返;届时补 `DirectorDocument` 版本化 schema + Serializer              |
| 四·协作           | 同上,以文档模型为前提                                                                                         |
| 画布多导演台节点  | **已修**:stores 每实例一套(`createDirectorDeskStores`),禁全局单例                                             |

### 预埋清单(阶段一已落地)

1. `TimeTransport` 统一时钟 —— 阶段二时间轴的地基;
2. store 实例化 + `DirectorDeskContext` —— 画布多节点的前提;
3. `PROTOCOL_VERSION` + ready 握手带版本 —— 主仓与本包独立发版的兼容判定;
4. 可序列化纪律(AGENTS.md 红线 #6)—— 阶段四导出/协作的地基。

> 范围对齐调研文档第七章「阶段一」:3D 场景画布 / 对象放置(游戏模型)/ 摆位操作 / 游戏动作挂载 / 基础虚拟摄像机 / 预演画面输出 / 无限画布接入。
> 不做:运镜轨迹、时间轴、多机位一致性、姿态精修、灯光(均为阶段二+)。
> 参考实现:`xiaozangao/3d-director-desk`(MIT,仅参考思路,不搬代码)。

## 领域模型

```mermaid
classDiagram
    class SceneManager {
        -entities: Map~string, SceneObject~
        -runtimes: Map~string, Object3D~
        +register(entity)
        +bindRuntime(id, object3d)
        +unregister(id)
        +dispose()
    }
    class SceneObject {
        +id: string
        +kind: SceneObjectKind
        +sourceUrl: string | null
        +transform: Transform
        +applyTransform(next)
    }
    class DisposeBag {
        +register(dispose)
        +dispose()
    }
    class CameraDirector {
        +addShot(id, shot)
        +activate(id)
        +deactivate()
    }
    class CameraShot {
        +position: Vec3
        +target: Vec3
        +fov: number
    }
    class AnimationBinder {
        +mount(objectId, root, clip)
        +unmount(objectId)
        +update(delta)
    }
    class CaptureService {
        +captureFrame(canvas): Promise~Blob~
    }
    class HostBridge {
        +on(type, handler)
        +post(message)
    }
    class CameraStore { +activeShotId: string | null }
    class SelectionStore { +selectedId: string | null }

    SceneManager "1" o-- "*" SceneObject
    SceneManager --> DisposeBag
    CameraDirector "1" o-- "*" CameraShot
    SceneStore --> SceneManager
    CameraStore --> CameraDirector
```

## 模块 × 任务拆分(阶段一)

> **执行入口**:每个任务的分步骤实现与验收清单见 [`docs/exec/`](./exec/README.md)(独立可执行,含验收人签字位)。

| #   | 任务               | 承载类/模块                                          | 验收                                                                    |
| --- | ------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | 工程基建           | eslint/ts/prettier/vite/storybook                    | ✅ 已完成(typecheck/lint/build/storybook 全绿)                          |
| 2   | 3D 场景画布        | `ui/DirectorDesk` + `SceneManager`                   | 网格/灯光/轨道相机;frameloop=demand;卸载零泄漏                          |
| 3   | 对象放置(游戏模型) | `loaders/ModelImporter`(新)+ `SceneObject`           | FBX/GLB/OBJ 导入入库;blob URL,禁 base64;大模型走 @dm/3d-viewer 快照缓存 |
| 4   | 摆位操作           | `transform/TransformGizmoController`(新)             | 移动/旋转/缩放 gizmo;拖拽结束才写实体;多选站位                          |
| 5   | 游戏动作挂载       | `AnimationBinder` + `animation/AnimationLibrary`(新) | GLB 动作 clip 挂到同构骨骼模型;播放/停止;Mixer 走渲染循环               |
| 6   | 基础虚拟摄像机     | `CameraDirector` + `CameraShot`                      | 机位增删、角度/景别参数、导演/机位双视角切换                            |
| 7   | 预演画面输出       | `CaptureService`                                     | 截图导出 PNG(帧内取样);录屏属增强,可后置                                |
| 8   | 无限画布接入       | `bridge/HostBridge` + Monet 插件壳节点               | 协议握手 ready/import-model/capture-produced;Monet 侧建薄壳节点         |

## 依赖规则

- 2 → 3/4/5/6/7 的前置(场景容器先立)
- 3 是 5 的前置(动作挂在模型上)
- 8 最后做,依赖 2+3+7 的对外协议稳定

## 性能验收基线(每任务完成时核对)

- 静态场景静置 0 渲染帧(React DevTools + rAF 计数)
- 加载/卸载 50 次模型,内存回落(dispose 纪律)
- 动画播放期 `AnimationBinder.update` 零分配(模块级临时变量复用)
