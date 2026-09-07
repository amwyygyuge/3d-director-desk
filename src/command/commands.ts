import { toJS } from "mobx";
import { Box3, Vector3 } from "three";

import { measureModelBox } from "@/core/measureModelBox";
import type { SceneObject } from "@/core/SceneObject";
import type { CommandCapability, DirectorQuery } from "@/command/CommandDispatcher";
import { registerPoseCommands } from "@/command/poseCommands";

import { CameraShot, DEFAULT_CAMERA_FOV } from "@/camera/CameraShot";
import { registerKeyframeCodec } from "@/timeline/keyframeCodecs";
import { TransformKeyframe } from "@/timeline/TransformKeyframe";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
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
import type { CommandDispatcher } from "@/command/CommandDispatcher";
import { registerActorCommands } from "@/command/actorCommands";
import { registerActionCommands } from "@/command/actionCommands";
import { registerCameraCommands, RemoveShotCommand } from "@/command/cameraCommands";
import { registerCaptureCommands } from "@/command/captureCommands";
import { LIGHT_PARAMS_SCHEMA } from "@/command/lightParamsSchema";
import { registerLightingCommands } from "@/command/lightingCommands";
import { registerNavigationCommands } from "@/command/navigationCommands";
import { registerTimelineCommands, RestoreTimelineTracksCommand } from "@/command/timelineCommands";
import { registerCameraMotionCommands } from "@/command/cameraMotionCommands";
import { registerAssetCatalogCommands } from "@/command/assetCatalogCommands";
import { registerDocumentCommands } from "@/command/documentCommands";
import { registerPresentationCommands } from "@/command/presentationCommands";
import { registerMarkerCommands } from "@/command/markerCommands";
import { registerReviewCommands } from "@/command/reviewCommands";
import { registerPlacementCommands } from "@/command/placementCommands";
import { registerStageCommands } from "@/command/stageCommands";
import { entityLoadState } from "@/command/subjectBounds";
import type { EntityLoadState } from "@/command/subjectBounds";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { EMPTY_PAYLOAD_CONTRACT, nullable, TRANSFORM_SCHEMA, VEC3_SCHEMA } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";

/** FOV 合法域:命令校验与 UI 滑杆共用(Rule of Two) */
export const FOV_MIN = 1;
export const FOV_MAX = 179;

const MODEL_FORMATS: readonly ModelFormat[] = [MODEL_FORMAT.GLTF, MODEL_FORMAT.FBX, MODEL_FORMAT.OBJ];
/** 注视锁定与跟拍共用同一条引用拦截:删除对象前必须先解开任一层绑定 */
const CLIP_REFERENCE_IN_USE_CODE = "clip-reference-in-use";
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
}

const PLACE_OBJECT_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        kind: { type: "string", enum: SCENE_OBJECT_KINDS },
        sourceUrl: nullable({ type: "string" }),
        transform: TRANSFORM_SCHEMA,
        format: nullable({ type: "string", enum: Object.values(MODEL_FORMAT) }),
        name: { type: "string" },
        // 撤销回放带实体全快照:pose/actor 必须进契约,否则 redo/undo 删除在闸门处崩
        pose: nullable({ type: "object" }),
        actor: nullable({ type: "object" }),
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
        const resolved = { ...object, format: resolveModelFormat(this.payload) };
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
        ctx.playback.restoreObject(this.payload.id);
        for (const track of ctx.timeline.removeObjectTracks(this.payload.id)) ctx.timelineSelection.forget(track.id);
        ctx.binder.unmount(this.payload.id);
        ctx.scene.removeObject(this.payload.id);
        ctx.selection.remove(this.payload.id);
        if (ctx.ui.posePickingObjectId === this.payload.id) ctx.ui.setPosePicking(null, null);
        if (ctx.binder.isEmpty) ctx.clock.pause();
    }

    /** 实体与时间轴轨道快照必须同次回放恢复，确保对象删除的轨道清理可撤销。 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        if (!entity) return null;
        const tracks = ctx.timeline.document.tracks
            .filter((track) => track.targetId === entity.id)
            .map((track) => track.toJSON());
        const restoreObject: SerializedCommand = {
            type: PlaceObjectCommand.TYPE,
            payload: entity.toJSON(),
        };
        return tracks.length === 0
            ? [restoreObject]
            : [restoreObject, { type: RestoreTimelineTracksCommand.TYPE, payload: { tracks } }];
    }
}

interface SetCameraShotPayload {
    id: string;
    shot: { position: Vec3; target: Vec3; fov?: number };
}

const SET_CAMERA_SHOT_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        shot: {
            type: "object",
            properties: {
                position: VEC3_SCHEMA,
                target: VEC3_SCHEMA,
                fov: { type: "number" },
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
        return issues;
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.addShot(this.payload.id, new CameraShot(this.payload.shot));
    }

    /** 覆盖已有机位 → 回滚旧参数;新建 → 撤销即删除 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prev = ctx.camera.director.getShot(this.payload.id);
        return prev
            ? [{ type: SetCameraShotCommand.TYPE, payload: { id: this.payload.id, shot: prev.toJSON() } }]
            : [{ type: RemoveShotCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

/** 场景实体的 agent 可读描述(验收断言的数据面) */
interface SceneEntityDescription {
    readonly id: string;
    readonly kind: SceneObjectKind;
    readonly name: string;
    readonly transform: Transform;
    /** none=非模型无装载;loading/loaded/failed 由 UiStore 装载结果表与运行时绑定共同判定 */
    readonly loadState: EntityLoadState;
    /** 挂载的 AnimationLibrary action id；未挂载为 null。 */
    readonly mountedActionId: string | null;
    /** 动作时间轴排期;未挂载为 null。 */
    readonly actionSchedule: { readonly startTimeSeconds: number; readonly durationSeconds: number } | null;
    readonly bounds: { readonly size: Vec3; readonly center: Vec3 } | null;
}

