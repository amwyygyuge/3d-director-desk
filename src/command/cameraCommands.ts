import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

interface ShotIdPayload {
    id: string;
}

/** 切入机位视角:机位必须已存在 */
export class ActivateShotCommand extends DirectorCommand<ShotIdPayload> {
    static readonly TYPE = "camera.activate";
    readonly type = ActivateShotCommand.TYPE;

    constructor(readonly payload: ShotIdPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.camera.director.getShot(this.payload.id) ? [] : [`机位 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.activateShot(this.payload.id);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prev = ctx.camera.activeShotId;
        return prev
            ? [{ type: ActivateShotCommand.TYPE, payload: { id: prev } }]
            : [{ type: DeactivateShotCommand.TYPE, payload: {} }];
    }
}

/** 回导演视角(自由轨道) */
export class DeactivateShotCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "camera.deactivate";
    readonly type = DeactivateShotCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.backToDirectorView();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const prev = ctx.camera.activeShotId;
        return prev ? [{ type: ActivateShotCommand.TYPE, payload: { id: prev } }] : null;
    }
}

/** 删除机位;删激活中的机位时联动回导演视角(CameraStore.removeShot 已收口) */
export class RemoveShotCommand extends DirectorCommand<ShotIdPayload> {
    static readonly TYPE = "camera.remove-shot";
    readonly type = RemoveShotCommand.TYPE;

    constructor(readonly payload: ShotIdPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.camera.director.getShot(this.payload.id) ? [] : [`机位 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.removeShot(this.payload.id);
    }

    /** 机位快照回放;若删的是激活机位,回放后恢复激活态 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const prev = ctx.camera.director.getShot(this.payload.id);
        if (!prev) return null;
        const wasActive = ctx.camera.activeShotId === this.payload.id;
        return [
            { type: "camera.set-shot", payload: { id: this.payload.id, shot: prev.toJSON() } },
            ...(wasActive ? [{ type: ActivateShotCommand.TYPE, payload: { id: this.payload.id } }] : []),
        ];
    }
}

export function registerCameraCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(ActivateShotCommand.TYPE, (payload: ShotIdPayload) => new ActivateShotCommand(payload));
    dispatcher.register(DeactivateShotCommand.TYPE, () => new DeactivateShotCommand());
    dispatcher.register(RemoveShotCommand.TYPE, (payload: ShotIdPayload) => new RemoveShotCommand(payload));
}
