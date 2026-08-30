# Demo:环太平洋式机甲对战怪兽 — 5 秒运镜参考(2026-08-30)

> 目的:验证「LLM 经控制台句柄低成本产出运镜参考」全链路。全部操作经 `window.__directorDesk` 命令层完成,零 UI 点击。
> 驱动方式见 `skills/director-desk/SKILL.md`(断言驱动验收协议)。

## 剧本与分镜

50 米机甲右拳打向怪兽头部,镜头跟随推进、由快到慢、打击帧急停。

| 时刻  | 节拍       | 运镜关键帧                         | easing                  |
| ----- | ---------- | ---------------------------------- | ----------------------- |
| 0.0s  | 全景交代   | mk-wide `[-6.5, 1.0, 7.5]` fov 50  | smooth                  |
| 2.5s  | 推进中景   | mk-mid `[-2.8, 1.1, 4.6]` fov 40   | smooth                  |
| 4.2s  | 打击帧特写 | mk-impact `[0.9, 1.4, 2.6]` fov 34 | smooth                  |
| 4.35s | 急停保持   | mk-hold 近同机位                   | linear(速度阶梯=打击感) |

## 资产(全部开源,许可干净)

| 角色                                   | 文件                               | 来源                       | 许可            |
| -------------------------------------- | ---------------------------------- | -------------------------- | --------------- |
| 机甲·桑巴武者(攻击动作=Samba 挥臂段落) | `public/test-assets/desk-test.fbx` | three.js examples(Mixamo)  | MIT             |
| 怪兽·狐狸替身                          | `public/test-assets/fox.glb`       | Khronos glTF-Sample-Assets | CC0 / CC-BY 4.0 |

50 米尺度以 scale 比例表达(机甲 1.4x vs 怪兽 1.7x + 低机位),归一化壳把模型统一收 2 单位基准。

## 断言证据(数据面,非目测)

- `scene.describe`:两实体 `loadState=loaded`;包围盒 mecha `[2.8, 2.6, 0.52]` / kaiju `[3.4, 1.74, 0.55]`(尺度比符合设计);
- `pose.bones.discover`:mecha ready 后挂载成功;
- `motion.get`:4 关键帧、时间递增、急停帧 linear;
- `camera.get-pose`:seek(4.2) 后 `live.position [0.6,1.2,2.0]` == `motionSampled`(运镜采样与真机位一致);
- `capture.frame` 元数据:三帧 `timeSeconds` 精确 0.5/2.5/4.25,相机位姿随帧推进;
- 幻觉围栏:`object.move` 含 NaN 坐标被拒(`validation-failed: transform 含非法数值`)。

## 成片参考帧(capture.frame 产物,辅助物已摘除)

- `frames/beat-0.png` — 全景开场
- `frames/beat-0.5.png` — 开场后挥臂起势
- `frames/beat-2.5.png` — 推进中段
- `frames/beat-4.25.png` — 打击帧(急停保持)

## 本次彩排暴露并已修的产品缺陷

1. `object.place` 的 execute 不落 `resolveModelFormat` → 模型 format=null 静默红框(命令层修复);
2. 蒙皮模型归一化用绑定几何测量 → armature 缩放型 rig 尺寸谬误(`core/measureModelBox.ts`,骨架更新+蒙皮感知,渲染层与 scene.describe 共用);
3. `capture.frame` 用异步 `toBlob` 读帧 → `preserveDrawingBuffer:false` 下必拿合成器残留帧(改同步 `toDataURL`);
4. `scene.describe` 的 loadState 曾把「runtime 外层组已绑」误判 loaded → 改为结局表唯一事实源。

## 登记在案的后续项(本次未修)

- RobotExpressive.glb(armature×100 rig):绑定姿态≈310 单位、动画姿态≈3.1 单位,姿态量纲分裂,挂载后塌陷不可见——已换 Samba 规避,rig 单位归一化属动作重定向专项;
- `transport.play` 越过 duration 不自动停(需播放区间概念);
- headless demand 模式下 page 截图抓不到已呈现帧(capture 通道不受影响;live 截图请在播放态或真实浏览器);
- agent 侧 harness:`tab.evaluate(fn, [args])` 的参数传递在本工具链不生效,多步操作用单 evaluate 内联参数。
