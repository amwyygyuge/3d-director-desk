import { BODY_PART, MIXAMO_PART_BONES, SKELETON_FAMILY_MIXAMO } from "../src/actor/mixamoSkeleton";
import type { BodyPart } from "../src/actor/mixamoSkeleton";
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
const SOURCE_PATH = "public/builtin-assets/humanoid-generic.glb";
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

interface GltfAnimationMetadata {
    readonly sourceFrameRatio?: number;
    readonly commentZh?: string;
}

interface GltfAnimation {
    readonly name: string;
    readonly samplers: readonly GltfSampler[];
    readonly channels: readonly GltfChannel[];
    readonly extras?: {
        readonly tapnowActorAnimation?: GltfAnimationMetadata;
    };
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
}

const PRESET_DEFINITIONS: readonly PresetDefinition[] = [
    { clipName: "Sitting", id: "lower-sit-chair", labelZh: "椅上坐", part: BODY_PART.LOWER },
    { clipName: "Sitting Floor", id: "lower-sit-floor", labelZh: "坐地", part: BODY_PART.LOWER },
    { clipName: "Crouching", id: "lower-crouch", labelZh: "蹲伏", part: BODY_PART.LOWER },
    { clipName: "Kneeling", id: "lower-kneel", labelZh: "单膝跪", part: BODY_PART.LOWER },
    { clipName: "Sleeping Side", id: "lower-sleep-side", labelZh: "侧卧", part: BODY_PART.LOWER },
    { clipName: "Sleeping Supine", id: "lower-sleep-supine", labelZh: "仰卧", part: BODY_PART.LOWER },
    { clipName: "Lying Prone", id: "lower-lying-prone", labelZh: "俯卧", part: BODY_PART.LOWER },
    { clipName: "Sleeping Supine Straight", id: "lower-supine-stretch", labelZh: "仰卧伸展", part: BODY_PART.LOWER },
    { clipName: "Standing", id: "lower-stand", labelZh: "站立", part: BODY_PART.LOWER },
    { clipName: "Sitting", id: "upper-sit-knee", labelZh: "坐姿·搭膝", part: BODY_PART.UPPER },
    { clipName: "Sitting Floor", id: "upper-sit-floor", labelZh: "坐地·支撑", part: BODY_PART.UPPER },
    { clipName: "Crouching", id: "upper-crouch-balance", labelZh: "蹲姿·撑地", part: BODY_PART.UPPER },
    { clipName: "Kneeling", id: "upper-kneel-rest", labelZh: "跪姿·垂臂", part: BODY_PART.UPPER },
    { clipName: "Sleeping Side", id: "upper-sleep-side-hug", labelZh: "侧卧·抱臂", part: BODY_PART.UPPER },
    { clipName: "Sleeping Supine", id: "upper-sleep-supine-rest", labelZh: "仰卧·平放", part: BODY_PART.UPPER },
    { clipName: "Lying Prone", id: "upper-lying-prone-rest", labelZh: "俯卧·侧头", part: BODY_PART.UPPER },
    { clipName: "Sleeping Supine Straight", id: "upper-supine-stretch", labelZh: "仰卧·伸展", part: BODY_PART.UPPER },
    { clipName: "Standing", id: "upper-stand-natural", labelZh: "站姿·自然", part: BODY_PART.UPPER },
    { clipName: "Standing", id: "upper-stand-arms-down", labelZh: "垂臂", part: BODY_PART.UPPER },
    { clipName: "Idle", id: "upper-idle", labelZh: "待机", part: BODY_PART.UPPER },
    { clipName: "Walking", id: "upper-walk-swing", labelZh: "行走摆臂", part: BODY_PART.UPPER },
    { clipName: "Running", id: "upper-run-swing", labelZh: "奔跑摆臂", part: BODY_PART.UPPER },
    { clipName: "Jump", id: "upper-jump-spread", labelZh: "跳跃展臂", part: BODY_PART.UPPER },
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
    const sourceComment = animation.extras?.tapnowActorAnimation?.commentZh;
    if (!sourceComment) throw new Error(`clip 缺少中文姿势说明: ${definition.clipName}`);
    const sourceFrameRatio = animation.extras?.tapnowActorAnimation?.sourceFrameRatio ?? 0;
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
    const bones = MIXAMO_PART_BONES[definition.part].reduce<Record<string, QuaternionTuple>>((result, boneName) => {
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
        skeletonFamily: SKELETON_FAMILY_MIXAMO,
        bones,
        custom: false,
    };
}

function formatData(presets: readonly PosePresetJSON[]): string {
    return [
        "/* 由 scripts/extract-pose-presets.ts 从 humanoid-generic.glb 生成，勿手改。 */",
        'import type { PosePresetJSON } from "@/pose/PosePreset";',
        "",
        `export const BUILTIN_POSE_PRESETS: readonly PosePresetJSON[] = ${JSON.stringify(presets, null, 4)};`,
        "",
    ].join("\n");
}

const payload = readGlb(new Uint8Array(await Bun.file(SOURCE_PATH).arrayBuffer()));
const presets = PRESET_DEFINITIONS.map((definition) => createPreset(definition, payload.document, payload.binary));
await Bun.write(OUTPUT_PATH, formatData(presets));
