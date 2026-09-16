# 内置资源(public/builtin-assets)

导演台内置资源缓存:**入库而不走线上**——可复现、headless/内网零外部依赖。目录清单位于 `catalog.json`,由 `AssetCatalog` 经 `BuiltinAssetProvider` 装载。

| 文件/目录                                                              | 来源                                                                                      | 许可               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| humanoid-generic.glb                                                   | Quaternius Universal Animation Library 的 Mannequin(65 骨含五指,13,744 triangles / 615KB) | CC0                |
| actions.glb                                                            | 同源的 28 段动作(骨骼树无网格;1.4MB)                                                      | CC0                |
| scenery/cube.gltf、wall.gltf、column.gltf、pyramid.gltf | 项目自制、以 Three.js 基础几何导出；单模型至多 7KB                                        | 项目自制基础几何体 |

两份产物都由 `bun run bake:actor` 从 `assets-src/actor/UAL1_Standard.glb` 拆出,源文件不随包发布。

## 为什么动作与人偶分成两个文件

人偶每个演员都要加载,动作按需取用。合成一个文件会让「放一个人」被迫下载全部动作;
拆开后 `actions.glb` 只含骨骼树与 clip,不重复网格。

**动作与人偶同骨架同源,故运行时不做重定向**——轨道名直接命中目标节点。这是选用本资产的主要收益:
`provisionAction` 只需取 clip,不再逐帧算世界矩阵。

## 骨架约定

UE 标准人形词表(`root`/`pelvis`/`spine_01`/`clavicle_l`/`upperarm_l`/`thigh_l`…),
`skeletonFamily` 声明为 `"ue"`。拓扑的唯一来源是 `src/actor/actorSkeleton.ts`,与资产实测一致(65 骨)。

`root` 是承载 root motion 的容器骨,**不属于任何身体部位**:位置与朝向由实体 transform 独占,
故烘制时剔除根骨轨道,姿势预设也不含它。源包另有 `_RM` 版本(根位移已烘进动作),与该权威冲突,不使用。

## 改动作清单

改 `scripts/bake-actor-assets.ts` 的 `EXCLUDED_CLIP_PATTERN` 与本目录 `catalog.json` 的 `clipName`——两者是唯一的对接契约。
姿势预设另由 `scripts/extract-pose-presets.ts` 从 `actions.glb` 取静止帧生成。

设计取向:人物只保留**一个通用人形模型**；布景提供方块、墙、立柱和四棱锥等低面数基础件；动作只保留旋转向量。模型面数与骨骼数都是交互预算的一部分：人形资源不得以视觉细节换取缩放、旋转和拖拽帧率回退。
