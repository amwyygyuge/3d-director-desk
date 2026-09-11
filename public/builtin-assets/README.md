# 内置资源(public/builtin-assets)

导演台内置资源缓存:**入库而不走线上**——可复现、headless/内网零外部依赖。目录清单位于 `catalog.json`,由 `AssetCatalog` 经 `BuiltinAssetProvider` 装载。

| 文件/目录                                                              | 来源                                                                               | 许可                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| humanoid-generic.glb                                                   | TapNow 线上通用人形(Mixamo 骨骼,14 段姿势与动作；8,221 triangles / 614KB 预演预算) | TapNow 内部资产                                     |
| actions.glb                                                            | 由 `assets-src/actions/*.fbx` 预烘(21 段动作,骨骼树无网格；1.3MB)                  | 随源资产:MIT(自制 2 段)+ CC0(FreeMotionPack1 19 段) |
| scenery/cube.gltf、platform.gltf、wall.gltf、column.gltf、pyramid.gltf | 项目自制、以 Three.js 基础几何导出；单模型至多 7KB                                 | 项目自制基础几何体                                  |

动作资产**不入库源 FBX**:源文件在 `assets-src/actions/`(不随包发布),由 `bun scripts/bake-action-clips.ts` 烘成 `actions.glb`。
FBX 每条骨骼曲线独立存关键帧且带完整骨架元数据,21 段共 9.7MB;预烘后 1.3MB(13.6%),且重定向与裁剪都在构建期完成,运行时只做 glTF 解析。
改动作清单要同时改 `scripts/bake-action-clips.ts` 的 `BAKE_SPECS` 与本目录 `catalog.json` 的 `clipName`——两者是唯一的对接契约。

设计取向:人物只保留**一个通用人形模型**；布景提供方块、平台、墙、立柱和四棱锥等低面数基础件；动作只保留旋转向量(源资产根位移单位不进入场景 transform)。模型面数是交互预算的一部分：人形资源不得以视觉细节换取缩放、旋转和拖拽帧率回退。
