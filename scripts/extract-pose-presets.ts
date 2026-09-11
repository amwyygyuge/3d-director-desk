import { BODY_PART, SKELETON_PART_BONES, SKELETON_FAMILY_UE } from "../src/actor/actorSkeleton";
import type { BodyPart } from "../src/actor/actorSkeleton";
import type { PosePresetJSON } from "../src/pose/PosePreset";
import type { QuaternionTuple } from "../src/pose/PoseSnapshot";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FLOAT_COMPONENT_TYPE = 5126;
const QUATERNION_TYPE = "VEC4";
const ROTATION_PATH = "rotation";
const QUATERNION_COMPONENTS = 4;
const FLOAT_BYTES = 4;
const QUATERNION_BYTES = QUATERNION_COMPONENTS * FLOAT_BYTES;
const ROUNDING_SCALE = 100000;
const IDENTITY_QUATERNION: QuaternionTuple = [0, 0, 0, 1];
const SOURCE_PATH = "public/builtin-assets/actions.glb";
const OUTPUT_PATH = "src/pose/posePresets.data.ts";

interface GltfAccessor {
    readonly bufferView: number;
    readonly byteOffset?: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
}

interface GltfBufferView {
    readonly byteOffset?: number;
    readonly byteLength: number;
    readonly byteStride?: number;
}

interface GltfNode {
    readonly name?: string;
    readonly rotation?: readonly number[];
}

interface GltfSampler {
    readonly output: number;
}

interface GltfChannel {
    readonly sampler: number;
    readonly target: {
        readonly node: number;
        readonly path: string;
    };
}

interface GltfAnimation {
    readonly name: string;
    readonly samplers: readonly GltfSampler[];
    readonly channels: readonly GltfChannel[];
}

interface GltfDocument {
    readonly accessors: readonly GltfAccessor[];
    readonly bufferViews: readonly GltfBufferView[];
    readonly nodes: readonly GltfNode[];
    readonly animations: readonly GltfAnimation[];
}

interface GlbPayload {
    readonly document: GltfDocument;
    readonly binary: Uint8Array;
}

interface PresetDefinition {
    readonly clipName: string;
    readonly id: string;
    readonly labelZh: string;
    readonly part: BodyPart;
    /**
     * 取样位置(0=首帧,1=末帧)。动作是连续的,姿势要的是其中一个静止瞬间:
     * 循环动作取 0 即代表姿态本身,带进出的转换动作要取末帧才是「到位」的姿势。
     */
    readonly frameRatio: number;
}

/**
 * 姿势预设清单:从动作 clip 里取静止瞬间。
 *
 * 循环动作(`*_Loop`)取 frameRatio 0——循环的任一帧都代表该姿态,首帧最稳定。
 * 带进出的转换动作取末帧(1.0):`Sitting_Enter` 的末帧才是「已坐下」,首帧还站着。
 *
 * 下半身决定支撑方式(站/坐/蹲/跪/游),上半身决定手臂姿态,两者可自由组合;
 * 因此同一 clip 常同时供两个部位,取名分别体现各自语义。
 */
