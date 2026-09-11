import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import {
    EXPOSURE,
    FLOOR_COLOR_DEFAULT,
    GRID_SIZE,
    RENDER_QUALITY,
    isExposureValid,
    isFloorColor,
    isGridSizeValid,
    isRenderQuality,
} from "@/studio/StudioEnvironment";
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

interface SetExposurePayload {
    readonly exposure: number;
}

const SET_EXPOSURE_CONTRACT: PayloadContract = {
    properties: { exposure: { type: "number" } },
    required: ["exposure"],
};

/** 成像曝光:影调意图的数值出口(压暗做低调、提亮做柔和),与画质档同域持久化。 */
export class SetStudioExposureCommand extends DirectorCommand<SetExposurePayload> {
    static readonly TYPE = "studio.set-exposure";
    readonly type = SetStudioExposureCommand.TYPE;

    constructor(readonly payload: SetExposurePayload) {
        super();
    }

    validate(): string[] {
        return isExposureValid(this.payload.exposure)
            ? []
            : [`曝光必须是 ${EXPOSURE.MIN}~${EXPOSURE.MAX} 之间的有限数`];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setExposure(this.payload.exposure);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioExposureCommand.TYPE, payload: { exposure: ctx.studio.exposure } }];
    }
}

interface SetEnabledPayload {
    readonly enabled: boolean;
}

const SET_ENABLED_CONTRACT: PayloadContract = {
    properties: { enabled: { type: "boolean" } },
    required: ["enabled"],
};

/** 环境光照(IBL)开关:开启后金属度/粗糙度才参与成像;程序化环境,无外部资源。 */
export class SetStudioEnvironmentLightingCommand extends DirectorCommand<SetEnabledPayload> {
    static readonly TYPE = "studio.set-environment-lighting";
    readonly type = SetStudioEnvironmentLightingCommand.TYPE;

    constructor(readonly payload: SetEnabledPayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.enabled === "boolean" ? [] : ["环境光照开关必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setEnvironmentLightingEnabled(this.payload.enabled);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [
            {
                type: SetStudioEnvironmentLightingCommand.TYPE,
                payload: { enabled: ctx.studio.environmentLightingEnabled },
            },
        ];
    }
}

/** 投影开关:接地感的主要来源,有每帧深度图成本故显式可关(缺省关)。 */
export class SetStudioShadowsCommand extends DirectorCommand<SetEnabledPayload> {
    static readonly TYPE = "studio.set-shadows";
    readonly type = SetStudioShadowsCommand.TYPE;

    constructor(readonly payload: SetEnabledPayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.enabled === "boolean" ? [] : ["投影开关必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setShadowsEnabled(this.payload.enabled);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioShadowsCommand.TYPE, payload: { enabled: ctx.studio.shadowsEnabled } }];
    }
}

interface SetFloorColorPayload {
    readonly color: string;
}

const SET_FLOOR_COLOR_CONTRACT: PayloadContract = {
    properties: { color: { type: "string" } },
    required: ["color"],
};

/** 地板颜色:画面面积最大的一块,决定人物反差与整体影调,故属成像档位。 */
export class SetStudioFloorColorCommand extends DirectorCommand<SetFloorColorPayload> {
    static readonly TYPE = "studio.set-floor-color";
    readonly type = SetStudioFloorColorCommand.TYPE;

    constructor(readonly payload: SetFloorColorPayload) {
        super();
    }

    validate(): string[] {
        return isFloorColor(this.payload.color)
            ? []
            : [`地板颜色必须是 6 位十六进制(如 ${FLOOR_COLOR_DEFAULT})`];
    }

    execute(ctx: DirectorContext): void {
        ctx.studio.setFloorColor(this.payload.color);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetStudioFloorColorCommand.TYPE, payload: { color: ctx.studio.floorColor } }];
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
            exposureRange: { min: EXPOSURE.MIN, max: EXPOSURE.MAX },
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
    dispatcher.register(
        SetStudioExposureCommand.TYPE,
        (payload: SetExposurePayload) => new SetStudioExposureCommand(payload),
        studioCapability(SetStudioExposureCommand.TYPE, "command", [STUDIO_EDIT_PERMISSION], SET_EXPOSURE_CONTRACT),
    );
    dispatcher.register(
        SetStudioEnvironmentLightingCommand.TYPE,
        (payload: SetEnabledPayload) => new SetStudioEnvironmentLightingCommand(payload),
        studioCapability(
            SetStudioEnvironmentLightingCommand.TYPE,
            "command",
            [STUDIO_EDIT_PERMISSION],
            SET_ENABLED_CONTRACT,
        ),
    );
    dispatcher.register(
        SetStudioShadowsCommand.TYPE,
        (payload: SetEnabledPayload) => new SetStudioShadowsCommand(payload),
        studioCapability(SetStudioShadowsCommand.TYPE, "command", [STUDIO_EDIT_PERMISSION], SET_ENABLED_CONTRACT),
    );
    dispatcher.register(
        SetStudioFloorColorCommand.TYPE,
        (payload: SetFloorColorPayload) => new SetStudioFloorColorCommand(payload),
        studioCapability(
            SetStudioFloorColorCommand.TYPE,
            "command",
            [STUDIO_EDIT_PERMISSION],
            SET_FLOOR_COLOR_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        StudioGetQuery.TYPE,
        (payload: Record<string, never>) => new StudioGetQuery(payload),
        studioCapability(StudioGetQuery.TYPE, "query", [STUDIO_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
}
