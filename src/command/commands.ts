import { toJS } from "mobx";

import type { CommandCapability, DirectorQuery } from "@/command/CommandDispatcher";
import { registerPoseCommands } from "@/command/poseCommands";
import { SceneInspectionService } from "@/command/SceneInspectionService";
import { registerPerceptionCommands } from "@/command/perceptionCommands";

import { CameraShot, DEFAULT_CAMERA_FOV } from "@/camera/CameraShot";
import {
    APERTURE_F_STOP,
    FOCUS_DISTANCE_METERS,
    focalLengthRangeMm,
    fovFromFocalLength,
    isApertureFStop,
    isCameraLensJSON,
    isFocalLengthMm,
    isFocusDistanceMeters,
} from "@/camera/CameraLens";
import type { CameraLensJSON } from "@/camera/CameraLens";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { registerKeyframeCodec } from "@/timeline/keyframeCodecs";
import { TransformKeyframe } from "@/timeline/TransformKeyframe";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrackInit } from "@/timeline/TimelineTrack";
import { buildTransformTrajectory } from "@/timeline/transformTrajectory";
import { formatFromUrl, MODEL_FORMAT } from "@/assets/ModelAsset";
import type { ModelFormat } from "@/assets/ModelAsset";
import { ActorProfile } from "@/actor/ActorProfile";
import type { ActorProfileInit } from "@/actor/ActorProfile";
import type { PoseSnapshotInit } from "@/pose/PoseSnapshot";
import { isLightParams, normalizeLightParams } from "@/core/LightParams";
import type { LightParams } from "@/core/LightParams";
import { finiteTransform, finiteVec3, SCENE_OBJECT_KINDS } from "@/core/SceneObject";
import type { SceneObjectKind, Transform, Vec3 } from "@/core/SceneObject";
import { isSceneSpatialScaleInit, SCENE_SPATIAL_SCALE_KIND } from "@/core/SceneSemantics";
import type { SceneNarrativeIdentityInit, SceneSpatialScaleInit } from "@/core/SceneSemantics";
import type { CommandDispatcher } from "@/command/CommandDispatcher";
import { registerActorCommands } from "@/command/actorCommands";
import { registerActionCommands } from "@/command/actionCommands";
import { registerCameraCommands, RemoveShotCommand } from "@/command/cameraCommands";
import { registerCaptureCommands } from "@/command/captureCommands";
import { LIGHT_PARAMS_SCHEMA } from "@/command/lightParamsSchema";
import { registerLightingCommands } from "@/command/lightingCommands";
import { registerNavigationCommands } from "@/command/navigationCommands";
import { registerTimelineCommands, RestoreTimelineTracksCommand } from "@/command/timelineCommands";
import {
    CreateMotionClipCommand,
    registerCameraMotionCommands,
    SetProgramClipCommand,
} from "@/command/cameraMotionCommands";
import { registerAssetCatalogCommands } from "@/command/assetCatalogCommands";
import { registerDocumentCommands } from "@/command/documentCommands";
import { registerPresentationCommands } from "@/command/presentationCommands";
import { registerMarkerCommands } from "@/command/markerCommands";
import { registerReviewCommands } from "@/command/reviewCommands";
import { registerPlacementCommands } from "@/command/placementCommands";
import { registerStageCommands } from "@/command/stageCommands";
import { registerOutputCommands } from "@/command/outputCommands";
import { registerStudioCommands } from "@/command/studioCommands";
import { registerSceneIdentityCommands } from "@/command/sceneIdentityCommands";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { EMPTY_PAYLOAD_CONTRACT, nullable, TRANSFORM_SCHEMA, VEC3_SCHEMA } from "@/command/PayloadContract";
import type { PayloadContract, PayloadFieldSchema } from "@/command/PayloadContract";

/** FOV 合法域:命令校验与 UI 滑杆共用(Rule of Two) */
export const FOV_MIN = 1;
export const FOV_MAX = 179;

