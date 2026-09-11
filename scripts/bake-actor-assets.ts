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

/** 骨架根骨名:其轨道不进场景(位置与朝向由实体 transform 决定)。 */
const ROOT_BONE_NAME = "root";

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
 * 关键帧去冗 + 通道过滤:只留旋转、剔根骨、删恒定轨道与等值中间帧。
 *
 * 恒定轨道整条删掉——骨骼停在 rest 姿态,不写轨道与写一条恒定轨道等价;
 * 中间的等值帧删掉——球面插值在等值端点之间取任何 t 都得同一个值。
 * 两者都在容差内无损,只减字节与运行时插值工作量。
 */
function normalizedClip(clip: AnimationClip): AnimationClip {
    const tracks = clip.tracks.flatMap((track) => {
        if (!track.name.endsWith(".quaternion")) return [];
        if (track.name.startsWith(`${ROOT_BONE_NAME}.`)) return [];
        const stride = track.values.length / track.times.length;
        const sameAs = (left: number, right: number): boolean => {
            for (let component = 0; component < stride; component++) {
                const delta = track.values[left * stride + component]! - track.values[right * stride + component]!;
                if (Math.abs(delta) > KEYFRAME_EPSILON) return false;
            }
            return true;
        };
        const kept = [...track.times.keys()].filter(
            (index) =>
                index === 0 ||
                index === track.times.length - 1 ||
                !(sameAs(index, index - 1) && sameAs(index, index + 1)),
        );
        // 首末等值 ⇒ 整条恒定(中间帧已被上一步判为可删):骨骼未参与该动作。
        if (kept.length === 2 && sameAs(0, track.times.length - 1)) return [];
        const pruned = track.clone();
        pruned.times = new Float32Array(kept.map((index) => track.times[index]!));
        pruned.values = new Float32Array(
            kept.flatMap((index) => [...track.values.slice(index * stride, (index + 1) * stride)]),
        );
        return [pruned];
    });
    return new AnimationClip(clip.name, clip.duration, tracks);
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

async function bake(): Promise<void> {
    const source = await loadSourceScene();

    // 人偶:整棵场景树(网格 + 骨架),不带任何 clip。
    const actorGlb = await exportGlb(source.scene, []);
    await Bun.write(ACTOR_OUTPUT_PATH, actorGlb);

    const clips = source.animations
        .filter((clip) => !EXCLUDED_CLIP_PATTERN.test(clip.name))
        .map((clip) => {
            const normalized = normalizedClip(clip);
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