const PRESET_DEFINITIONS: readonly PresetDefinition[] = [
    { clipName: "Idle_Loop", id: "lower-stand", labelZh: "站立", part: BODY_PART.LOWER, frameRatio: 0 },
    { clipName: "Sitting_Enter", id: "lower-sit-chair", labelZh: "椅上坐", part: BODY_PART.LOWER, frameRatio: 1 },
    { clipName: "Crouch_Idle_Loop", id: "lower-crouch", labelZh: "蹲伏", part: BODY_PART.LOWER, frameRatio: 0 },
    { clipName: "Fixing_Kneeling", id: "lower-kneel", labelZh: "单膝跪", part: BODY_PART.LOWER, frameRatio: 0.5 },
    { clipName: "Swim_Idle_Loop", id: "lower-swim", labelZh: "浮游", part: BODY_PART.LOWER, frameRatio: 0 },
    { clipName: "Death01", id: "lower-lying", labelZh: "倒地", part: BODY_PART.LOWER, frameRatio: 1 },
    { clipName: "Jump_Loop", id: "lower-airborne", labelZh: "腾空", part: BODY_PART.LOWER, frameRatio: 0.5 },
    { clipName: "Idle_Loop", id: "upper-stand-natural", labelZh: "站姿·自然", part: BODY_PART.UPPER, frameRatio: 0 },
    { clipName: "Idle_Talking_Loop", id: "upper-talking", labelZh: "交谈", part: BODY_PART.UPPER, frameRatio: 0.5 },
    { clipName: "Sitting_Idle_Loop", id: "upper-sit-rest", labelZh: "坐姿·垂手", part: BODY_PART.UPPER, frameRatio: 0 },
    {
        clipName: "Sitting_Talking_Loop",
        id: "upper-sit-talking",
        labelZh: "坐姿·交谈",
        part: BODY_PART.UPPER,
        frameRatio: 0.5,
    },
    {
        clipName: "Crouch_Idle_Loop",
        id: "upper-crouch-balance",
        labelZh: "蹲姿·收臂",
        part: BODY_PART.UPPER,
        frameRatio: 0,
    },
    {
        clipName: "Fixing_Kneeling",
        id: "upper-kneel-work",
        labelZh: "跪姿·作业",
        part: BODY_PART.UPPER,
        frameRatio: 0.5,
    },
    { clipName: "Walk_Loop", id: "upper-walk-swing", labelZh: "行走摆臂", part: BODY_PART.UPPER, frameRatio: 0.25 },
    { clipName: "Sprint_Loop", id: "upper-run-swing", labelZh: "奔跑摆臂", part: BODY_PART.UPPER, frameRatio: 0.25 },
    { clipName: "Jump_Start", id: "upper-jump-spread", labelZh: "跳跃展臂", part: BODY_PART.UPPER, frameRatio: 1 },
    { clipName: "PickUp_Table", id: "upper-reach", labelZh: "伸手取物", part: BODY_PART.UPPER, frameRatio: 0.5 },
    { clipName: "Push_Loop", id: "upper-push", labelZh: "推举", part: BODY_PART.UPPER, frameRatio: 0 },
    { clipName: "Hit_Chest", id: "upper-hit", labelZh: "受击·护胸", part: BODY_PART.UPPER, frameRatio: 1 },
    { clipName: "Dance_Loop", id: "upper-dance", labelZh: "舞动", part: BODY_PART.UPPER, frameRatio: 0.5 },
    { clipName: "Swim_Idle_Loop", id: "upper-swim", labelZh: "浮游·划水", part: BODY_PART.UPPER, frameRatio: 0 },
];

function readGlb(bytes: Uint8Array): GlbPayload {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("不是有效的 GLB 文件");
    const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
    const jsonType = view.getUint32(GLB_HEADER_BYTES + FLOAT_BYTES, true);
    if (jsonType !== GLB_JSON_CHUNK) throw new Error("GLB 缺少 JSON chunk");
    const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
    const jsonEnd = jsonStart + jsonLength;
    const binaryLength = view.getUint32(jsonEnd, true);
    const binaryType = view.getUint32(jsonEnd + FLOAT_BYTES, true);
    if (binaryType !== GLB_BINARY_CHUNK) throw new Error("GLB 缺少 BIN chunk");
    const binaryStart = jsonEnd + CHUNK_HEADER_BYTES;
    return {
        document: JSON.parse(new TextDecoder().decode(bytes.slice(jsonStart, jsonEnd))) as GltfDocument,
        binary: bytes.slice(binaryStart, binaryStart + binaryLength),
    };
}

function rounded(value: number): number {
    const result = Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE;
    return Object.is(result, -0) ? 0 : result;
}

function nodeQuaternion(node: GltfNode | undefined): QuaternionTuple {
    const rotation = node?.rotation;
    if (!rotation) return IDENTITY_QUATERNION;
    if (rotation.length !== QUATERNION_COMPONENTS || !rotation.every(Number.isFinite)) {
        throw new Error(`节点 ${node?.name ?? ""} 的 rest rotation 非法`);
    }
    return [rounded(rotation[0]!), rounded(rotation[1]!), rounded(rotation[2]!), rounded(rotation[3]!)];
}

