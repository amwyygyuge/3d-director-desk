import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import type { DirectorContext } from "@/command/DirectorCommand";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import { ProgramReviewService } from "@/review/ProgramReviewService";

const PROGRAM_REVIEW_COMMAND_VERSION = "1" as const;
const PROGRAM_REVIEW_PERMISSION = "program:read";
const PROGRAM_REVIEW_APPLIES_WHEN = "director-desk.program-v1";
const EMPTY_PAYLOAD: Record<string, never> = {};
const programReviewService = new ProgramReviewService();

function capability(): CommandCapability {
    return {
        type: ProgramReviewQuery.TYPE,
        version: PROGRAM_REVIEW_COMMAND_VERSION,
        kind: "query",
        permissions: [PROGRAM_REVIEW_PERMISSION],
        appliesWhen: PROGRAM_REVIEW_APPLIES_WHEN,
        payload: EMPTY_PAYLOAD_CONTRACT,
    };
}

/** 成片巡检查询：镜头单与问题列表同源，供左栏、宿主和 AI 使用。 */
export class ProgramReviewQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "program.review";
    readonly type = ProgramReviewQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return programReviewService.review({ camera: ctx.camera, motion: ctx.motion, timeline: ctx.timeline });
    }
}

export function registerReviewCommands(dispatcher: CommandDispatcher): void {
    dispatcher.registerQuery(
        ProgramReviewQuery.TYPE,
        (payload: Record<string, never>) => new ProgramReviewQuery(payload),
        capability(),
    );
}
