import { ActorAppearance, isActorSurface, isColorHex } from "@/actor/ActorAppearance";
import type { ActorSurface } from "@/actor/ActorAppearance";
import { ActorBuild, ACTOR_GIRTH_SCALE, ACTOR_HEIGHT_METERS, ACTOR_SHOULDER_SCALE } from "@/actor/ActorBuild";
import type { ActorBuildInit, ActorBuildRange } from "@/actor/ActorBuild";
import { ACTOR_PALETTE } from "@/actor/ActorPalette";
import { BUILD_PRESETS, compileBuildPreset } from "@/actor/BuildPresetCompiler";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { SceneObject } from "@/core/SceneObject";

const ACTOR_VERSION = "1" as const;
const EDIT_PERMISSION = "actor:edit";
const READ_PERMISSION = "actor:read";

interface ObjectPayload {
    readonly objectId: string;
}

interface SetAppearancePayload extends ObjectPayload {
    readonly baseColorHex?: string;
    readonly surface?: ActorSurface;
}

interface SetBuildPayload extends ObjectPayload {
    readonly build: ActorBuildInit;
}

interface ApplyBuildPresetPayload extends ObjectPayload {
    readonly presetId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: string, path: string, message: string, options?: CommandIssue["options"]): CommandIssue {
    return options ? { code, path, message, options } : { code, path, message };
}

function messages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

/** 人偶身份判定的唯一口径:实体自带画像,不再按 sourceUrl 反查资源目录。 */
function actorEntity(ctx: DirectorContext, objectId: unknown): SceneObject | CommandIssue {
    if (typeof objectId !== "string" || objectId.length === 0) {
        return issue("invalid-object-id", "objectId", "objectId 必须是非空字符串");
    }
    const entity = ctx.scene.manager.getEntity(objectId);
    if (!entity) return issue("object-not-found", "objectId", `对象 "${objectId}" 不存在`);
    if (!entity.actor) {
        return issue("not-an-actor", "objectId", `对象 "${objectId}" 不是人偶,没有外观与体型`, [
            { type: "list-assets", label: "从资源库放置人偶" },
        ]);
    }
    return entity;
}

function isIssue(value: SceneObject | CommandIssue): value is CommandIssue {
    return !(value instanceof SceneObject);
}

function editingIssue(ctx: DirectorContext): CommandIssue | null {
    return ctx.clock.isPlaying
        ? issue("transport-playing", "", "播放期间禁止编辑体型", [{ type: "pause-transport", label: "先暂停播放" }])
        : null;
}

function rangeIssue(value: unknown, range: ActorBuildRange, path: string, label: string): CommandIssue | null {
    if (value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return issue("invalid-number", path, `${label}必须是有限数值`);
    }
    return value < range.min || value > range.max
        ? issue("out-of-range", path, `${label}超出可用范围 ${range.min}~${range.max}`)
        : null;
}

function buildIssues(build: unknown): readonly CommandIssue[] {
    if (!isRecord(build)) return [issue("invalid-build", "build", "体型参数无效")];
    return [
        rangeIssue(build.heightMeters, ACTOR_HEIGHT_METERS, "build.heightMeters", "身高(米)"),
        rangeIssue(build.girthScale, ACTOR_GIRTH_SCALE, "build.girthScale", "围度"),
        rangeIssue(build.shoulderScale, ACTOR_SHOULDER_SCALE, "build.shoulderScale", "肩宽"),
    ].filter((current): current is CommandIssue => current !== null);
}

function appearanceInvert(entity: SceneObject): readonly SerializedCommand[] {
    const appearance = entity.actor?.appearance;
    return appearance
        ? [{ type: SetActorAppearanceCommand.TYPE, payload: { objectId: entity.id, ...appearance.toJSON() } }]
        : [];
}

/** 体型改变会牵动落尺与贴地,撤销必须连同变换一起回滚,否则人偶会留在错误的高度上。 */
function buildInvert(entity: SceneObject): readonly SerializedCommand[] {
    const build = entity.actor?.build;
    return build
        ? [
              { type: SetActorBuildCommand.TYPE, payload: { objectId: entity.id, build: build.toJSON() } },
              { type: "object.move", payload: { id: entity.id, transform: entity.transform } },
          ]
        : [];
}

/** 落地顺序固定:画像入实体 → 运行时重写骨骼与落尺 → 贴地 → 重采样,四步缺一姿势与地面就会脱钩。 */
function commitBuild(ctx: DirectorContext, entity: SceneObject, build: ActorBuild): void {
    const actor = entity.actor;
    if (!actor) return;
    ctx.scene.setObjectActor(entity.id, actor.withBuild(build));
    ctx.actorRuntime.shape(entity.id, build);
    const grounded = ctx.poseGrounding.alignObjectToGround(entity.id);
    if (grounded) ctx.scene.updateTransform(entity.id, grounded);
    ctx.playback.sampleCurrent();
}

/** 外观写入:颜色与质感各自可选,未给的字段保持原值(部分更新,不需要客户端回读全量)。 */
export class SetActorAppearanceCommand extends DirectorCommand<SetAppearancePayload> {
    static readonly TYPE = "actor.appearance.set";
    readonly type = SetActorAppearanceCommand.TYPE;