const MODEL_FORMATS: readonly ModelFormat[] = [MODEL_FORMAT.GLTF, MODEL_FORMAT.FBX, MODEL_FORMAT.OBJ];
/** 注视锁定与跟拍共用同一条引用拦截:删除对象前必须先解开任一层绑定 */
const CLIP_REFERENCE_IN_USE_CODE = "clip-reference-in-use";
/** 清空场景在空场景上的结构化拒绝:UI 据此禁用菜单项,AI 据此判断无需再清 */
const SCENE_ALREADY_EMPTY_CODE = "scene-already-empty";
const EMPTY_SCENE_OBJECT_COUNT = 0;
const EMPTY_PAYLOAD: Record<string, never> = {};
const SCENE_EDIT_PERMISSION = "scene:edit";
const SCENE_READ_PERMISSION = "scene:read";
const CAMERA_EDIT_PERMISSION = "camera:edit";
const SCENE_APPLIES_WHEN = "director-desk.scene-v1";
const CAMERA_APPLIES_WHEN = "director-desk.camera-v1";

function commandCapability(
    type: string,
    permission: string,
    appliesWhen: string,
    payload: PayloadContract,
): CommandCapability {
    return { type, version: "1", kind: "command", permissions: [permission], appliesWhen, payload };
}

interface PlaceObjectPayload {
    id: string;
    kind: SceneObjectKind;
    sourceUrl?: string | null;
    /** 可选初始摆位;缺省落原点 */
    transform?: Transform;
    /** kind="model" 时的显式格式;缺省从 sourceUrl 扩展名解析(blob URL 必须显式携带) */
    format?: ModelFormat | null;
    /** 显示名(Outliner/Inspector);缺省由实体按 kind+id 派生 */
    name?: string;
    /** kind="light" 的可序列化值对象；其他 kind 必须无此字段。 */
    light?: LightParams | null;
    /** 撤销回放/文档还原的实体快照字段(SceneObject.toJSON 携带);常规放置不带 */
    pose?: PoseSnapshotInit | null;
    actor?: ActorProfileInit | null;
    narrativeIdentity?: SceneNarrativeIdentityInit | null;
    spatialScale?: SceneSpatialScaleInit | null;
    locked?: boolean | null;
}

const PLACE_OBJECT_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        kind: { type: "string", enum: SCENE_OBJECT_KINDS },
        sourceUrl: nullable({ type: "string" }),
        transform: TRANSFORM_SCHEMA,
        format: nullable({ type: "string", enum: Object.values(MODEL_FORMAT) }),
        name: { type: "string" },
        // 撤销回放带实体全快照:字段必须进契约,否则 redo/undo 删除在闸门处崩。
        pose: nullable({ type: "object" }),
        actor: nullable({ type: "object" }),
        narrativeIdentity: nullable({ type: "object" }),
        spatialScale: nullable({ type: "object" }),
        locked: nullable({ type: "boolean" }),
        light: nullable(LIGHT_PARAMS_SCHEMA),
    },
    required: ["id", "kind"],
};
/** 校验与执行共用的格式解析(Rule of Two) */
function resolveModelFormat(payload: PlaceObjectPayload): ModelFormat | null {
    return payload.format ?? (payload.sourceUrl ? formatFromUrl(payload.sourceUrl) : null);
}
function actorProfileIssue(actor: ActorProfileInit | null | undefined): string | null {
    if (actor === null || actor === undefined) return null;
    try {
        new ActorProfile(actor);
        return null;
    } catch {
        return "人偶画像参数无效";
    }
}

export class PlaceObjectCommand extends DirectorCommand<PlaceObjectPayload> {
    static readonly TYPE = "object.place";
    readonly type = PlaceObjectCommand.TYPE;

