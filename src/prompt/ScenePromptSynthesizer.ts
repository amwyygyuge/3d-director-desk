import { MOTION_MOVE, MOTION_MOVE_LABEL } from "@/authoring/MotionPresetCompiler";
import type { MotionMove } from "@/authoring/MotionPresetCompiler";
import type { CameraKeyPose } from "@/camera/CameraKey";
import { SHOT_SIZE_LABEL } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { azimuthAroundCenter, classifyShotSize } from "@/camera/ShotSizePresets";
import type { Vec3 } from "@/core/SceneObject";
import { LIGHTING_MODE } from "@/store/SceneStore";
import type { LightingMode } from "@/store/SceneStore";

/**
 * 布景 prompt 合成(领域服务,纯函数):把当前场景/机位/运镜/灯光的已授权状态,
 * 编译为「结构化 facet + 中文 prompt」。设计定位:成片最终喂给视频生成模型,
 * 文本是 i2v/v2v 的强条件通道——facet 语言中立(枚举/数值),prompt 是默认中文渲染,
 * 宿主可按目标模型语言重渲。低置信度维度宁可省略,不臆测(错误 token 反噬生成)。
 */

/** 单个被摄体的合成输入(纯数据):世界包围球中心 + 身体偏航 + 半径 + 已挂动作名 */
export interface PromptSubjectInput {
    readonly id: string;
    readonly name: string;
    readonly isActor: boolean;
    readonly actionName: string | null;
    readonly position: Vec3;
    /** 身体偏航(弧度,+Z 前向惯例,与 stage/place 一致) */
    readonly yaw: number;
    readonly radius: number;
}

/** 合成输入快照:由查询从 stores 装配的纯数据,领域服务对它零副作用求值 */
export interface CompositionInput {
    readonly subjects: readonly PromptSubjectInput[];
    /** 生效取景(激活机位或导演 pose);缺省则不产景别 facet */
    readonly shot: { readonly position: Vec3; readonly target: Vec3 } | null;
    /** 唯一运镜片段的关键帧姿态;歧义(多片段/无片段)时为 null,不臆测运镜 */
    readonly motionKeys: readonly CameraKeyPose[] | null;
    readonly lighting: LightingMode;
}

/** 站位构型:由被摄体几何关系派生的构图语义 */
export const STAGE_ARRANGEMENT = {
    FACE_OFF: "face-off",
    SIDE_BY_SIDE: "side-by-side",
    DEPTH: "depth",
    SCATTERED: "scattered",
    SOLO: "solo",
    NONE: "none",
} as const;
export type StageArrangement = (typeof STAGE_ARRANGEMENT)[keyof typeof STAGE_ARRANGEMENT];

const STAGE_ARRANGEMENT_LABEL: Record<StageArrangement, string> = {
    [STAGE_ARRANGEMENT.FACE_OFF]: "面对面对峙",
    [STAGE_ARRANGEMENT.SIDE_BY_SIDE]: "并肩同向",
    [STAGE_ARRANGEMENT.DEPTH]: "前后纵深",
    [STAGE_ARRANGEMENT.SCATTERED]: "群像散布",
    [STAGE_ARRANGEMENT.SOLO]: "单人",
    [STAGE_ARRANGEMENT.NONE]: "空场",
};

const LIGHTING_LABEL: Record<LightingMode, string> = {
    [LIGHTING_MODE.STUDIO]: "工作室三点布光",
    [LIGHTING_MODE.CUSTOM]: "自定义布光",
};

/** 面向判定余弦阈值(约 35°):被摄体前向与「指向对方」的点积高于此即视为朝向对方 */
const FACING_COS_THRESHOLD = 0.82;
/** 并肩判定:两被摄体前向近似同向的余弦阈值(约 45°) */
const SIDE_BY_SIDE_COS_THRESHOLD = 0.7;
/** 运镜轴向相对变化阈值:三轴归一后低于此视为无显著运动(HOLD) */
const MOTION_REL_THRESHOLD = 0.12;

/** 结构化 facet(语言中立):宿主可据此按目标模型语言重渲 prompt */
export interface PromptFacets {
    readonly subjects: readonly {
        readonly name: string;
        readonly isActor: boolean;
        readonly actionName: string | null;
    }[];
    readonly arrangement: StageArrangement;
    readonly framing: ShotSize | null;
    readonly cameraMove: MotionMove | null;
    readonly lighting: LightingMode;
}