function sampleQuaternion(
    document: GltfDocument,
    binary: Uint8Array,
    accessorIndex: number,
    sourceFrameRatio: number,
): QuaternionTuple {
    const accessor = document.accessors[accessorIndex];
    if (!accessor || accessor.componentType !== FLOAT_COMPONENT_TYPE || accessor.type !== QUATERNION_TYPE) {
        throw new Error(`动画 accessor 无法读取 quaternion: ${accessorIndex}`);
    }
    const bufferView = document.bufferViews[accessor.bufferView];
    if (!bufferView) throw new Error(`动画 bufferView 不存在: ${accessor.bufferView}`);
    const sampleIndex = Math.round(Math.max(0, Math.min(1, sourceFrameRatio)) * (accessor.count - 1));
    const byteStride = bufferView.byteStride ?? QUATERNION_BYTES;
    const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + sampleIndex * byteStride;
    const view = new DataView(binary.buffer, binary.byteOffset + byteOffset, QUATERNION_BYTES);
    return [
        rounded(view.getFloat32(0, true)),
        rounded(view.getFloat32(FLOAT_BYTES, true)),
        rounded(view.getFloat32(FLOAT_BYTES * 2, true)),
        rounded(view.getFloat32(FLOAT_BYTES * 3, true)),
    ];
}

function createPreset(definition: PresetDefinition, document: GltfDocument, binary: Uint8Array): PosePresetJSON {
    const animation = document.animations.find((candidate) => candidate.name === definition.clipName);
    if (!animation) throw new Error(`未找到动画 clip: ${definition.clipName}`);
    const sourceFrameRatio = definition.frameRatio;
    const rotations = new Map<string, QuaternionTuple>();
    for (const channel of animation.channels) {
        if (channel.target.path !== ROTATION_PATH) continue;
        const nodeName = document.nodes[channel.target.node]?.name;
        const sampler = animation.samplers[channel.sampler];
        if (!nodeName || !sampler) continue;
        rotations.set(nodeName, sampleQuaternion(document, binary, sampler.output, sourceFrameRatio));
    }
    const nodesByName = new Map(document.nodes.flatMap((node) => (node.name ? [[node.name, node] as const] : [])));
    // Materializing inherited rest rotations keeps every half-mask independently composable.
    const bones = SKELETON_PART_BONES[definition.part].reduce<Record<string, QuaternionTuple>>((result, boneName) => {
        const quaternion = rotations.get(boneName) ?? nodeQuaternion(nodesByName.get(boneName));
        result[boneName] = quaternion;
        return result;
    }, {});
    if (Object.keys(bones).length === 0)
        throw new Error(`clip ${definition.clipName} 未提供 ${definition.part} 骨骼旋转`);
    return {
        id: definition.id,
        labelZh: definition.labelZh,
        part: definition.part,
        skeletonFamily: SKELETON_FAMILY_UE,
        bones,
        custom: false,
    };
}

/**
 * 产出直接符合 prettier 风格,避免 `bun run format` 把生成物改脏
 * (生成物被改写后 md5 与重跑脚本的结果不一致,可复现性就无从校验)。
 *
 * 关键差异:标识符键不加引号、四元数四个分量压在一行——`JSON.stringify` 两者都不满足。
 */
function formatData(presets: readonly PosePresetJSON[]): string {
    const body = presets
        .map((preset) => {
            const bones = Object.entries(preset.bones)
                .map(([boneName, quaternion]) => `            ${boneName}: [${quaternion.join(", ")}],`)
                .join("\n");
            return [
                "    {",
                `        id: ${JSON.stringify(preset.id)},`,
                `        labelZh: ${JSON.stringify(preset.labelZh)},`,
                `        part: ${JSON.stringify(preset.part)},`,
                `        skeletonFamily: ${JSON.stringify(preset.skeletonFamily)},`,
                "        bones: {",
                bones,
                "        },",
                `        custom: ${String(preset.custom)},`,
                "    },",
            ].join("\n");
        })
        .join("\n");
    return [
        "/* 由 scripts/extract-pose-presets.ts 从 actions.glb 生成，勿手改。 */",
        'import type { PosePresetJSON } from "@/pose/PosePreset";',
        "",
        "export const BUILTIN_POSE_PRESETS: readonly PosePresetJSON[] = [",
        body,
        "];",
        "",
    ].join("\n");
}

const payload = readGlb(new Uint8Array(await Bun.file(SOURCE_PATH).arrayBuffer()));
const presets = PRESET_DEFINITIONS.map((definition) => createPreset(definition, payload.document, payload.binary));
await Bun.write(OUTPUT_PATH, formatData(presets));