    constructor(readonly payload: PlaceObjectPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const payload = this.payload;
        if (
            typeof payload.id !== "string" ||
            payload.id.length === 0 ||
            !SCENE_OBJECT_KINDS.includes(payload.kind) ||
            (payload.sourceUrl !== undefined && payload.sourceUrl !== null && typeof payload.sourceUrl !== "string") ||
            (payload.format !== undefined && payload.format !== null && !MODEL_FORMATS.includes(payload.format)) ||
            (payload.name !== undefined && typeof payload.name !== "string")
        ) {
            return ["对象参数格式无效"];
        }
        const issues: string[] = [];
        if (ctx.scene.manager.getEntity(payload.id)) issues.push(`id "${payload.id}" 已存在`);
        if (payload.transform !== undefined && !finiteTransform(payload.transform)) {
            issues.push("transform 含非法数值");
        }
        if (payload.kind === "model") {
            if (!payload.sourceUrl) issues.push("模型缺少 sourceUrl");
            else if (!resolveModelFormat(payload)) issues.push("无法识别模型格式(支持 glb/gltf/fbx/obj)");
        }
        const hasActor = payload.actor !== undefined && payload.actor !== null;
        const actorIssue = actorProfileIssue(payload.actor);
        issues.push(
            ...(actorIssue ? [actorIssue] : []),
            ...(hasActor && payload.kind !== "model" ? ["只有模型实体可以持有人偶画像"] : []),
        );
        const hasLight = payload.light !== undefined && payload.light !== null;
        if ((payload.kind === "light") !== hasLight) {
            issues.push('kind="light" 必须且只能携带 light 参数');
        } else if (hasLight && !isLightParams(payload.light)) {
            issues.push("light 参数无效(灯型专属参数、#rrggbb 颜色或数值范围)");
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        const { light, ...object } = this.payload;
        // 格式解析与校验共用(Rule of Two):必须落解析结果,否则实体 format=null 被渲染层当静态失败(红框占位)
        // locked 收敛成布尔:契约允许显式 null(撤销快照口径),实体侧只认 boolean
        const resolved = { ...object, format: resolveModelFormat(this.payload), locked: object.locked ?? false };
        if (light) {
            ctx.scene.addObject({ ...resolved, light: normalizeLightParams(light) });
            return;
        }
        ctx.scene.addObject(resolved);
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveObjectCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

interface MoveObjectPayload {
    id: string;
    transform: Transform;
}

const MOVE_OBJECT_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, transform: TRANSFORM_SCHEMA },
    required: ["id", "transform"],
};

export class MoveObjectCommand extends DirectorCommand<MoveObjectPayload> {
    static readonly TYPE = "object.move";
    readonly type = MoveObjectCommand.TYPE;

    constructor(readonly payload: MoveObjectPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return ["对象 id 格式无效"];
        }
        const issues: string[] = [];
        if (!ctx.scene.manager.getEntity(this.payload.id)) issues.push(`对象 "${this.payload.id}" 不存在`);
        if (!finiteTransform(this.payload.transform)) issues.push("transform 含非法数值");
        return issues;
    }

    execute(ctx: DirectorContext): void {
        // 局部动作预览只写骨骼；根 Transform 可在预览持续时安全编辑。
        ctx.scene.updateTransform(this.payload.id, this.payload.transform);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const prev = ctx.scene.manager.getEntity(this.payload.id)?.transform;
        return prev
            ? [{ type: MoveObjectCommand.TYPE, payload: { id: this.payload.id, transform: toJS(prev) } }]
            : null;
    }
}

interface SetLockedPayload {
    id: string;
    locked: boolean;
}

const SET_LOCKED_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, locked: { type: "boolean" } },
    required: ["id", "locked"],
};

/**
 * 交互锁(布景类固定背景):只围栏视口点选/gizmo,命令层写入不受限。
 * 上锁即摘除该实体的选中态,否则 gizmo 仍挂在已锁实体上,围栏在 UI 侧留下失效引用。
 */
export class SetLockedCommand extends DirectorCommand<SetLockedPayload> {
    static readonly TYPE = "object.set-locked";
    readonly type = SetLockedCommand.TYPE;

    constructor(readonly payload: SetLockedPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return ["对象 id 格式无效"];
        }
        const issues: string[] = [];
        if (!ctx.scene.manager.getEntity(this.payload.id)) issues.push(`对象 "${this.payload.id}" 不存在`);
        if (typeof this.payload.locked !== "boolean") issues.push("locked 必须是布尔值");
        return issues;
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.setLocked(this.payload.id, this.payload.locked);
        // 锁上的实体不该继续被 gizmo 持有;解锁不自动恢复选中(选中态是纯 UI 意图)
        if (this.payload.locked && ctx.selection.selectedIds.includes(this.payload.id)) {
            ctx.selection.remove(this.payload.id);
        }
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        // 与 MoveObjectCommand 同一模式:invert 在 execute 之前取旧值快照(见 CommandDispatcher.dispatch)
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        return entity
            ? [{ type: SetLockedCommand.TYPE, payload: { id: this.payload.id, locked: entity.locked } }]
            : null;
    }
}