export interface SynthesizedPrompt {
    readonly facets: PromptFacets;
    readonly prompt: string;
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance3(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 偏航 → +Z 前向单位向量(glTF 角色面朝 +Z;yaw = atan2(dx,dz) 的逆) */
function faceDirection(yaw: number): Vec3 {
    return [Math.sin(yaw), 0, Math.cos(yaw)];
}

/** 水平面上 from→to 的单位方向;重合返回 null */
function horizontalUnit(from: Vec3, to: Vec3): Vec3 | null {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dz);
    return length === 0 ? null : [dx / length, 0, dz / length];
}

/** 角差归一到 [-π,π](atan2(sin,cos) 消解 2π 缠绕) */
function angleDelta(from: number, to: number): number {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function pairArrangement(a: PromptSubjectInput, b: PromptSubjectInput): StageArrangement {
    const toB = horizontalUnit(a.position, b.position);
    const toA = horizontalUnit(b.position, a.position);
    if (!toB || !toA) return STAGE_ARRANGEMENT.SCATTERED;
    const faceA = faceDirection(a.yaw);
    const faceB = faceDirection(b.yaw);
    const mutual = dot(faceA, toB) >= FACING_COS_THRESHOLD && dot(faceB, toA) >= FACING_COS_THRESHOLD;
    if (mutual) return STAGE_ARRANGEMENT.FACE_OFF;
    return dot(faceA, faceB) >= SIDE_BY_SIDE_COS_THRESHOLD ? STAGE_ARRANGEMENT.SIDE_BY_SIDE : STAGE_ARRANGEMENT.DEPTH;
}

function deriveArrangement(subjects: readonly PromptSubjectInput[]): StageArrangement {
    switch (subjects.length) {
        case 0:
            return STAGE_ARRANGEMENT.NONE;
        case 1:
            return STAGE_ARRANGEMENT.SOLO;
        case 2:
            return pairArrangement(subjects[0]!, subjects[1]!);
        default:
            return STAGE_ARRANGEMENT.SCATTERED;
    }
}

/** 合像包围球半径:被摄体质心到各体「中心 + 自半径」的最大跨度,取景定距用 */
function ensembleRadius(subjects: readonly PromptSubjectInput[]): number {
    const centroid: Vec3 = [
        subjects.reduce((sum, s) => sum + s.position[0], 0) / subjects.length,
        subjects.reduce((sum, s) => sum + s.position[1], 0) / subjects.length,
        subjects.reduce((sum, s) => sum + s.position[2], 0) / subjects.length,
    ];
    return subjects.reduce((max, s) => Math.max(max, distance3(centroid, s.position) + s.radius), 0);
}

function classifyFraming(input: CompositionInput): ShotSize | null {
    const { shot, subjects } = input;
    if (!shot || subjects.length === 0) return null;
    const radius = ensembleRadius(subjects);
    if (radius <= 0) return null;
    return classifyShotSize(distance3(shot.position, shot.target) / radius);
}

/** 三轴(距离/方位/高度)取归一后主导者;皆低于阈值则 HOLD */
function dominantMove(deltas: { distanceRel: number; azimuthRel: number; heightRel: number }): MotionMove {
    const candidates = [
        {
            magnitude: Math.abs(deltas.distanceRel),
            move: deltas.distanceRel < 0 ? MOTION_MOVE.DOLLY_IN : MOTION_MOVE.DOLLY_OUT,
        },
        { magnitude: Math.abs(deltas.azimuthRel), move: MOTION_MOVE.ORBIT },
        { magnitude: Math.abs(deltas.heightRel), move: MOTION_MOVE.CRANE },
    ];
    const winner = candidates.reduce((best, candidate) => (candidate.magnitude > best.magnitude ? candidate : best));
    return winner.magnitude < MOTION_REL_THRESHOLD ? MOTION_MOVE.HOLD : winner.move;
}

function classifyMove(keys: readonly CameraKeyPose[] | null): MotionMove | null {
    if (!keys || keys.length < 2) return null;
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    const startDistance = distance3(first.position, first.target);
    if (startDistance === 0) return null;
    return dominantMove({
        distanceRel: (distance3(last.position, last.target) - startDistance) / startDistance,
        azimuthRel:
            angleDelta(azimuthAroundCenter(first.position, first.target), azimuthAroundCenter(last.position, last.target)) /
            Math.PI,
        heightRel: (last.position[1] - first.position[1]) / startDistance,
    });
}

function renderSubjects(subjects: PromptFacets["subjects"], arrangement: StageArrangement): string {
    if (subjects.length === 0) return STAGE_ARRANGEMENT_LABEL[STAGE_ARRANGEMENT.NONE];
    const named = subjects.map((s) => (s.actionName ? `${s.name}(${s.actionName})` : s.name)).join("、");
    const isFlat = arrangement === STAGE_ARRANGEMENT.SOLO || arrangement === STAGE_ARRANGEMENT.NONE;
    return isFlat ? named : `${named} ${STAGE_ARRANGEMENT_LABEL[arrangement]}`;
}

function renderPrompt(facets: PromptFacets): string {
    const movePhrase =
        facets.cameraMove && facets.cameraMove !== MOTION_MOVE.HOLD ? `镜头${MOTION_MOVE_LABEL[facets.cameraMove]}` : null;
    const parts = [
        renderSubjects(facets.subjects, facets.arrangement),
        facets.framing ? SHOT_SIZE_LABEL[facets.framing] : null,
        movePhrase,
        LIGHTING_LABEL[facets.lighting],
    ];
    return parts.filter((part): part is string => part !== null && part.length > 0).join(",");
}

export class ScenePromptSynthesizer {
    synthesize(input: CompositionInput): SynthesizedPrompt {
        const facets: PromptFacets = {
            subjects: input.subjects.map((s) => ({ name: s.name, isActor: s.isActor, actionName: s.actionName })),
            arrangement: deriveArrangement(input.subjects),
            framing: classifyFraming(input),
            cameraMove: classifyMove(input.motionKeys),
            lighting: input.lighting,
        };
        return { facets, prompt: renderPrompt(facets) };
    }
}
