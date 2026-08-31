# 内置资源(public/builtin-assets)

导演台内置资源缓存:**入库而不走线上**——可复现、headless/内网零外部依赖、许可静态可审计(AGENTS.md 红线 #10)。
目录清单位于 `catalog.json`,由 `AssetCatalog` 经 `BuiltinAssetProvider` 装载。

| 文件/目录              | 来源                                                                               | 许可            |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------- |
| humanoid-generic.glb   | TapNow 线上通用人形(Mixamo 骨骼,14 段姿势与动作；8,221 triangles / 614KB 预演预算) | TapNow 内部资产 |
| furniture-armchair-01/ | Poly Haven `ArmChair_01`(1k gltf 多文件)                                           | CC0             |
| plant-calathea/        | Poly Haven `calathea_orbifolia_01`(1k gltf 多文件)                                 | CC0             |

设计取向:人物只保留**一个通用人形模型**,姿势与动作均来自模型内嵌 clip；资源库不提供独立动作条目。语义滑杆层阶段一不做，模型面数是交互预算的一部分：人形资源不得以视觉细节换取缩放、旋转和拖拽帧率回退。
