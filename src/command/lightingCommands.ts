import { isLightingMode, LIGHTING_MODE } from "@/store/SceneStore";
import type { LightingMode } from "@/store/SceneStore";

import {
    isLightColor,
    isLightDecay,
    isLightDistance,
    isLightIntensity,
    isLightPenumbra,
    isLightType,
    isSpotAngleDegrees,
    normalizeLightParams,
} from "@/core/LightParams";
import type { LightParams } from "@/core/LightParams";
import type { SceneObject, Vec3 } from "@/core/SceneObject";
import { subjectBoundsFor } from "@/command/subjectBounds";
import { LIGHTING_MOOD, LightingMoodCompiler, isLightingMood } from "@/lighting/LightingMoodCompiler";
import type { LightingMood } from "@/lighting/LightingMoodCompiler";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { LIGHT_PARAMS_SCHEMA } from "@/command/lightParamsSchema";
import { EMPTY_PAYLOAD_CONTRACT, isPayloadRecord } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";

const LIGHTING_COMMAND_VERSION = "1" as const;
const LIGHTING_PERMISSION = "lighting:edit";
const LIGHTING_READ_PERMISSION = "lighting:read";
const EMPTY_PAYLOAD: Record<string, never> = {};

const ISSUE_CODE = {
    PAYLOAD: "lighting.invalid-payload",
    TARGET: "lighting.target-not-found",
    TARGET_KIND: "lighting.target-not-light",
} as const;

interface AdjustLightPayload {
    readonly id: string;
    readonly light: LightParams;
}

interface GetLightPayload {
    readonly id: string;
}

interface SetLightingModePayload {
    readonly mode: LightingMode;
}

export interface LightingObjectSnapshot {
    readonly id: string;
    readonly name: string;
    readonly transform: SceneObject["transform"];
    readonly light: LightParams;
}

const ADJUST_LIGHT_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, light: LIGHT_PARAMS_SCHEMA },
    required: ["id", "light"],
};

const SET_LIGHTING_MODE_CONTRACT: PayloadContract = {
    properties: { mode: { type: "string", enum: Object.values(LIGHTING_MODE) } },
    required: ["mode"],
};

const GET_LIGHT_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function lightPayloadIssues(value: unknown, path: string): readonly CommandIssue[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [issue(ISSUE_CODE.PAYLOAD, path, "灯光参数格式无效")];
    }
    const candidate = value as {
        readonly type?: unknown;
        readonly color?: unknown;
        readonly intensity?: unknown;
        readonly distance?: unknown;
        readonly decay?: unknown;
        readonly angleDegrees?: unknown;
        readonly penumbra?: unknown;
    };
    if (!isLightType(candidate.type)) {
        return [issue(ISSUE_CODE.PAYLOAD, `${path}.type`, "灯光类型必须是 directional、point 或 spot")];
    }
    const baseIssues = [
        fieldIssue(isLightColor(candidate.color), `${path}.color`, "灯光颜色必须是 #rrggbb"),
        fieldIssue(isLightIntensity(candidate.intensity), `${path}.intensity`, "灯光强度必须是 0~100 的有限数"),
    ].flat();
    switch (candidate.type) {
        case "directional":
            return baseIssues;
        case "point":
            return [
                ...baseIssues,
                fieldIssue(isLightDistance(candidate.distance), `${path}.distance`, "灯光范围必须是 0~100 米的有限数"),
                fieldIssue(isLightDecay(candidate.decay), `${path}.decay`, "灯光衰减必须是 0~4 的有限数"),
            ].flat();
        case "spot":
            return [
                ...baseIssues,
                fieldIssue(isLightDistance(candidate.distance), `${path}.distance`, "灯光范围必须是 0~100 米的有限数"),
                fieldIssue(isLightDecay(candidate.decay), `${path}.decay`, "灯光衰减必须是 0~4 的有限数"),
                fieldIssue(
                    isSpotAngleDegrees(candidate.angleDegrees),
                    `${path}.angleDegrees`,
                    "聚光半角必须是 1~90 度的有限数",
                ),
                fieldIssue(isLightPenumbra(candidate.penumbra), `${path}.penumbra`, "边缘软化必须是 0~1 的有限数"),
            ].flat();
    }
}

