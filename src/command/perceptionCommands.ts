import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import type { PayloadContract } from "@/command/PayloadContract";
import { DESK_PERCEPTION_DETAIL, DirectorDeskPerceptionService } from "@/perception/DirectorDeskPerceptionService";
import type { DeskPerceptionDetail, DeskPerceptionRequest } from "@/perception/DirectorDeskPerceptionService";

const DESK_PERCEPTION_COMMAND_VERSION = "1" as const;
const DESK_READ_PERMISSION = "scene:read";
const DESK_PERCEPTION_APPLIES_WHEN = "director-desk.perception-v1";

interface InspectDeskPayload extends DeskPerceptionRequest {
    readonly entityIds?: readonly string[];
}

const INSPECT_DESK_CONTRACT: PayloadContract = {
    properties: {
        detail: { type: "string", enum: Object.values(DESK_PERCEPTION_DETAIL) },
        entityIds: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["detail"],
};

function isPerceptionDetail(value: unknown): value is DeskPerceptionDetail {
    return typeof value === "string" && Object.values(DESK_PERCEPTION_DETAIL).includes(value as DeskPerceptionDetail);
}

function inspectionIssues(ctx: DirectorContext, payload: InspectDeskPayload): readonly CommandIssue[] {
    const hasEntityIds = Array.isArray(payload.entityIds) && payload.entityIds.every((id) => typeof id === "string");
    const hasFocusedTarget = payload.detail !== DESK_PERCEPTION_DETAIL.FOCUSED || hasEntityIds;
    const missingEntityIds = hasEntityIds ? payload.entityIds.filter((id) => !ctx.scene.manager.getEntity(id)) : [];
    return [
        ...(isPerceptionDetail(payload.detail)
            ? []
            : [{ code: "desk-perception-invalid-detail", path: "detail", message: "感知档位无效" }]),
        ...(hasFocusedTarget
            ? []
            : [{ code: "desk-perception-missing-entities", path: "entityIds", message: "focused 档位必须指定对象" }]),
        ...missingEntityIds.map((id) => ({
            code: "desk-perception-entity-not-found",
            path: "entityIds",
            message: `对象 "${id}" 不存在`,
        })),
    ];
}

/** 结构化导演台感知查询：度量读数据，截图只留给不可数值化的美学判断。 */
export class InspectDeskQuery implements DirectorQuery<InspectDeskPayload> {
    static readonly TYPE = "desk.inspect";
    readonly type = InspectDeskQuery.TYPE;
    private readonly perception = new DirectorDeskPerceptionService();

    constructor(readonly payload: InspectDeskPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return inspectionIssues(ctx, this.payload);
    }

    execute(ctx: DirectorContext): unknown {
        return this.perception.inspect(ctx, this.payload);
    }
}

export function registerPerceptionCommands(dispatcher: CommandDispatcher): void {
    const capability: CommandCapability = {
        type: InspectDeskQuery.TYPE,
        version: DESK_PERCEPTION_COMMAND_VERSION,
        kind: "query",
        permissions: [DESK_READ_PERMISSION],
        appliesWhen: DESK_PERCEPTION_APPLIES_WHEN,
        payload: INSPECT_DESK_CONTRACT,
    };
    dispatcher.registerQuery(
        InspectDeskQuery.TYPE,
        (payload: InspectDeskPayload) => new InspectDeskQuery(payload),
        capability,
    );
}