interface SetSpatialScalePayload {
    id: string;
    spatialScale: SceneSpatialScaleInit;
}

const SET_SPATIAL_SCALE_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, spatialScale: { type: "object" } },
    required: ["id", "spatialScale"],
};

/**
 * 量纲重标定(reference-meters + 最大边实际米数):让未知来源的模型可以按米解释距离。
 * 人偶实体锁死 actor-meters 的不变量由 SceneObject.applySpatialScale 兜底,此处提前给友好 issue。
 */
export class SetSpatialScaleCommand extends DirectorCommand<SetSpatialScalePayload> {
    static readonly TYPE = "object.set-spatial-scale";
    readonly type = SetSpatialScaleCommand.TYPE;

    constructor(readonly payload: SetSpatialScalePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return ["对象 id 格式无效"];
        }
        const issues: string[] = [];
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        if (!entity) issues.push(`对象 "${this.payload.id}" 不存在`);
        if (!isSceneSpatialScaleInit(this.payload.spatialScale)) {
            issues.push(
                "量纲参数无效(kind 取 actor-meters/reference-meters/relative,reference-meters 需正数最大边米数)",
            );
        } else if (entity?.actor && this.payload.spatialScale.kind !== SCENE_SPATIAL_SCALE_KIND.ACTOR_METERS) {
            issues.push("人偶实体锁死 actor-meters 量纲,不可改走");
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.setObjectSpatialScale(this.payload.id, this.payload.spatialScale);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        // 同 MoveObjectCommand 模式:execute 前取旧值,值对象走 toJSON 落纯数据
        const prev = ctx.scene.manager.getEntity(this.payload.id)?.spatialScale;
        return prev
            ? [{ type: SetSpatialScaleCommand.TYPE, payload: { id: this.payload.id, spatialScale: prev.toJSON() } }]
            : null;
    }
}

interface RemoveObjectPayload {
    id: string;
}

const REMOVE_OBJECT_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

export class RemoveObjectCommand extends DirectorCommand<RemoveObjectPayload> {
    static readonly TYPE = "object.remove";
    readonly type = RemoveObjectCommand.TYPE;

    constructor(readonly payload: RemoveObjectPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return [{ code: "object-invalid-id", path: "id", message: "对象 id 格式无效" }];
        }
        if (!ctx.scene.manager.getEntity(this.payload.id)) {
            return [{ code: "object-not-found", path: "id", message: `对象 "${this.payload.id}" 不存在` }];
        }
        const dependentClipIds = ctx.motion.clipsReferencingObject(this.payload.id).map((clip) => clip.id);
        return dependentClipIds.length > 0
            ? [
                  {
                      code: CLIP_REFERENCE_IN_USE_CODE,
                      path: "id",
                      message: `对象 "${this.payload.id}" 被运镜的注视或跟拍引用: ${dependentClipIds.join(", ")}`,
                      options: [
                          { type: "freeze-world-point", label: "冻结为世界点后删除" },
                          { type: "remove-dependent-focus", label: "移除关联注视后删除" },
                          { type: "unbind-dependent-follow", label: "解除关联跟拍后删除" },
                      ],
                  },
              ]
            : [];
    }

    execute(ctx: DirectorContext): void {
        detachObject(ctx, this.payload.id);
        if (ctx.binder.isEmpty) ctx.clock.pause();
    }

    /**
     * 实体与时间轴轨道快照必须同次回放恢复，确保对象删除的轨道清理可撤销。
     * 只快照 transform 轨:RestoreTimelineTracksCommand 目前只接受这一种,
     * 塞入别种会让整条撤销被校验拒掉(新增轨道种类须同批扩两处)。
     */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        if (!entity) return null;
        const tracks = transformTrackSnapshots(ctx, entity.id);
        const restoreObject: SerializedCommand = {
            type: PlaceObjectCommand.TYPE,
            payload: entity.toJSON(),
        };
        return tracks.length === 0
            ? [restoreObject]
            : [restoreObject, { type: RestoreTimelineTracksCommand.TYPE, payload: { tracks } }];
    }
}

