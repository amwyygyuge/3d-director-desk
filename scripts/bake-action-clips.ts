/**
 * 动作资产预烘:把 assets-src/actions/*.fbx 重定向后烘成单个 GLB。
 *
 * 为什么要预烘(而不是运行时加载 FBX):
 * - 体积:FBX 每条骨骼曲线独立存 KeyTime/KeyValueFloat 且带完整骨架元数据,
 *   21 段动作共 9.7MB;同样内容的 glTF sampler 约 200KB(实测 ~2%)。
 * - 运行时:`MixamoActionRetargeter` 的世界空间重定向要逐帧算骨骼矩阵,
 *   放在用户点动作的那一刻就是可感知的卡顿。重定向结果与目标壳层缩放无关
 *   (实测最大差 7e-15),因此可以在构建期一次算完。
 * - 裁剪:`trimStartSeconds/trimEndSeconds` 只为剥掉源 FBX 的 T-Pose 参考帧,
 *   属于源资产瑕疵而非领域语义,烘制时消化掉,catalog 不再需要这两个字段。
 *
 * 目标骨架取 humanoid-generic.glb 的 bind 姿态(与运行时 attach 前的标定时机一致)。
 * 产物只含骨骼树 + clip,不含网格:人偶网格由模型资产提供,重复一份纯属浪费。
 *
 * 副作用 import 必须排在 GLTFExporter 之前——见 installFileReaderPolyfill 的说明。
 */
import "./installFileReaderPolyfill";

import { AnimationClip, Group } from "three";
import type { Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { ACTION_CHANNEL_POLICY, MixamoActionRetargeter } from "../src/animation/MixamoActionRetargeter";

const SOURCE_DIR = "assets-src/actions";
const TARGET_RIG_PATH = "public/builtin-assets/humanoid-generic.glb";
const OUTPUT_PATH = "public/builtin-assets/actions.glb";

/**
 * 关键帧等值判据。四元数分量在 [-1,1],1e-6 对应约 1e-4 弧度(0.006°)——
 * 远低于 Float32 存储精度下的可见差异,故删除等值帧不改变观感。
 */
const KEYFRAME_EPSILON = 1e-6;

/** FreeMotionPack1 每个 FBX 首帧是 T-Pose 参考帧(见其 README),按 30fps 剥掉首 2 帧与末 1 帧。 */
const SOURCE_FRAME_SECONDS = 1 / 30;
const FREE_MOTION_PACK_TRIM = {
    trimStartSeconds: SOURCE_FRAME_SECONDS * 2,
    trimEndSeconds: SOURCE_FRAME_SECONDS,
} as const;
/** 本仓自制资产无参考帧,不裁剪。 */
const NO_TRIM = { trimStartSeconds: 0, trimEndSeconds: 0 } as const;

interface BakeSpec {
    /** 源文件名(assets-src/actions 下) */
    readonly file: string;
    /** 产物 clip 名:与 catalog.json 的 clipName 同词表,是两侧唯一的对接契约 */
    readonly clipName: string;
    readonly trimStartSeconds: number;
    readonly trimEndSeconds: number;
}

function freeMotion(file: string, clipName: string): BakeSpec {
    return { file, clipName, ...FREE_MOTION_PACK_TRIM };
}

function inHouse(file: string, clipName: string): BakeSpec {
    return { file, clipName, ...NO_TRIM };
}

/** 烘制清单:与 catalog.json 的动作条目一一对应,增删动作只改这两处。 */
const BAKE_SPECS: readonly BakeSpec[] = [
    inHouse("wave.fbx", "wave"),
    inHouse("side-step-left.fbx", "side-step-left"),
    freeMotion("NodYes1.fbx", "nod-yes"),
    freeMotion("ShakeHeadNo1.fbx", "shake-head-no"),
    freeMotion("ComeHere1.fbx", "come-here"),
    freeMotion("ComeHere2.fbx", "come-here-alt"),
    freeMotion("ComeHere3.fbx", "come-here-emphatic"),
    freeMotion("GoAwayQuickly.fbx", "go-away-quickly"),
    freeMotion("GoAwayAngry.fbx", "go-away-angry"),
    freeMotion("GoAwayAnnoyed.fbx", "go-away-annoyed"),
    freeMotion("HandsOnHead.fbx", "hands-on-head"),
    freeMotion("StopOneHand1.fbx", "stop-one-hand"),
    freeMotion("StopOneHand2.fbx", "stop-one-hand-alt"),
    freeMotion("StopTwoHand1.fbx", "stop-two-hand"),
    freeMotion("StopTwoHand2.fbx", "stop-two-hand-alt"),
    freeMotion("ThumbsUp1.fbx", "thumbs-up"),
    freeMotion("ThumbsDown1.fbx", "thumbs-down"),
    freeMotion("ThumbsDown2.fbx", "thumbs-down-alt"),
    freeMotion("Celebrate1.fbx", "celebrate"),
    freeMotion("Celebrate2.fbx", "celebrate-alt"),
    freeMotion("Celebrate3.fbx", "celebrate-jump"),
];

async function loadGltfScene(path: string): Promise<Object3D> {
    const bytes = await Bun.file(path).arrayBuffer();
    const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
        new GLTFLoader().parse(bytes, "", resolve, reject);
    });
    return gltf.scene;
}

