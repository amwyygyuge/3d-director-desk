import { assembleDeskDocument } from "@/document/DeskDocument";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";

const DOCUMENT_COMMAND_VERSION = "1" as const;
const DOCUMENT_READ_PERMISSION = "document:read";
const DOCUMENT_EDIT_PERMISSION = "document:edit";
const EMPTY_PAYLOAD: Record<string, never> = {};
function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return {
        type,
        version: DOCUMENT_COMMAND_VERSION,
        kind,
        permissions,
        appliesWhen: "director-desk.document-v1",
        payload,
    };
}

/** 导出整桌文档:实体/机位/运镜/时间轴/动作引用,一份 JSON 接管全部状态 */
export class ExportDocumentQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "desk.export-document";
    readonly type = ExportDocumentQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    /**
     * 恢复在途期间拒绝导出。动作置备与挂载不在导入的原子提交里,此时动作库仍是空的,
     * 装配出的文档「实体齐全、动作全无」——结构合法、能通过校验、能再导入,动作却永久丢失。
     */
    validate(ctx: DirectorContext): readonly string[] {
        return ctx.documentImports.isRestoring ? ["动作正在恢复,请等恢复完成后再导出工程"] : [];
    }

    execute(ctx: DirectorContext): unknown {
        return assembleDeskDocument(ctx);
    }
}

interface ImportDocumentPayload {
    readonly document: unknown;
}

const IMPORT_DOCUMENT_CONTRACT: PayloadContract = {
    properties: { document: { type: "object" } },
    required: ["document"],
};

/** 文档导入只编排命令协议；候选构造、原子提交与异步恢复统一由 DocumentImportService 承担。 */
export class ImportDocumentCommand extends DirectorCommand<ImportDocumentPayload> {
    static readonly TYPE = "desk.import-document";
    readonly type = ImportDocumentCommand.TYPE;

    constructor(readonly payload: ImportDocumentPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    /**
     * 前一次恢复在途时拒绝再次导入。`invert` 在 `execute` 之前装配当前状态作为撤销锚点,
     * 而恢复未完成时动作库仍是空的——此刻撤销点会被记成「动作全无」的残档,
     * 撤销回去就再也拿不回动作。
     */
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (ctx.documentImports.isRestoring) {
            return [
                {
                    code: "document-restore-in-flight",
                    path: "document",
                    message: "上一份工程的动作仍在恢复,请等恢复完成后再导入",
                },
            ];
        }
        return ctx.documentImports.validate(this.payload.document);
    }

    execute(ctx: DirectorContext): void {
        ctx.documentImports.import(this.payload.document, ctx);
    }

    override invert(ctx: DirectorContext): readonly { readonly type: string; readonly payload: unknown }[] {
        return [{ type: ImportDocumentCommand.TYPE, payload: { document: assembleDeskDocument(ctx) } }];
    }
}

export function registerDocumentCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        ImportDocumentCommand.TYPE,
        (payload: ImportDocumentPayload) => new ImportDocumentCommand(payload),
        capability(ImportDocumentCommand.TYPE, "command", [DOCUMENT_EDIT_PERMISSION], IMPORT_DOCUMENT_CONTRACT),
    );
    dispatcher.registerQuery(
        ExportDocumentQuery.TYPE,
        (payload: Record<string, never>) => new ExportDocumentQuery(payload),
        capability(ExportDocumentQuery.TYPE, "query", [DOCUMENT_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
}