/**
 * 实体退场的统一收束(删单个与清空场景共用,Rule of Two)。
 * 运行时姿态、走位轨、动作绑定与三类选中态在此一处收敛,禁两个命令各写一份漏一项。
 */
function detachObject(ctx: DirectorContext, id: string): void {
    ctx.playback.restoreObject(id);
    for (const track of ctx.timeline.removeObjectTracks(id)) ctx.timelineSelection.forget(track.id);
    ctx.timelineSelection.forget(id);
    ctx.binder.unmount(id);
    ctx.scene.removeObject(id);
    ctx.selection.remove(id);
    // 装载结局随实体退场作废:同 id 的模型再进场时必须重新等真实骨架,不能沿用上一条 "loaded"
    ctx.ui.forgetModelOutcome(id);
    if (ctx.ui.posePickingObjectId === id) ctx.ui.setPosePicking(null, null);
}

/** 撤销快照只取 transform 轨:恢复命令的受理范围就是这一种(见 RestoreTimelineTracksCommand)。 */
function transformTrackSnapshots(ctx: DirectorContext, targetId: string): readonly TimelineTrackInit[] {
    return ctx.timeline.document.tracks
        .filter((track) => track.targetId === targetId && track.kind === TIMELINE_TRACK_KIND.TRANSFORM)
        .map((track) => track.toJSON());
}

/**
 * 引用了场景实体的运镜片段(去重)。
 * 判据不在此处重写:`clipsReferencingObject` 是注视 ∪ 跟拍的唯一真相源,
 * 单个删除的拦截与清空场景的连带退场共用它。
 */
function dependentMotionClips(ctx: DirectorContext): readonly CameraMotionClip[] {
    const dependents = new Map<string, CameraMotionClip>();
    for (const entity of ctx.scene.manager.list()) {
        for (const clip of ctx.motion.clipsReferencingObject(entity.id)) dependents.set(clip.id, clip);
    }
    return [...dependents.values()];
}

/**
 * 清空场景(聚合命令,地基优先红线 15)。
 *
 * 逐个 `object.remove` 做不到这件事:被运镜注视/跟拍引用的对象会被 clip-reference-in-use 拦下,
 * 于是「清空」总留下一批清不掉的残留;N 次 dispatch 还会把撤销碎成 N 步,
 * 中途被拒即留下「实体删了一半、运镜还指着另一半」的孤儿状态。
 *
 * 本命令按依赖序一次退场:先撤运镜覆盖层(`removeClip` 连带清掉它的 Program 排期),
 * 再让实体退场。`invert` 反序一次装回实体 → 走位轨 → 运镜 → 排期,撤销只一步。
 */
export class ClearSceneCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "scene.clear";
    readonly type = ClearSceneCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return ctx.scene.objectCount > EMPTY_SCENE_OBJECT_COUNT
            ? []
            : [{ code: SCENE_ALREADY_EMPTY_CODE, path: "", message: "场景已经是空的,无需清空" }];
    }

    execute(ctx: DirectorContext): void {
        // 运镜先退场:它引用实体,留到实体消失之后就是一段指空的孤儿片段
        for (const clip of dependentMotionClips(ctx)) {
            ctx.motionAuthoring.forgetClip(clip.id);
            ctx.timelineSelection.forget(clip.id);
            ctx.motion.removeClip(clip.id);
        }
        for (const entity of ctx.scene.manager.list()) detachObject(ctx, entity.id);
        if (ctx.binder.isEmpty) ctx.clock.pause();
        ctx.playback.sampleCurrent();
    }

    /**
     * 装回顺序即校验顺序:轨道恢复要求目标实体在场、运镜要求注视/跟拍对象在场、
     * Program 片段要求所引运镜在场。任一条提前,整条撤销会被自己的校验链拒掉。
     */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const entities = ctx.scene.manager.list();
        const tracks = entities.flatMap((entity) => transformTrackSnapshots(ctx, entity.id));
        const clips = dependentMotionClips(ctx);
        const clipIds = new Set(clips.map((clip) => clip.id));
        const programClips = ctx.motion.program.clips.filter(
            (clip) => clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP && clipIds.has(clip.source.motionClipId),
        );
        return [
            ...entities.map((entity) => ({ type: PlaceObjectCommand.TYPE, payload: entity.toJSON() })),
            ...(tracks.length > 0 ? [{ type: RestoreTimelineTracksCommand.TYPE, payload: { tracks } }] : []),
            ...clips.map((clip) => ({ type: CreateMotionClipCommand.TYPE, payload: { clip: clip.toJSON() } })),
            ...programClips.map((clip) => ({ type: SetProgramClipCommand.TYPE, payload: { clip: clip.toJSON() } })),
        ];
    }
}

