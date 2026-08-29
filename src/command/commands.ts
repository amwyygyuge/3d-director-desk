import { toJS } from "mobx";
import { registerPoseCommands } from "./poseCommands";

import { CameraShot, DEFAULT_CAMERA_FOV } from "../camera/CameraShot";
import { formatFromUrl, MODEL_FORMAT } from "../assets/ModelAsset";
import type { ModelFormat } from "../assets/ModelAsset";
import { isLightColor, isLightIntensity, isLightType, normalizeLightParams } from "../core/LightParams";
import type { LightParams } from "../core/LightParams";
import type { SceneObjectKind, Transform, Vec3 } from "../core/SceneObject";
import type { CommandDispatcher } from "./CommandDispatcher";
import { registerActionCommands } from "./actionCommands";
import { registerCameraCommands, RemoveShotCommand } from "./cameraCommands";
import { registerCaptureCommands } from "./captureCommands";
import { registerLightingCommands } from "./lightingCommands";
import { registerNavigationCommands } from "./navigationCommands";
import { registerTimelineCommands, RestoreTimelineTracksCommand } from "./timelineCommands";
import { registerCameraMotionCommands } from "./cameraMotionCommands";
import { registerContinuityQueries } from "./continuityCommands";
import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";

/** 空间幻觉围栏:一切来自外部(AI/宿主)的数值先过有限性检查 */
function finiteVec3(value: unknown): value is Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

function finiteTransform(value: unknown): value is Transform {
    if (typeof value !== "object" || value === null) return false;
    if (!("position" in value) || !("rotation" in value) || !("scale" in value)) return false;
    return finiteVec3(value.position) && finiteVec3(value.rotation) && finiteVec3(value.scale);
}

/** FOV 合法域:命令校验与 UI 滑杆共用(Rule of Two) */
export const FOV_MIN = 1;
export const FOV_MAX = 179;

const SCENE_OBJECT_KINDS: readonly SceneObjectKind[] = ["model", "primitive", "camera", "light"];
const MODEL_FORMATS: readonly ModelFormat[] = [MODEL_FORMAT.GLTF, MODEL_FORMAT.FBX, MODEL_FORMAT.OBJ];

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
}
/** 校验与执行共用的格式解析(Rule of Two) */
function resolveModelFormat(payload: PlaceObjectPayload): ModelFormat | null {
    return payload.format ?? (payload.sourceUrl ? formatFromUrl(payload.sourceUrl) : null);
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
        const hasLight = payload.light !== undefined && payload.light !== null;
        if ((payload.kind === "light") !== hasLight) {
            issues.push('kind="light" 必须且只能携带 light 参数');
        } else if (
            hasLight &&
            (!isLightType(payload.light?.type) ||
                !isLightColor(payload.light?.color) ||
                !isLightIntensity(payload.light?.intensity))
        ) {
            issues.push("light 参数无效(类型、#rrggbb 颜色或 0~100 强度)");
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        const { light, ...object } = this.payload;
        if (light) {
            ctx.scene.addObject({ ...object, light: normalizeLightParams(light) });
            return;
        }
        ctx.scene.addObject(object);
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveObjectCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

interface MoveObjectPayload {
    id: string;
    transform: Transform;
}

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

export class RemoveObjectCommand extends DirectorCommand<RemoveObjectPayload> {
    static readonly TYPE = "object.remove";
    readonly type = RemoveObjectCommand.TYPE;

    constructor(readonly payload: RemoveObjectPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return ["对象 id 格式无效"];
        }
        return ctx.scene.manager.getEntity(this.payload.id) ? [] : [`对象 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.playback.restoreObject(this.payload.id);
        ctx.timeline.removeObjectTracks(this.payload.id);
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

/** 内置命令注册:Dispatcher 实例化后调一次,AI 工具 schema 由此派生 */
export function registerBuiltinCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(PlaceObjectCommand.TYPE, (payload) => new PlaceObjectCommand(payload));
    dispatcher.register(MoveObjectCommand.TYPE, (payload) => new MoveObjectCommand(payload));
    dispatcher.register(RemoveObjectCommand.TYPE, (payload) => new RemoveObjectCommand(payload));
    dispatcher.register(SetCameraShotCommand.TYPE, (payload) => new SetCameraShotCommand(payload));
    registerActionCommands(dispatcher);
    registerCameraCommands(dispatcher);
    registerCaptureCommands(dispatcher);
    registerNavigationCommands(dispatcher);
    registerTimelineCommands(dispatcher);
    registerLightingCommands(dispatcher);
    registerCameraMotionCommands(dispatcher);
    registerPoseCommands(dispatcher);
    registerContinuityQueries(dispatcher);
}
