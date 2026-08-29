import type { LightParams } from "../core/LightParams";
import {
    isLightColor,
    isLightIntensity,
    isLightType,
    normalizeLightParams,
} from "../core/LightParams";
import type { SceneObject } from "../core/SceneObject";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";

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

export interface LightingObjectSnapshot {
    readonly id: string;
    readonly name: string;
    readonly transform: SceneObject["transform"];
    readonly light: LightParams;
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lightPayloadIssues(value: unknown, path: string): readonly CommandIssue[] {
    if (!isRecord(value)) return [issue(ISSUE_CODE.PAYLOAD, path, "灯光参数格式无效")];
    const issues: CommandIssue[] = [];
    if (!isLightType(value.type)) issues.push(issue(ISSUE_CODE.PAYLOAD, `${path}.type`, "灯光类型必须是 directional、point 或 spot"));
    if (!isLightColor(value.color)) issues.push(issue(ISSUE_CODE.PAYLOAD, `${path}.color`, "灯光颜色必须是 #rrggbb"));
    if (!isLightIntensity(value.intensity)) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, `${path}.intensity`, "灯光强度必须是 0~100 的有限数"));
    }
    return issues;
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
        if (!isRecord(payload)) return [issue(ISSUE_CODE.PAYLOAD, "", "light.adjust 参数格式无效")];
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

export class LightingListQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "lighting.list";
    readonly type = LightingListQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return this.validateIssues().map((current) => current.message);
    }

    validateIssues(): readonly CommandIssue[] {
        return isRecord(this.payload) &&
            Object.getPrototypeOf(this.payload) === Object.prototype &&
            Object.keys(this.payload).length === 0
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "", "lighting.list payload 必须是空对象")];
    }

    execute(ctx: DirectorContext): readonly LightingObjectSnapshot[] {
        return ctx.scene.manager.list().filter((entity) => entity.kind === "light").map(snapshot);
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
        if (!isRecord(this.payload) || typeof this.payload.id !== "string" || this.payload.id.length === 0) {
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

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: LIGHTING_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.lighting-v1" };
}

/** lighting.* 在同一注册表提供写、读与发现元数据；返回值只有可 JSON 化领域数据。 */
export function registerLightingCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AdjustLightCommand.TYPE,
        (payload: AdjustLightPayload) => new AdjustLightCommand(payload),
        capability(AdjustLightCommand.TYPE, "command", [LIGHTING_PERMISSION]),
    );
    dispatcher.registerQuery(
        LightingListQuery.TYPE,
        (payload: Record<string, never>) => new LightingListQuery(payload),
        capability(LightingListQuery.TYPE, "query", [LIGHTING_READ_PERMISSION]),
    );
    dispatcher.registerQuery(
        LightingGetQuery.TYPE,
        (payload: GetLightPayload) => new LightingGetQuery(payload),
        capability(LightingGetQuery.TYPE, "query", [LIGHTING_READ_PERMISSION]),
    );
}