interface SetCameraShotPayload {
    id: string;
    shot: { position: Vec3; target: Vec3; fov?: number; lens?: CameraLensJSON };
}

const CAMERA_LENS_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        apertureFStop: { type: "number" },
        // null = 自动对焦到注视目标,是合法取值而非缺省占位
        focusDistanceMeters: nullable({ type: "number" }),
    },
};
const SET_CAMERA_SHOT_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        shot: {
            type: "object",
            properties: {
                position: VEC3_SCHEMA,
                target: VEC3_SCHEMA,
                fov: { type: "number" },
                lens: CAMERA_LENS_SCHEMA,
            },
            required: ["position", "target"],
        },
    },
    required: ["id", "shot"],
};

export class SetCameraShotCommand extends DirectorCommand<SetCameraShotPayload> {
    static readonly TYPE = "camera.set-shot";
    readonly type = SetCameraShotCommand.TYPE;

    constructor(readonly payload: SetCameraShotPayload) {
        super();
    }

    validate(): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return ["机位 id 格式无效"];
        }
        const { shot } = this.payload;
        if (typeof shot !== "object" || shot === null) return ["机位参数格式无效"];
        const issues: string[] = [];
        if (!finiteVec3(shot.position) || !finiteVec3(shot.target)) issues.push("机位坐标含非法数值");
        const fov = shot.fov ?? DEFAULT_CAMERA_FOV;
        if (!Number.isFinite(fov) || fov < FOV_MIN || fov > FOV_MAX) {
            issues.push(`fov 须在 ${FOV_MIN}~${FOV_MAX} 之间的有限数`);
        }
        if (shot.lens !== undefined && !isCameraLensJSON(shot.lens)) {
            issues.push(
                `镜头参数无效:光圈须在 f/${APERTURE_F_STOP.MIN}~f/${APERTURE_F_STOP.MAX},` +
                    `对焦距离须为 null 或 ${FOCUS_DISTANCE_METERS.MIN}~${FOCUS_DISTANCE_METERS.MAX} 米`,
            );
        }
        return issues;
    }

    /**
     * `lens` 缺省 = **保持原镜头**,不是回默认值。
     *
     * 摆位手势与坐标/视角输入都只关心几何,它们一律不带 lens;若按 `CameraShot` 的构造缺省
     * 兑现成 f/2.8 + 自动对焦,作者在视口里动一下机位就会静默擦掉刚设好的光圈与对焦距离
     * (撤销栈能还原,但作者不会知道自己丢了东西)。要显式改镜头走 `camera.set-lens`。
     */
    execute(ctx: DirectorContext): void {
        const lens = this.payload.shot.lens ?? ctx.camera.director.getShot(this.payload.id)?.lens;
        ctx.camera.addShot(this.payload.id, new CameraShot(lens ? { ...this.payload.shot, lens } : this.payload.shot));
    }

    /** 覆盖已有机位 → 回滚旧参数;新建 → 撤销即删除 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prev = ctx.camera.director.getShot(this.payload.id);
        return prev
            ? [{ type: SetCameraShotCommand.TYPE, payload: { id: this.payload.id, shot: prev.toJSON() } }]
            : [{ type: RemoveShotCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

interface SetCameraLensPayload {
    readonly id: string;
    /** 焦距(毫米):写入时换算成 fov,不另存一份 */
    readonly focalLengthMm?: number;
    readonly apertureFStop?: number;
    /** null = 自动对焦到注视目标 */
    readonly focusDistanceMeters?: number | null;
}