function fieldIssue(isValid: boolean, path: string, message: string): readonly CommandIssue[] {
    return isValid ? [] : [issue(ISSUE_CODE.PAYLOAD, path, message)];
}

function targetLightIssue(ctx: DirectorContext, id: string): CommandIssue | null {
    const entity = ctx.scene.manager.getEntity(id);
    if (!entity) return issue(ISSUE_CODE.TARGET, "id", `灯光对象 "${id}" 不存在`);
    if (entity.kind !== "light") return issue(ISSUE_CODE.TARGET_KIND, "id", `对象 "${id}" 不是灯光`);
    return null;
}

function snapshot(entity: SceneObject): LightingObjectSnapshot {
    const light = entity.light;
    if (!light) throw new Error("Lighting snapshot requires light entity");
    const { position, rotation, scale } = entity.transform;
    return {
        id: entity.id,
        name: entity.name,
        transform: {
            position: [position[0], position[1], position[2]],
            rotation: [rotation[0], rotation[1], rotation[2]],
            scale: [scale[0], scale[1], scale[2]],
        },
        light: normalizeLightParams(light),
    };
}

/** light.adjust 只替换纯数据值对象；Three 灯由 LightContent 响应实体更新。 */
export class AdjustLightCommand extends DirectorCommand<AdjustLightPayload> {
    static readonly TYPE = "light.adjust";
    readonly type = AdjustLightCommand.TYPE;

    constructor(readonly payload: AdjustLightPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isPayloadRecord(payload)) return [issue(ISSUE_CODE.PAYLOAD, "", "light.adjust 参数格式无效")];
        const issues: CommandIssue[] = [];
        if (typeof payload.id !== "string" || payload.id.length === 0) {
            issues.push(issue(ISSUE_CODE.PAYLOAD, "id", "灯光对象 id 格式无效"));
        } else {
            const targetIssue = targetLightIssue(ctx, payload.id);
            if (targetIssue) issues.push(targetIssue);
        }
        issues.push(...lightPayloadIssues(payload.light, "light"));
        return issues;
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.setLightParams(this.payload.id, normalizeLightParams(this.payload.light));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const light = ctx.scene.manager.getEntity(this.payload.id)?.light;
        return light
            ? [{ type: AdjustLightCommand.TYPE, payload: { id: this.payload.id, light: normalizeLightParams(light) } }]
            : null;
    }
}

/** 场景照明模式只经命令层切换，保留完整撤销语义。 */
export class SetLightingModeCommand extends DirectorCommand<SetLightingModePayload> {
    static readonly TYPE = "scene.set-lighting-mode";
    readonly type = SetLightingModeCommand.TYPE;

    constructor(readonly payload: SetLightingModePayload) {
        super();
    }

    validate(): string[] {
        return this.validateIssues().map((current) => current.message);
    }

    override validateIssues(): readonly CommandIssue[] {
        return isPayloadRecord(this.payload) && isLightingMode(this.payload.mode)
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "mode", "灯光模式必须是 studio 或 custom")];
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.setLightingMode(this.payload.mode);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetLightingModeCommand.TYPE, payload: { mode: ctx.scene.lightingMode } }];
    }
}

export class LightingListQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "lighting.list";
    readonly type = LightingListQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return this.validateIssues().map((current) => current.message);
    }

    validateIssues(): readonly CommandIssue[] {
        return isPayloadRecord(this.payload) &&
            Object.getPrototypeOf(this.payload) === Object.prototype &&
            Object.keys(this.payload).length === 0
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "", "lighting.list payload 必须是空对象")];
    }

    execute(ctx: DirectorContext): readonly LightingObjectSnapshot[] {
        return ctx.scene.manager
            .list()
            .filter((entity) => entity.kind === "light")
            .map(snapshot);
    }
}

export class LightingGetQuery implements DirectorQuery<GetLightPayload> {
    static readonly TYPE = "lighting.get";
    readonly type = LightingGetQuery.TYPE;

