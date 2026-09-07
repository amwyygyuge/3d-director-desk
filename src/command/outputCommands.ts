import { OUTPUT_FORMAT, isOutputFormatId } from "@/output/OutputFormat";
import type { OutputFormatId } from "@/output/OutputFormat";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";

const OUTPUT_VERSION = "1" as const;
const OUTPUT_APPLIES_WHEN = "director-desk.output-v1";
const OUTPUT_EDIT_PERMISSION = "output:edit";
const OUTPUT_READ_PERMISSION = "output:read";

interface SetOutputFormatPayload {
    readonly formatId: OutputFormatId;
}

const SET_OUTPUT_FORMAT_CONTRACT: PayloadContract = {
    properties: { formatId: { type: "string", enum: Object.values(OUTPUT_FORMAT) } },
    required: ["formatId"],
};

function outputCapability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return { type, version: OUTPUT_VERSION, kind, permissions, appliesWhen: OUTPUT_APPLIES_WHEN, payload };
}

/** 切换项目最终输出画幅；撤销恢复先前的项目级格式，不接触机位值对象。 */
export class SetOutputFormatCommand extends DirectorCommand<SetOutputFormatPayload> {
    static readonly TYPE = "output.set-format";
    readonly type = SetOutputFormatCommand.TYPE;

    constructor(readonly payload: SetOutputFormatPayload) {
        super();
    }

    validate(): string[] {
        return isOutputFormatId(this.payload.formatId) ? [] : ["未知的输出画幅比例"];
    }

    execute(ctx: DirectorContext): void {
        ctx.output.setFormat(this.payload.formatId);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetOutputFormatCommand.TYPE, payload: { formatId: ctx.output.formatId } }];
    }
}

/** 输出格式读模型：AI/宿主可发现当前成片比例，但不接触 canvas 或 Three 引用。 */
export class OutputGetFormatQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "output.get-format";
    readonly type = OutputGetFormatQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return { formatId: ctx.output.formatId };
    }
}

export function registerOutputCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        SetOutputFormatCommand.TYPE,
        (payload: SetOutputFormatPayload) => new SetOutputFormatCommand(payload),
        outputCapability(SetOutputFormatCommand.TYPE, "command", [OUTPUT_EDIT_PERMISSION], SET_OUTPUT_FORMAT_CONTRACT),
    );
    dispatcher.registerQuery(
        OutputGetFormatQuery.TYPE,
        (payload: Record<string, never>) => new OutputGetFormatQuery(payload),
        outputCapability(OutputGetFormatQuery.TYPE, "query", [OUTPUT_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
}
