import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { nullable } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { SceneNarrativeIdentity, SCENE_NARRATIVE_ROLE, isSceneNarrativeIdentityInit } from "@/core/SceneSemantics";
import type { SceneNarrativeIdentityInit } from "@/core/SceneSemantics";

const SCENE_IDENTITY_COMMAND_VERSION = "1" as const;
const SCENE_EDIT_PERMISSION = "scene:edit";
const SCENE_APPLIES_WHEN = "director-desk.scene-v1";

interface SetSceneIdentityPayload {
    readonly id: string;
    readonly identity: SceneNarrativeIdentityInit | null;
}

const SET_SCENE_IDENTITY_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        identity: nullable({
            type: "object",
            properties: {
                role: { type: "string", enum: Object.values(SCENE_NARRATIVE_ROLE) },
                label: { type: "string" },
            },
            required: ["role", "label"],
        }),
    },
    required: ["id", "identity"],
};

function identityIssues(ctx: DirectorContext, payload: SetSceneIdentityPayload): readonly CommandIssue[] {
    const entity = typeof payload.id === "string" ? ctx.scene.manager.getEntity(payload.id) : undefined;
    return [
        ...(typeof payload.id === "string" && payload.id.length > 0
            ? []
            : [{ code: "scene-identity-invalid-id", path: "id", message: "对象 id 格式无效" }]),
        ...(entity ? [] : [{ code: "scene-identity-not-found", path: "id", message: `对象 "${payload.id}" 不存在` }]),
        ...(payload.identity === null || isSceneNarrativeIdentityInit(payload.identity)
            ? []
            : [{ code: "scene-identity-invalid", path: "identity", message: "叙事身份必须包含有效角色和标签" }]),
    ];
}

/** 聚合命令：写入或清除实体的稳定叙事身份，供 AI 和 UI 共用。 */
export class SetSceneIdentityCommand extends DirectorCommand<SetSceneIdentityPayload> {
    static readonly TYPE = "scene.set-identity";
    readonly type = SetSceneIdentityCommand.TYPE;

    constructor(readonly payload: SetSceneIdentityPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return [...this.validateIssues(ctx).map((issue) => issue.message)];
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return identityIssues(ctx, this.payload);
    }

    execute(ctx: DirectorContext): void {
        if (this.payload.identity !== null && !isSceneNarrativeIdentityInit(this.payload.identity)) return;
        const identity = this.payload.identity === null ? null : new SceneNarrativeIdentity(this.payload.identity);
        ctx.scene.setObjectNarrativeIdentity(this.payload.id, identity);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const identity = ctx.scene.manager.getEntity(this.payload.id)?.narrativeIdentity;
        return identity
            ? [{ type: SetSceneIdentityCommand.TYPE, payload: { id: this.payload.id, identity: identity.toJSON() } }]
            : [{ type: SetSceneIdentityCommand.TYPE, payload: { id: this.payload.id, identity: null } }];
    }
}

export function registerSceneIdentityCommands(dispatcher: CommandDispatcher): void {
    const capability: CommandCapability = {
        type: SetSceneIdentityCommand.TYPE,
        version: SCENE_IDENTITY_COMMAND_VERSION,
        kind: "command",
        permissions: [SCENE_EDIT_PERMISSION],
        appliesWhen: SCENE_APPLIES_WHEN,
        payload: SET_SCENE_IDENTITY_CONTRACT,
    };
    dispatcher.register(
        SetSceneIdentityCommand.TYPE,
        (payload: SetSceneIdentityPayload) => new SetSceneIdentityCommand(payload),
        capability,
    );
}
