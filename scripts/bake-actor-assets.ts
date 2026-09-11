/**
 * 人偶与动作资产烘制:从 Quaternius Universal Animation Library 拆出两份产物。
 *
 * 源文件一份(`assets-src/actor/UAL1_Standard.glb`,CC0)含网格、65 骨骼与 43 段动作,
 * 7.4MB 全量入库既浪费又混淆职责,故拆成:
 *
 * - `humanoid-generic.glb`:网格 + 骨架,无动画。人偶资产,场景里每个演员都加载它。
 * - `actions.glb`:骨骼树 + 动作 clip,无网格。动作资产,按 clipName 取用。
 *
 * 动作与人偶同源同骨架,故**不需要重定向**——这是换用本资产的主要收益。
 * clip 只保留旋转:实体 transform 是位置与朝向的唯一权威(根位移不进场景)。
 *
 * 用 `_RM` 版本会把根位移烘进动作,与上述权威冲突,故一律取非 RM 版本。
 *
 * 副作用 import 必须排在 GLTFExporter 之前——见 installFileReaderPolyfill 的说明。
 */
import "./installFileReaderPolyfill";

import { AnimationClip, Group } from "three";
import type { Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SOURCE_PATH = "assets-src/actor/UAL1_Standard.glb";
const ACTOR_OUTPUT_PATH = "public/builtin-assets/humanoid-generic.glb";
const ACTIONS_OUTPUT_PATH = "public/builtin-assets/actions.glb";

/**
 * 导演台不收录的动作:战斗(手枪/近身)、奇幻施法、T-Pose 参考姿态。
 * 叙事分镜用不到,且每段都摊 65 骨轨道的体积。
 */
const EXCLUDED_CLIP_PATTERN = /^(Pistol_|Punch_|Sword_|Spell_|A_TPose$)/;

/**
 * 关键帧等值判据。四元数分量在 [-1,1],1e-6 对应约 1e-4 弧度(0.006°),
 * 远低于 Float32 存储精度下的可见差异。
 */
const KEYFRAME_EPSILON = 1e-6;

/**
 * 位移轨道的等值判据(米)。0.1 毫米——远低于人体尺度的可辨差异,
 * 但比四元数判据宽,否则 Float32 噪声会让本该恒定的轨道全部留下。
 */
const POSITION_EPSILON = 1e-4;

/** 骨架根骨名:其轨道不进场景(位置与朝向由实体 transform 决定)。 */
const ROOT_BONE_NAME = "root";

/**
 * 不进场景的通道:
 *
 * - `scale`:实测源包 43 段里非恒定的 scale 通道数为 0,留着纯占字节。
 * - 根骨的任何通道:root motion 的容器,位置与朝向权威归实体 transform。
 *
 * **`pelvis.position` 必须保留**:那是身体相对脚底的起伏(跑步腾空、跳跃蹲起、
 * 倒地下沉),不是位移。实测 25/28 段带非恒定 pelvis 位移,Roll 达身高 60%、
 * Jog 12.6%、Sprint 7.2%;且逐段水平净漂移均为 0.000m——前进位移早已被抽到根骨,
 * 留下它不会让角色漂离原位。丢掉它会让所有动作失去重量感(曾误删,导致跑步发飘)。
 */
function isDroppedTrack(trackName: string): boolean {
    return trackName.endsWith(".scale") || trackName.startsWith(`${ROOT_BONE_NAME}.`);
}

async function loadSourceScene(): Promise<{ scene: Object3D; animations: readonly AnimationClip[] }> {
    const bytes = await Bun.file(SOURCE_PATH).arrayBuffer();
    const { promise, resolve, reject } = Promise.withResolvers<{
        scene: Object3D;
        animations: readonly AnimationClip[];
    }>();
    new GLTFLoader().parse(bytes, "", (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }), reject);
    return await promise;
}

/**
 * 关键帧去冗 + 通道过滤:剔除不进场景的通道,删「恒定且等于 rest」的轨道与等值中间帧。
 *
 * 中间的等值帧删掉——插值在等值端点之间取任何 t 都得同一个值,无损。
 *
 * 整条轨道只在**恒定值等于骨骼 rest 值**时才删:此时不写轨道与写一条恒定轨道等价。
 * 「恒定」本身不是充分条件——一条轨道可以全程恒定在**非 rest** 的值上(手指保持握持、
 * 大腿保持屈曲),删掉它骨骼就退回 rest,姿态错。曾据此误删 341 条轨道、涉 43 根骨,
 * 最严重的 Sitting_Idle_Loop/thigh_l 差 86.9°,坐姿腿型完全不对。
 */