const TMP_DESCRIBE_BOX = new Box3();
const TMP_DESCRIBE_SIZE = new Vector3();
const TMP_DESCRIBE_CENTER = new Vector3();

const SCENE_DESCRIBE_CAPABILITY: CommandCapability = {
    type: "scene.describe",
    version: "1",
    kind: "query",
    permissions: [SCENE_READ_PERMISSION],
    appliesWhen: SCENE_APPLIES_WHEN,
    payload: EMPTY_PAYLOAD_CONTRACT,
};

function describeEntity(ctx: DirectorContext, entity: SceneObject): SceneEntityDescription {
    const runtime = ctx.scene.manager.getRuntime(entity.id);
    let bounds: SceneEntityDescription["bounds"] = null;
    if (runtime) {
        measureModelBox(runtime, TMP_DESCRIBE_BOX);
        if (!TMP_DESCRIBE_BOX.isEmpty()) {
            TMP_DESCRIBE_BOX.getSize(TMP_DESCRIBE_SIZE);
            TMP_DESCRIBE_BOX.getCenter(TMP_DESCRIBE_CENTER);
            bounds = {
                size: TMP_DESCRIBE_SIZE.toArray() as Vec3,
                center: TMP_DESCRIBE_CENTER.toArray() as Vec3,
            };
        }
    }
    return {
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        transform: toJS(entity.transform),
        loadState: entityLoadState(ctx, entity),
        mountedActionId: entity.actionId,
        actionSchedule: entity.actionPerformance
            ? {
                  startTimeSeconds: entity.actionPerformance.startTimeSeconds,
                  durationSeconds: entity.actionPerformance.durationSeconds,
              }
            : null,
        bounds,
    };
}

/**
 * 场景全貌查询(agent 的「眼睛」主通道):每个实体的变换/加载态/世界包围盒。
 * 断言用途:装载是否成功(loadState)、尺度是否符合预期(bounds.size)、相对位置(transform)。
 */
export class SceneDescribeQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "scene.describe";
    readonly type = SceneDescribeQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return ctx.scene.manager.list().map((entity) => describeEntity(ctx, entity));
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
        SetCameraShotCommand.TYPE,
        (payload) => new SetCameraShotCommand(payload),
        commandCapability(
            SetCameraShotCommand.TYPE,
            CAMERA_EDIT_PERMISSION,
            CAMERA_APPLIES_WHEN,
            SET_CAMERA_SHOT_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        SceneDescribeQuery.TYPE,
        (payload: Record<string, never>) => new SceneDescribeQuery(payload),
        SCENE_DESCRIBE_CAPABILITY,
    );
    registerActionCommands(dispatcher);
    registerCameraCommands(dispatcher);
    registerCaptureCommands(dispatcher);
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
