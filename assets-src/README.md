# 资产源文件(assets-src)

预烘产物的**源**,不随 npm 包发布(不在 `public/`,故不进 `dist/`)。产物入库在 `public/builtin-assets/`。

| 目录      | 内容                      | 烘制命令                           | 产物                                |
| --------- | ------------------------- | ---------------------------------- | ----------------------------------- |
| `actions` | 21 个 Mixamo 兼容动作 FBX | `bun scripts/bake-action-clips.ts` | `public/builtin-assets/actions.glb` |

为什么源文件仍要入库而不是丢弃:烘制要可复现。产物是二进制且经过重定向与裁剪,没有源文件就无法在换 rig、调裁剪窗口或加动作时重新生成。

## actions 许可

| 文件                                                                                                                                                               | 来源                        | 许可 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ---- |
| wave.fbx、side-step-left.fbx                                                                                                                                       | xiaozangao/3d-director-desk | MIT  |
| Celebrate1–3、ComeHere1–3、GoAwayAngry、GoAwayAnnoyed、GoAwayQuickly、HandsOnHead、NodYes1、ShakeHeadNo1、StopOneHand1–2、StopTwoHand1–2、ThumbsUp1、ThumbsDown1–2 | J-Beardmore/FreeMotionPack1 | CC0  |

FreeMotionPack1 的动作建在 Mixamo "Exo Gray" 骨架上,每个 FBX 首帧是 T-Pose 参考帧——烘制时按 30fps 剥掉首 2 帧与末 1 帧(见 `scripts/bake-action-clips.ts` 的 `FREE_MOTION_PACK_TRIM`)。
