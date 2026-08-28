import { CameraShot } from "../camera/CameraShot";
import { formatFromUrl } from "../assets/ModelAsset";
import type { ModelFormat } from "../assets/ModelAsset";
import type { SceneObjectKind, Transform, Vec3 } from "../core/SceneObject";
import type { CommandDispatcher } from "./CommandDispatcher";
import { registerActionCommands } from "./actionCommands";
import { registerCameraCommands, RemoveShotCommand } from "./cameraCommands";
import { registerCaptureCommands } from "./captureCommands";
import { registerNavigationCommands } from "./navigationCommands";
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

interface PlaceObjectPayload {
    id: string;
    kind: SceneObjectKind;
    sourceUrl?: string;
    /** 可选初始摆位;缺省落原点 */
    transform?: Transform;
    /** kind="model" 时的显式格式;缺省从 sourceUrl 扩展名解析(blob URL 必须显式携带) */
    format?: ModelFormat;
    /** 显示名(Outliner/Inspector);缺省由实体按 kind+id 派生 */
    name?: string;
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
        const issues: string[] = [];
        if (!this.payload.id) issues.push("id 不能为空");
        if (ctx.scene.manager.getEntity(this.payload.id)) issues.push(`id "${this.payload.id}" 已存在`);
        if (this.payload.transform !== undefined && !finiteTransform(this.payload.transform)) {
            issues.push("transform 含非法数值");
        }
        if (this.payload.kind === "model") {
            if (!this.payload.sourceUrl) issues.push("模型缺少 sourceUrl");
            else if (!resolveModelFormat(this.payload)) issues.push("无法识别模型格式(支持 glb/gltf/fbx/obj)");
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.addObject({ ...this.payload, format: resolveModelFormat(this.payload) });
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
        return prev ? [{ type: MoveObjectCommand.TYPE, payload: { id: this.payload.id, transform: prev } }] : null;
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
        return ctx.scene.manager.getEntity(this.payload.id) ? [] : [`对象 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.removeObject(this.payload.id);
    }

    /** 实体快照回放;已知限制:不恢复动作挂载(运行时异步,模型就绪时序不可控) */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        if (!entity) return null;
        return [
            {
                type: PlaceObjectCommand.TYPE,
                payload: {
                    id: entity.id,
                    kind: entity.kind,
                    sourceUrl: entity.sourceUrl ?? undefined,
                    format: entity.format ?? undefined,
                    name: entity.name,
                    transform: entity.transform,
                },
            },
        ];
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
        const { shot } = this.payload;
        const issues: string[] = [];
        if (!this.payload.id) issues.push("机位 id 不能为空");
        if (!finiteVec3(shot.position) || !finiteVec3(shot.target)) issues.push("机位坐标含非法数值");
        const fov = shot.fov ?? 45;
        if (fov < FOV_MIN || fov > FOV_MAX) issues.push(`fov 须在 ${FOV_MIN}~${FOV_MAX} 之间`);
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
}