    constructor(readonly payload: SetAppearancePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("invalid-payload", "", "外观参数无效")];
        const target = actorEntity(ctx, this.payload.objectId);
        if (isIssue(target)) return [target];
        const color = this.payload.baseColorHex;
        if (color !== undefined && !isColorHex(color)) {
            return [issue("invalid-color", "baseColorHex", "颜色必须是 #RRGGBB 形式")];
        }
        const surface = this.payload.surface;
        return surface !== undefined && !isActorSurface(surface)
            ? [issue("invalid-surface", "surface", "质感只能是 matte 或 sheen")]
            : [];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const actor = entity?.actor;
        if (!entity || !actor) return;
        const appearance = new ActorAppearance({
            baseColorHex: this.payload.baseColorHex ?? actor.appearance.baseColorHex,
            surface: this.payload.surface ?? actor.appearance.surface,
        });
        ctx.scene.setObjectActor(entity.id, actor.withAppearance(appearance));
        ctx.actorRuntime.paint(entity.id, appearance);
        ctx.playback.requestRender();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? appearanceInvert(entity) : null;
    }
}

export class SetActorBuildCommand extends DirectorCommand<SetBuildPayload> {
    static readonly TYPE = "actor.build.set";
    readonly type = SetActorBuildCommand.TYPE;

    constructor(readonly payload: SetBuildPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const playing = editingIssue(ctx);
        if (playing) return [playing];
        if (!isRecord(this.payload)) return [issue("invalid-payload", "", "体型参数无效")];
        const target = actorEntity(ctx, this.payload.objectId);
        if (isIssue(target)) return [target];
        return buildIssues(this.payload.build);
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        commitBuild(ctx, entity, new ActorBuild(this.payload.build));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? buildInvert(entity) : null;
    }
}

/** 语义入口:LLM 与预设 chip 给名字,数值由编译器产出,越界仍由值对象与围栏兜底。 */
export class ApplyBuildPresetCommand extends DirectorCommand<ApplyBuildPresetPayload> {
    static readonly TYPE = "actor.build.apply-preset";
    readonly type = ApplyBuildPresetCommand.TYPE;

    constructor(readonly payload: ApplyBuildPresetPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const playing = editingIssue(ctx);
        if (playing) return [playing];
        if (!isRecord(this.payload)) return [issue("invalid-payload", "", "体型预设参数无效")];
        const target = actorEntity(ctx, this.payload.objectId);
        if (isIssue(target)) return [target];
        return compileBuildPreset(this.payload.presetId)
            ? []
            : [
                  issue("build-preset-not-found", "presetId", `体型预设 "${this.payload.presetId}" 不存在`, [
                      { type: "list-actor-presets", label: "先查询 actor.presets.list" },
                  ]),
              ];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const build = compileBuildPreset(this.payload.presetId);
        if (!entity || !build) return;
        commitBuild(ctx, entity, build);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? buildInvert(entity) : null;
    }
}

export class GetActorQuery implements DirectorQuery<ObjectPayload> {
    static readonly TYPE = "actor.get";
    readonly type = GetActorQuery.TYPE;

    constructor(readonly payload: ObjectPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        const target = actorEntity(ctx, this.payload?.objectId);
        return isIssue(target) ? [target.message] : [];
    }

    execute(ctx: DirectorContext): unknown {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return { objectId: this.payload.objectId, actor: entity?.actor?.toJSON() ?? null };
    }
}

/** AI 发现面:色板与体型预设的词表与 UI 标签同源,用户看到什么就能说什么。 */
export class ActorPresetsQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "actor.presets.list";
    readonly type = ActorPresetsQuery.TYPE;

    constructor(readonly payload: Record<string, never>) {}

    validate(): readonly string[] {
        return [];
    }

    execute(): unknown {
        return {
            palette: ACTOR_PALETTE.map((swatch) => ({ id: swatch.id, labelZh: swatch.labelZh, hex: swatch.hex })),
            builds: BUILD_PRESETS.map((preset) => ({ id: preset.id, labelZh: preset.labelZh })),
            ranges: {
                heightMeters: ACTOR_HEIGHT_METERS,
                girthScale: ACTOR_GIRTH_SCALE,
                shoulderScale: ACTOR_SHOULDER_SCALE,
            },
        };
    }
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: ACTOR_VERSION, kind, permissions, appliesWhen: "director-desk.actor-v1" };
}

export function registerActorCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        SetActorAppearanceCommand.TYPE,
        (payload: SetAppearancePayload) => new SetActorAppearanceCommand(payload),
        capability(SetActorAppearanceCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        SetActorBuildCommand.TYPE,
        (payload: SetBuildPayload) => new SetActorBuildCommand(payload),
        capability(SetActorBuildCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        ApplyBuildPresetCommand.TYPE,
        (payload: ApplyBuildPresetPayload) => new ApplyBuildPresetCommand(payload),
        capability(ApplyBuildPresetCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.registerQuery(
        GetActorQuery.TYPE,
        (payload: ObjectPayload) => new GetActorQuery(payload),
        capability(GetActorQuery.TYPE, "query", [READ_PERMISSION]),
    );
    dispatcher.registerQuery(
        ActorPresetsQuery.TYPE,
        (payload: Record<string, never>) => new ActorPresetsQuery(payload),
        capability(ActorPresetsQuery.TYPE, "query", [READ_PERMISSION]),
    );
}