    constructor(readonly payload: GetLightPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isPayloadRecord(this.payload) || typeof this.payload.id !== "string" || this.payload.id.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "id", "灯光对象 id 格式无效")];
        }
        const targetIssue = targetLightIssue(ctx, this.payload.id);
        return targetIssue ? [targetIssue] : [];
    }

    execute(ctx: DirectorContext): LightingObjectSnapshot {
        const entity = ctx.scene.manager.getEntity(this.payload.id);
        if (!entity) throw new Error("Lighting get validated target disappeared");
        return snapshot(entity);
    }
}

interface AuthorLightingPayload {
    readonly mood: LightingMood;
    /** 被摄体 id;灯位按其包围球定尺定位。缺省取全场景模型的合并包围球。 */
    readonly subjectId?: string;
}

const AUTHOR_LIGHTING_CONTRACT: PayloadContract = {
    properties: {
        mood: { type: "string", enum: Object.values(LIGHTING_MOOD) },
        subjectId: { type: "string" },
    },
    required: ["mood"],
};

/**
 * 打光情绪编排(聚合命令,地基优先红线 15)。
 *
 * 一条命令完成「切 custom 模式 → 清掉上一组情绪灯 → 放新灯组 → 设曝光 → 设投影」。
 * 拆成多次 dispatch 做不到这件事:撤销会碎成 N 步,中途被拒会留下「灯放了一半、
 * 曝光已改」的孤儿状态;`invert` 因此一次性回滚全部副产物。
 *
 * 只接管**自己产出**的灯(按 id 前缀识别),作者手放的灯不动——
 * 情绪是可反复试的档位,不该吃掉手工布光。
 */
export class AuthorLightingCommand extends DirectorCommand<AuthorLightingPayload> {
    static readonly TYPE = "lighting.author";
    readonly type = AuthorLightingCommand.TYPE;
    private readonly compiler = new LightingMoodCompiler();

    constructor(readonly payload: AuthorLightingPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isPayloadRecord(this.payload) || !isLightingMood(this.payload.mood)) {
            return [
                issue(
                    ISSUE_CODE.PAYLOAD,
                    "mood",
                    `打光情绪必须是 ${Object.values(LIGHTING_MOOD).join(" / ")} 之一`,
                ),
            ];
        }
        const subjectId = this.payload.subjectId;
        if (subjectId === undefined) return [];
        if (typeof subjectId !== "string" || subjectId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "subjectId", "被摄体 id 格式无效")];
        }
        return ctx.scene.manager.getEntity(subjectId)
            ? []
            : [issue(ISSUE_CODE.TARGET, "subjectId", `被摄体 "${subjectId}" 不存在`)];
    }

    execute(ctx: DirectorContext): void {
        const compiled = this.compiledFor(ctx);
        if (!compiled) return;
        // 先撤旧情绪灯:同名 id 直接 place 会撞 SceneManager 的重复 id 断言
        for (const id of moodLightIds(ctx)) ctx.scene.removeObject(id);
        ctx.scene.setLightingMode(LIGHTING_MODE.CUSTOM);
        for (const light of compiled.lights) {
            ctx.scene.addObject({
                id: light.id,
                kind: "light",
                transform: { position: light.position, rotation: [0, 0, 0], scale: [1, 1, 1] },
                light: light.light,
            });
        }
        ctx.studio.setExposure(compiled.exposure);
        ctx.studio.setShadowsEnabled(compiled.shadowsEnabled);
        ctx.playback.sampleCurrent();
    }

    /**
     * 反演回上一状态的完整快照:模式 + 曝光 + 投影 + 全部既有灯。
     * 逐条 place 装回旧灯之前必须先删掉本次产出的灯,否则 id 冲突。
     */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const previousLights = ctx.scene.manager
            .list()
            .filter((entity) => entity.kind === "light")
            .map((entity) => entity.toJSON());
        return [
            ...moodLightIds(ctx).map((id) => ({ type: "object.remove", payload: { id } })),
            ...previousLights.map((light) => ({ type: "object.place", payload: light })),
            { type: SetLightingModeCommand.TYPE, payload: { mode: ctx.scene.lightingMode } },
            { type: "studio.set-exposure", payload: { exposure: ctx.studio.exposure } },
            { type: "studio.set-shadows", payload: { enabled: ctx.studio.shadowsEnabled } },
        ];
    }

    private compiledFor(ctx: DirectorContext) {
        const bounds = this.payload.subjectId
            ? subjectBoundsFor(ctx, this.payload.subjectId)
            : sceneModelBounds(ctx);
        if (!bounds) return null;
        return this.compiler.compile({
            mood: this.payload.mood,
            center: bounds.center,
            radius: bounds.radius,
            idPrefix: MOOD_LIGHT_ID_PREFIX,
        });
    }
}

