# 内置资源(public/builtin-assets)

导演台内置资源缓存:**入库而不走线上**——可复现、headless/内网零外部依赖、许可静态可审计(AGENTS.md 红线 #10)。
目录清单位于 `catalog.json`,由 `AssetCatalog` 经 `BuiltinAssetProvider` 装载。

| 文件/目录              | 来源                                                                                                  | 许可                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | --------------------- |
| robot-expressive.glb   | Quaternius(Tomás Laulhé)RobotExpressive,经 three.js examples 分发(骨骼+Punch/Wave/Dance 等 14 段动作) | CC0                   |
| soldier.glb            | three.js examples `models/gltf/Soldier.glb`(Mixamo 骨骼,Idle/Walk/Run/TPose)                          | MIT(随 three.js 仓库) |
| furniture-armchair-01/ | Poly Haven `ArmChair_01`(1k gltf 多文件)                                                              | CC0                   |
| plant-calathea/        | Poly Haven `calathea_orbifolia_01`(1k gltf 多文件)                                                    | CC0                   |

已知边界:`robot-expressive.glb` 为 armature×100 rig,绑定姿态与动画姿态量纲分裂(310 vs 3.1 单位),挂载动作后归一化失效——仅作放置/骨骼发现演示;动作挂载演示用 mixamo 系(soldier/desk-test.fbx)。