const SET_CAMERA_LENS_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        focalLengthMm: { type: "number" },
        apertureFStop: { type: "number" },
        focusDistanceMeters: nullable({ type: "number" }),
    },
    required: ["id"],
};

/**
 * 镜头参数(焦距/光圈/对焦距离):按摄影语言给参数,不用 fov 这个渲染量。
 *
 * 焦距写入即换算成 `fov`——它是派生视图,存两份必然漂移(见 `CameraLens`)。
 * 换算依赖画幅宽高比(同一支 50mm 在 16:9 与 1:1 上视场角不同),故取当前输出画幅;
 * 未给的字段保持原值,便于「只改光圈」这类单点调整。
 */
export class SetCameraLensCommand extends DirectorCommand<SetCameraLensPayload> {
    static readonly TYPE = "camera.set-lens";
    readonly type = SetCameraLensCommand.TYPE;

    constructor(readonly payload: SetCameraLensPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) return ["机位 id 格式无效"];
        if (!ctx.camera.director.getShot(this.payload.id)) return [`机位 "${this.payload.id}" 不存在`];
        const issues: string[] = [];
        const focal = this.payload.focalLengthMm;
        // 画幅取项目输出比例(不是画布):焦距是成片属性,拖窗口不该让标称焦距漂移
        const aspect = ctx.output.aspectRatioFor(ctx.capture.size);
        if (focal !== undefined && !isFocalLengthMm(focal, aspect)) {
            const range = focalLengthRangeMm(aspect);
            issues.push(`焦距须在 ${range.min.toFixed(2)}~${range.max.toFixed(0)}mm 之间(由 fov 围栏换算)`);
        }
        if (this.payload.apertureFStop !== undefined && !isApertureFStop(this.payload.apertureFStop)) {
            issues.push(`光圈须在 f/${APERTURE_F_STOP.MIN}~f/${APERTURE_F_STOP.MAX} 之间`);
        }
        if (
            this.payload.focusDistanceMeters !== undefined &&
            !isFocusDistanceMeters(this.payload.focusDistanceMeters)
        ) {
            issues.push(
                `对焦距离须为 null(自动对焦到注视目标)或 ${FOCUS_DISTANCE_METERS.MIN}~${FOCUS_DISTANCE_METERS.MAX} 米`,
            );
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        const previous = ctx.camera.director.getShot(this.payload.id);
        if (!previous) return;
        const focal = this.payload.focalLengthMm;
        ctx.camera.addShot(
            this.payload.id,
            new CameraShot({
                position: previous.position,
                target: previous.target,
                fov:
                    focal === undefined
                        ? previous.fov
                        : fovFromFocalLength(focal, ctx.output.aspectRatioFor(ctx.capture.size)),
                lens: {
                    apertureFStop: this.payload.apertureFStop ?? previous.lens.apertureFStop,
                    focusDistanceMeters:
                        this.payload.focusDistanceMeters === undefined
                            ? previous.lens.focusDistanceMeters
                            : this.payload.focusDistanceMeters,
                },
            }),
        );
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prev = ctx.camera.director.getShot(this.payload.id);
        return prev ? [{ type: SetCameraShotCommand.TYPE, payload: { id: this.payload.id, shot: prev.toJSON() } }] : [];
    }
}

const SCENE_DESCRIBE_CAPABILITY: CommandCapability = {
    type: "scene.describe",
    version: "1",
    kind: "query",
    permissions: [SCENE_READ_PERMISSION],
    appliesWhen: SCENE_APPLIES_WHEN,
    payload: EMPTY_PAYLOAD_CONTRACT,
};

/**
 * 场景全貌查询(agent 的「眼睛」主通道):每个实体的变换/加载态/世界包围盒。
 * 断言用途:装载是否成功(loadState)、尺度是否符合预期(bounds.size)、相对位置(transform)。
 */