/**
 * 情绪灯的 id 前缀:命令据此识别「哪些灯归自己管」。
 *
 * 用命名约定而不是另存一份清单,是为了让身份判据随文档往返自动成立——
 * 存一份 id 列表就要同步进 DeskDocument,而它在导入导出、撤销重做里都会与实体表漂移。
 */
const MOOD_LIGHT_ID_PREFIX = "mood-light";

function moodLightIds(ctx: DirectorContext): readonly string[] {
    return ctx.scene.manager
        .list()
        .filter((entity) => entity.kind === "light" && entity.id.startsWith(`${MOOD_LIGHT_ID_PREFIX}-`))
        .map((entity) => entity.id);
}

/** 全场景模型的合并包围球(未指定被摄体时的兜底);没有模型返回 null。 */
function sceneModelBounds(ctx: DirectorContext): { readonly center: Vec3; readonly radius: number } | null {
    const ids = ctx.scene.manager
        .list()
        .filter((entity) => entity.kind === "model")
        .map((entity) => entity.id);
    if (ids.length === 0) return null;
    const bounds = ids.flatMap((id) => {
        const measured = subjectBoundsFor(ctx, id);
        return measured ? [measured] : [];
    });
    if (bounds.length === 0) return null;
    const center: Vec3 = [
        bounds.reduce((sum, b) => sum + b.center[0], 0) / bounds.length,
        bounds.reduce((sum, b) => sum + b.center[1], 0) / bounds.length,
        bounds.reduce((sum, b) => sum + b.center[2], 0) / bounds.length,
    ];
    // 合并半径取「到最远子中心的距离 + 该子半径」,保证包住整组
    const radius = bounds.reduce((max, b) => {
        const distance = Math.hypot(b.center[0] - center[0], b.center[1] - center[1], b.center[2] - center[2]);
        return Math.max(max, distance + b.radius);
    }, 0);
    return { center, radius };
}

function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return {
        type,
        version: LIGHTING_COMMAND_VERSION,
        kind,
        permissions,
        appliesWhen: "director-desk.lighting-v1",
        payload,
    };
}

/** lighting.* 在同一注册表提供写、读与发现元数据；返回值只有可 JSON 化领域数据。 */
export function registerLightingCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AdjustLightCommand.TYPE,
        (payload: AdjustLightPayload) => new AdjustLightCommand(payload),
        capability(AdjustLightCommand.TYPE, "command", [LIGHTING_PERMISSION], ADJUST_LIGHT_CONTRACT),
    );
    dispatcher.register(
        SetLightingModeCommand.TYPE,
        (payload: SetLightingModePayload) => new SetLightingModeCommand(payload),
        capability(SetLightingModeCommand.TYPE, "command", [LIGHTING_PERMISSION], SET_LIGHTING_MODE_CONTRACT),
    );
    dispatcher.register(
        AuthorLightingCommand.TYPE,
        (payload: AuthorLightingPayload) => new AuthorLightingCommand(payload),
        capability(AuthorLightingCommand.TYPE, "command", [LIGHTING_PERMISSION], AUTHOR_LIGHTING_CONTRACT),
    );
    dispatcher.registerQuery(
        LightingListQuery.TYPE,
        (payload: Record<string, never>) => new LightingListQuery(payload),
        capability(LightingListQuery.TYPE, "query", [LIGHTING_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.registerQuery(
        LightingGetQuery.TYPE,
        (payload: GetLightPayload) => new LightingGetQuery(payload),
        capability(LightingGetQuery.TYPE, "query", [LIGHTING_READ_PERMISSION], GET_LIGHT_CONTRACT),
    );
}
