# 内置资源(public/builtin-assets)

导演台内置资源缓存:**入库而不走线上**——可复现、headless/内网零外部依赖。目录清单位于 `catalog.json`,由 `AssetCatalog` 经 `BuiltinAssetProvider` 装载。

| 文件/目录                                                                                                                                                                                                                  | 来源                                                                               | 许可            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| humanoid-generic.glb                                                                                                                                                                                                       | TapNow 线上通用人形(Mixamo 骨骼,14 段姿势与动作；8,221 triangles / 614KB 预演预算) | TapNow 内部资产 |
| actions/wave.fbx、actions/side-step-left.fbx                                                                                                                                                                               | xiaozangao/3d-director-desk                                                        | MIT             |
| actions/Celebrate1–3.fbx、ComeHere1–3.fbx、GoAwayAngry.fbx、GoAwayAnnoyed.fbx、GoAwayQuickly.fbx、HandsOnHead.fbx、NodYes1.fbx、ShakeHeadNo1.fbx、StopOneHand1–2.fbx、StopTwoHand1–2.fbx、ThumbsUp1.fbx、ThumbsDown1–2.fbx | J-Beardmore/FreeMotionPack1                                                        | CC0             |

设计取向:人物只保留**一个通用人形模型**；动作是独立的 Mixamo 兼容 FBX 资产,挂载前以目标骨架做世界空间重定向,并只保留旋转向量(源资产根位移单位不进入场景 transform)。模型面数是交互预算的一部分：人形资源不得以视觉细节换取缩放、旋转和拖拽帧率回退。
