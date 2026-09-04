import type { CameraKeyPose } from "@/camera/CameraKey";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import type { DirectorContext } from "@/command/DirectorCommand";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import { subjectBoundsFor } from "@/command/subjectBounds";
import type { SceneObject } from "@/core/SceneObject";
import { ScenePromptSynthesizer } from "@/prompt/ScenePromptSynthesizer";
import type { CompositionInput, PromptSubjectInput } from "@/prompt/ScenePromptSynthesizer";

const PROMPT_COMMAND_VERSION = "1" as const;
const PROMPT_READ_PERMISSION = "scene:read";
const PROMPT_APPLIES_WHEN = "director-desk.scene-v1";
const EMPTY_PAYLOAD: Record<string, never> = {};
const scenePromptSynthesizer = new ScenePromptSynthesizer();

function actionNameFor(ctx: DirectorContext, actionId: string | null): string | null {
    if (!actionId) return null;
    return ctx.animations.actions.find((action) => action.id === actionId)?.name ?? null;
}

/** 被摄体合成输入:世界包围球中心/半径(未就绪回退权威 transform),身体偏航取 rotation.y */
function subjectInputFor(ctx: DirectorContext, entity: SceneObject): PromptSubjectInput {
    const bounds = subjectBoundsFor(ctx, entity.id);
    return {
        id: entity.id,
        name: entity.name,
        isActor: entity.actor !== null,
        actionName: actionNameFor(ctx, entity.actionId),
        position: bounds?.center ?? entity.transform.position,
        yaw: entity.transform.rotation[1],
        radius: bounds?.radius ?? 0,
    };
}

/** 运镜仅在唯一片段时取其关键帧;多片段/无片段 = 运镜归属歧义,返回 null 不臆测 */
function motionKeysFor(ctx: DirectorContext): readonly CameraKeyPose[] | null {
    const clips = ctx.motion.clips;
    if (clips.length !== 1) return null;
    return clips[0]!.keys.map((key) => ({ position: key.position, target: key.target, fov: key.fov }));
}

/** 生效取景:优先激活机位,退回最近导演 pose;皆无则不产景别 facet */
function shotFor(ctx: DirectorContext): CompositionInput["shot"] {
    const pose = ctx.camera.activeShot ?? ctx.camera.lastDirectorPose;
    return pose ? { position: pose.position, target: pose.target } : null;
}

export function compositionInputFor(ctx: DirectorContext): CompositionInput {
    return {
        subjects: ctx.scene.manager
            .list()
            .filter((entity) => entity.kind === "model")
            .map((entity) => subjectInputFor(ctx, entity)),
        shot: shotFor(ctx),
        motionKeys: motionKeysFor(ctx),
        lighting: ctx.scene.lightingMode,
    };
}

/**
 * 布景 prompt 合成查询(AI 交接面地基):把场景/机位/运镜/灯光状态编译为
 * 「结构化 facet + 中文 prompt」,供 i2v 首帧文本与 v2v 参考文本条件使用。
 * 查询只做 store→纯数据装配,一切派生规则在 ScenePromptSynthesizer 领域服务。
 */
export class SynthesizePromptQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "desk.synthesize-prompt";
    readonly type = SynthesizePromptQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return scenePromptSynthesizer.synthesize(compositionInputFor(ctx));
    }
}

function capability(): CommandCapability {
    return {
        type: SynthesizePromptQuery.TYPE,
        version: PROMPT_COMMAND_VERSION,
        kind: "query",
        permissions: [PROMPT_READ_PERMISSION],
        appliesWhen: PROMPT_APPLIES_WHEN,
        payload: EMPTY_PAYLOAD_CONTRACT,
    };
}

export function registerPromptCommands(dispatcher: CommandDispatcher): void {
    dispatcher.registerQuery(
        SynthesizePromptQuery.TYPE,
        (payload: Record<string, never>) => new SynthesizePromptQuery(payload),
        capability(),
    );
}