function normalizedClip(clip: AnimationClip, restByBone: ReadonlyMap<string, readonly number[]>): AnimationClip {
    const tracks = clip.tracks.flatMap((track) => {
        if (isDroppedTrack(track.name)) return [];
        const stride = track.values.length / track.times.length;
        const epsilon = track.name.endsWith(".quaternion") ? KEYFRAME_EPSILON : POSITION_EPSILON;
        const sameAs = (left: number, right: number): boolean => {
            for (let component = 0; component < stride; component++) {
                const delta = track.values[left * stride + component]! - track.values[right * stride + component]!;
                if (Math.abs(delta) > epsilon) return false;
            }
            return true;
        };
        const kept = [...track.times.keys()].filter(
            (index) =>
                index === 0 ||
                index === track.times.length - 1 ||
                !(sameAs(index, index - 1) && sameAs(index, index + 1)),
        );
        const isConstant = kept.length === 2 && sameAs(0, track.times.length - 1);
        const rest = restByBone.get(track.name);
        const matchesRest =
            rest !== undefined &&
            rest.every((value, component) => Math.abs(value - track.values[component]!) <= epsilon);
        if (isConstant && matchesRest) return [];
        const pruned = track.clone();
        pruned.times = new Float32Array(kept.map((index) => track.times[index]!));
        pruned.values = new Float32Array(
            kept.flatMap((index) => [...track.values.slice(index * stride, (index + 1) * stride)]),
        );
        return [pruned];
    });
    return new AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * 骨骼 rest 位姿表,键与轨道名同形(`pelvis.quaternion`),供去冗判断「恒定值是否等于 rest」。
 *
 * 取自源场景的骨骼节点:产物人偶与源共享同一套骨骼节点(仅根节点被旋转),
 * 故这里的 rest 就是运行时未被轨道覆盖时骨骼实际停在的位姿。
 */
function restPoseByTrackName(scene: Object3D): ReadonlyMap<string, readonly number[]> {
    const rest = new Map<string, readonly number[]>();
    scene.traverse((node) => {
        if (!("isBone" in node && node.isBone)) return;
        rest.set(`${node.name}.quaternion`, node.quaternion.toArray());
        rest.set(`${node.name}.position`, node.position.toArray());
    });
    return rest;
}

function firstBoneOf(root: Object3D): Object3D {
    let found: Object3D | null = null;
    root.traverse((node) => {
        if (!found && "isBone" in node && node.isBone) found = node;
    });
    if (!found) throw new Error(`源资产内找不到骨骼: ${SOURCE_PATH}`);
    return found;
}

async function exportGlb(root: Object3D, animations: readonly AnimationClip[]): Promise<ArrayBuffer> {
    const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>();
    new GLTFExporter().parse(
        root,
        (result) => {
            // exporter 的类型签名是 glTF JSON 与 GLB 的并集;binary 模式的成功路径一定是 ArrayBuffer。
            if (!(result instanceof ArrayBuffer)) reject(new Error("GLTFExporter 未按 binary 模式产出 GLB"));
            else resolve(result);
        },
        reject,
        { binary: true, animations: [...animations] },
    );
    return await promise;
}

/**
 * 把资产转到「正面朝 −Z」——全仓的朝向约定。
 *
 * three 的 `lookAt` 让 −Z 指向目标,故本仓一律以 −Z 为主体正面:
 * `TimelineSampler` 的切线朝向 `atan2(-x,-z)`、`placementCommands` 的「面对面」、
 * `FramingService` 的正视机位、`CameraFollowTrack` 的跟拍方位角都建立在这条约定上。
 *
 * 而本资产的正面朝 +Z(实测:脚踝→脚掌指向 +Z,网格 bbox 亦偏向 +Z),
 * 直接入库会让「沿轨迹前进」变成倒着跑、「面对面」变成背对背。
 *
 * 修正放在烘制期而非运行时:朝向是**资产的坐标约定**,不是场景语义。
 * 若改运行时(例如给 yaw 加 π),四个模块都要各自记住这条补偿,
 * 且宿主注入的第三方资产会与内置资产行为不一致。
 *
 * 旋转落在**根节点**(Armature)上,而非烘进顶点:动作 clip 写的是骨骼局部绝对旋转,
 * 会覆盖被动画骨骼的节点旋转,但根节点在骨骼链之上、不被任何轨道触及,
 * 因此这一层旋转对 rest 与所有 clip 一致生效(已按 Walk_Loop 逐帧验证)。
 */
function faceNegativeZ(scene: Object3D): void {
    scene.rotation.y += Math.PI;
    scene.updateMatrixWorld(true);
}

async function bake(): Promise<void> {
    const source = await loadSourceScene();
    faceNegativeZ(source.scene);

    // 人偶:整棵场景树(网格 + 骨架),不带任何 clip。
    const actorGlb = await exportGlb(source.scene, []);
    await Bun.write(ACTOR_OUTPUT_PATH, actorGlb);

    // rest 表取自骨骼节点局部位姿;根节点的旋转不影响骨骼 local,故与 faceNegativeZ 无先后之分。
    const restByBone = restPoseByTrackName(source.scene);
    const clips = source.animations
        .filter((clip) => !EXCLUDED_CLIP_PATTERN.test(clip.name))
        .map((clip) => {
            const normalized = normalizedClip(clip, restByBone);
            console.log(
                `  ${clip.name.padEnd(24)} ${String(normalized.tracks.length).padStart(2)}/${clip.tracks.length} tracks  ` +
                    `${normalized.duration.toFixed(2)}s`,
            );
            return normalized;
        });

    // 动作:只导骨骼树,网格与材质都不带(人偶资产已经有一份)。
    const rigHolder = new Group();
    rigHolder.name = "ActionRig";
    rigHolder.add(firstBoneOf(source.scene));
    const actionsGlb = await exportGlb(rigHolder, clips);
    await Bun.write(ACTIONS_OUTPUT_PATH, actionsGlb);

    const excluded = source.animations.length - clips.length;
    console.log(
        `\n源 ${SOURCE_PATH} ${(Bun.file(SOURCE_PATH).size / 1024 / 1024).toFixed(2)}MB` +
            `\n  → ${ACTOR_OUTPUT_PATH}   ${(actorGlb.byteLength / 1024).toFixed(0)}KB(网格 + 骨架)` +
            `\n  → ${ACTIONS_OUTPUT_PATH} ${(actionsGlb.byteLength / 1024).toFixed(0)}KB(${clips.length} 段动作,剔除 ${excluded} 段战斗/奇幻/参考姿态)`,
    );
}

await bake();
