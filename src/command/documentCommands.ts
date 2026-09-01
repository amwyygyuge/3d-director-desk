import { assembleDeskDocument } from "../document/DeskDocument";
import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext } from "./DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";

const DOCUMENT_COMMAND_VERSION = "1" as const;
const DOCUMENT_READ_PERMISSION = "document:read";
const DOCUMENT_EDIT_PERMISSION = "document:edit";
const EMPTY_PAYLOAD: Record<string, never> = {};
function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: DOCUMENT_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.document-v1" };
}

/** 导出整桌文档:实体/机位/运镜/时间轴/动作引用,一份 JSON 接管全部状态 */
export class ExportDocumentQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "desk.export-document";
    readonly type = ExportDocumentQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return assembleDeskDocument(ctx);
    }
}

interface ImportDocumentPayload {
    readonly document: unknown;
}

/** 文档导入只编排命令协议；候选构造、原子提交与异步恢复统一由 DocumentImportService 承担。 */
export class ImportDocumentCommand extends DirectorCommand<ImportDocumentPayload> {
    static readonly TYPE = "desk.import-document";
    readonly type = ImportDocumentCommand.TYPE;

    constructor(readonly payload: ImportDocumentPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return [...ctx.documentImports.validate(this.payload.document)];
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
        capability(ImportDocumentCommand.TYPE, "command", [DOCUMENT_EDIT_PERMISSION]),
    );
    dispatcher.registerQuery(
        ExportDocumentQuery.TYPE,
        (payload: Record<string, never>) => new ExportDocumentQuery(payload),
        capability(ExportDocumentQuery.TYPE, "query", [DOCUMENT_READ_PERMISSION]),
    );
}