export class SceneDescribeQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "scene.describe";
    readonly type = SceneDescribeQuery.TYPE;
    private readonly inspection = new SceneInspectionService();

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }
    execute(ctx: DirectorContext): unknown {
        return this.inspection.inspect(ctx);
    }
}

/**
 * 内置关键帧种类装配:时间轴轨道容器的唯一种类注册点。
 * 每实例 stores 工厂都会调用,幂等(见 keyframeCodecs);新增种类在此加一行,轨道零改动。
 */
export function registerBuiltinKeyframeCodecs(): void {
    registerKeyframeCodec({
        kind: TIMELINE_TRACK_KIND.TRANSFORM,
        owns: (keyframe): keyframe is TransformKeyframe => keyframe instanceof TransformKeyframe,
        fromInit: (init) => new TransformKeyframe(init as TransformKeyframeInit),
        trajectory: buildTransformTrajectory,
    });
}

/** 内置命令注册:Dispatcher 实例化后调一次,AI 工具 schema 由此派生 */
export function registerBuiltinCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        PlaceObjectCommand.TYPE,
        (payload) => new PlaceObjectCommand(payload),
        commandCapability(PlaceObjectCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, PLACE_OBJECT_CONTRACT),
    );
    dispatcher.register(
        MoveObjectCommand.TYPE,
        (payload) => new MoveObjectCommand(payload),
        commandCapability(MoveObjectCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, MOVE_OBJECT_CONTRACT),
    );
    dispatcher.register(
        RemoveObjectCommand.TYPE,
        (payload) => new RemoveObjectCommand(payload),
        commandCapability(RemoveObjectCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, REMOVE_OBJECT_CONTRACT),
    );
    dispatcher.register(
        SetLockedCommand.TYPE,
        (payload) => new SetLockedCommand(payload),
        commandCapability(SetLockedCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, SET_LOCKED_CONTRACT),
    );
    dispatcher.register(
        SetSpatialScaleCommand.TYPE,
        (payload) => new SetSpatialScaleCommand(payload),
        commandCapability(
            SetSpatialScaleCommand.TYPE,
            SCENE_EDIT_PERMISSION,
            SCENE_APPLIES_WHEN,
            SET_SPATIAL_SCALE_CONTRACT,
        ),
    );
    dispatcher.register(
        ClearSceneCommand.TYPE,
        (payload: Record<string, never>) => new ClearSceneCommand(payload),
        commandCapability(ClearSceneCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        SetCameraShotCommand.TYPE,
        (payload) => new SetCameraShotCommand(payload),
        commandCapability(
            SetCameraShotCommand.TYPE,
            CAMERA_EDIT_PERMISSION,
            CAMERA_APPLIES_WHEN,
            SET_CAMERA_SHOT_CONTRACT,
        ),
    );
    dispatcher.register(
        SetCameraLensCommand.TYPE,
        (payload) => new SetCameraLensCommand(payload),
        commandCapability(
            SetCameraLensCommand.TYPE,
            CAMERA_EDIT_PERMISSION,
            CAMERA_APPLIES_WHEN,
            SET_CAMERA_LENS_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        SceneDescribeQuery.TYPE,
        (payload: Record<string, never>) => new SceneDescribeQuery(payload),
        SCENE_DESCRIBE_CAPABILITY,
    );
    registerSceneIdentityCommands(dispatcher);
    registerPerceptionCommands(dispatcher);
    registerActionCommands(dispatcher);
    registerCameraCommands(dispatcher);
    registerCaptureCommands(dispatcher);
    registerOutputCommands(dispatcher);
    registerStudioCommands(dispatcher);
    registerNavigationCommands(dispatcher);
    registerTimelineCommands(dispatcher);
    registerLightingCommands(dispatcher);
    registerCameraMotionCommands(dispatcher);
    registerPoseCommands(dispatcher);
    registerActorCommands(dispatcher);
    registerDocumentCommands(dispatcher);
    registerPresentationCommands(dispatcher);
    registerAssetCatalogCommands(dispatcher);
    registerPlacementCommands(dispatcher);
    registerStageCommands(dispatcher);
    registerMarkerCommands(dispatcher);
    registerReviewCommands(dispatcher);
}