function firstBoneOf(root: Object3D): Object3D {
    let found: Object3D | null = null;
    root.traverse((node) => {
        if (!found && "isBone" in node && node.isBone) found = node;
    });
    if (!found) throw new Error(`目标资产内找不到骨骼: ${TARGET_RIG_PATH}`);
    return found;
}

/**
 * 关键帧去冗:实测 17% 轨道整条恒定、18% 关键帧与前后邻居等值。
 *
 * 恒定轨道整条删掉——骨骼停在 rest 姿态,不写轨道与写一条恒定轨道等价;
 * 中间的等值帧删掉——线性/球面插值在等值端点之间取任何 t 都得同一个值。
 * 两者都在容差内无损,只减字节与运行时插值工作量。
 */
function prunedClip(clip: AnimationClip): AnimationClip {
    const tracks = clip.tracks.flatMap((track) => {
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

async function bake(): Promise<void> {
    const retargeter = new MixamoActionRetargeter();
    const targetRig = await loadGltfScene(TARGET_RIG_PATH);

    const clips: AnimationClip[] = [];
    for (const spec of BAKE_SPECS) {
        const sourceRoot = new FBXLoader().parse(await Bun.file(`${SOURCE_DIR}/${spec.file}`).arrayBuffer(), "");
        const sourceClip = sourceRoot.animations[0];
        if (!sourceClip) throw new Error(`源动作无 clip: ${spec.file}`);
        const clip = retargeter.normalize(sourceClip, {
            channels: ACTION_CHANNEL_POLICY.ROTATION_ONLY,
            trimStartSeconds: spec.trimStartSeconds,
            trimEndSeconds: spec.trimEndSeconds,
            sourceRoot,
            targetRoot: targetRig,
        });
        const pruned = prunedClip(clip);
        pruned.name = spec.clipName;
        clips.push(pruned);
        console.log(
            `  ${spec.clipName.padEnd(22)} ${String(pruned.tracks.length).padStart(2)}/${clip.tracks.length} tracks  ` +
                `${pruned.duration.toFixed(3)}s  ← ${spec.file}`,
        );
    }

    // 只导骨骼树:把 Hips 挂到一个干净的 Group 下,网格与材质都不带。
    const rigHolder = new Group();
    rigHolder.name = "ActionRig";
    rigHolder.add(firstBoneOf(targetRig));

    const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
        new GLTFExporter().parse(
            rigHolder,
            (result) => {
                // exporter 的类型签名是 glTF JSON 与 GLB 的并集;binary 模式的成功路径一定是 ArrayBuffer。
                if (!(result instanceof ArrayBuffer)) reject(new Error("GLTFExporter 未按 binary 模式产出 GLB"));
                else resolve(result);
            },
            reject,
            { binary: true, animations: clips },
        );
    });
    await Bun.write(OUTPUT_PATH, glb);

    const sourceBytes = BAKE_SPECS.reduce((sum, spec) => sum + Bun.file(`${SOURCE_DIR}/${spec.file}`).size, 0);
    const ratio = ((glb.byteLength / sourceBytes) * 100).toFixed(1);
    console.log(
        `\n${clips.length} 段动作 → ${OUTPUT_PATH}` +
            `\n  源 FBX ${(sourceBytes / 1024 / 1024).toFixed(2)}MB → 产物 ${(glb.byteLength / 1024).toFixed(0)}KB (${ratio}%)`,
    );
}

await bake();
