import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { GRID_SIZE, RENDER_QUALITY, isGridSizeValid, isRenderQuality } from "@/studio/StudioEnvironment";
import type { RenderQuality } from "@/studio/StudioEnvironment";

const STUDIO_VERSION = "1" as const;
const STUDIO_APPLIES_WHEN = "director-desk.studio-v1";
const STUDIO_EDIT_PERMISSION = "studio:edit";
const STUDIO_READ_PERMISSION = "studio:read";

function studioCapability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return { type, version: STUDIO_VERSION, kind, permissions, appliesWhen: STUDIO_APPLIES_WHEN, payload };
}

interface SetGridSizePayload {
    readonly meters: number;
}

const SET_GRID_SIZE_CONTRACT: PayloadContract = {
    properties: { meters: { type: "number" } },
    required: ["meters"],
};

/** 参考地板边长:工程级演播室档位,进文档也进撤销栈。 */
export class SetStudioGridSizeCommand extends DirectorCommand<SetGridSizePayload> {
    static readonly TYPE = "studio.set-grid-size";
    readonly type = SetStudioGridSizeCommand.TYPE;

    constructor(readonly payload: SetGridSizePayload) {
        super();
    }

    validate(): string[] {
        return isGridSizeValid(this.payload.meters)
            ? []
            : [`地板边长必须是 ${GRID_SIZE.MIN_METERS} 到 ${GRID_SIZE.MAX_METERS} 之间的有限数(米)`];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setGridSizeMeters(this.payload.meters);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioGridSizeCommand.TYPE, payload: { meters: ctx.studio.gridSizeMeters } }];
    }
}

interface SetRenderQualityPayload {
    readonly quality: RenderQuality;
}

const SET_RENDER_QUALITY_CONTRACT: PayloadContract = {
    properties: { quality: { type: "string", enum: Object.values(RENDER_QUALITY) } },
    required: ["quality"],
};

/** 渲染画质档:同时决定截图与 MP4 成片质量,故属工程数据而非本机偏好。 */
export class SetStudioRenderQualityCommand extends DirectorCommand<SetRenderQualityPayload> {
    static readonly TYPE = "studio.set-render-quality";
    readonly type = SetStudioRenderQualityCommand.TYPE;

    constructor(readonly payload: SetRenderQualityPayload) {
        super();
    }

    validate(): string[] {
        return isRenderQuality(this.payload.quality) ? [] : ["渲染画质必须是 high 或 performance"];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setRenderQuality(this.payload.quality);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioRenderQualityCommand.TYPE, payload: { quality: ctx.studio.renderQuality } }];
    }
}

interface SetVisiblePayload {
    readonly visible: boolean;
}

const SET_VISIBLE_CONTRACT: PayloadContract = {
    properties: { visible: { type: "boolean" } },
    required: ["visible"],
};

/** 帧率读数显隐:作者为本工程选定的观测配置,随文档往返。 */
export class SetStudioFrameRateVisibleCommand extends DirectorCommand<SetVisiblePayload> {
    static readonly TYPE = "studio.set-frame-rate-visible";
    readonly type = SetStudioFrameRateVisibleCommand.TYPE;

    constructor(readonly payload: SetVisiblePayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.visible === "boolean" ? [] : ["帧率读数显隐必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setFrameRateVisible(this.payload.visible);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioFrameRateVisibleCommand.TYPE, payload: { visible: ctx.studio.frameRateVisible } }];
    }
}

/** 九宫格构图辅助线显隐:构图判断的一部分,与画幅比例同域持久化。 */
export class SetStudioOutputGridVisibleCommand extends DirectorCommand<SetVisiblePayload> {
    static readonly TYPE = "studio.set-output-grid-visible";
    readonly type = SetStudioOutputGridVisibleCommand.TYPE;

    constructor(readonly payload: SetVisiblePayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.visible === "boolean" ? [] : ["九宫格显隐必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setOutputGridVisible(this.payload.visible);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioOutputGridVisibleCommand.TYPE, payload: { visible: ctx.studio.outputGridVisible } }];
    }
}

/** 演播室档位读模型:AI/宿主可发现当前地板尺度与画质档,不接触 Three 或 canvas。 */
export class StudioGetQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "studio.get";
    readonly type = StudioGetQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return {
            ...ctx.studio.toJSON(),
            gridSizeRangeMeters: { min: GRID_SIZE.MIN_METERS, max: GRID_SIZE.MAX_METERS },
        };
    }
}

export function registerStudioCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        SetStudioGridSizeCommand.TYPE,
        (payload: SetGridSizePayload) => new SetStudioGridSizeCommand(payload),
        studioCapability(SetStudioGridSizeCommand.TYPE, "command", [STUDIO_EDIT_PERMISSION], SET_GRID_SIZE_CONTRACT),
    );
    dispatcher.register(
        SetStudioRenderQualityCommand.TYPE,
        (payload: SetRenderQualityPayload) => new SetStudioRenderQualityCommand(payload),
        studioCapability(
            SetStudioRenderQualityCommand.TYPE,
            "command",
            [STUDIO_EDIT_PERMISSION],
            SET_RENDER_QUALITY_CONTRACT,
        ),
    );
    dispatcher.register(
        SetStudioFrameRateVisibleCommand.TYPE,
        (payload: SetVisiblePayload) => new SetStudioFrameRateVisibleCommand(payload),
        studioCapability(
            SetStudioFrameRateVisibleCommand.TYPE,
            "command",
            [STUDIO_EDIT_PERMISSION],
            SET_VISIBLE_CONTRACT,
        ),
    );
    dispatcher.register(
        SetStudioOutputGridVisibleCommand.TYPE,
        (payload: SetVisiblePayload) => new SetStudioOutputGridVisibleCommand(payload),
        studioCapability(
            SetStudioOutputGridVisibleCommand.TYPE,
            "command",
            [STUDIO_EDIT_PERMISSION],
            SET_VISIBLE_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        StudioGetQuery.TYPE,
        (payload: Record<string, never>) => new StudioGetQuery(payload),
        studioCapability(StudioGetQuery.TYPE, "query", [STUDIO_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
}
