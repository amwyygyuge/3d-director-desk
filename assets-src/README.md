# 资产源文件(assets-src)

预烘产物的**源**,不随 npm 包发布(不在 `public/`,故不进 `dist/`)。产物入库在 `public/builtin-assets/`。

| 目录    | 内容                                                         | 烘制命令             | 产物                                                         |
| ------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------ |
| `actor` | Quaternius Universal Animation Library [Standard] 的非 RM 版 | `bun run bake:actor` | `public/builtin-assets/humanoid-generic.glb` + `actions.glb` |

源文件仍要入库而不是丢弃:烘制要可复现。产物是二进制且经过通道过滤与关键帧去冗,
没有源文件就无法在调整收录范围、改动作清单或重新生成姿势预设时重跑。

## 来源与许可

`UAL1_Standard.glb` 出自 [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html),
**CC0 1.0 Universal**(公共领域贡献),原始 `License.txt` 一并入库。

包内另有 `UAL1_Standard_RM.fbx`/`.glb` 等文件未入库:`_RM` 把 root motion 烘进了动作,
与本仓「实体 transform 是位置与朝向的唯一权威」冲突;Unity 版 FBX 则是同内容的另一种封装(单文件 23MB)。

## 收录范围

源含 43 段动作,烘制时剔除 15 段:手枪 6、近身 4、施法 4、`A_TPose` 1——
叙事分镜用不到,且每段都摊 65 骨轨道的体积。剩下 28 段见 `public/builtin-assets/catalog.json`。
