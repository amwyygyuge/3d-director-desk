import { CameraShot } from "../camera/CameraShot";
import { CameraMotionPath } from "../camera/CameraMotionPath";
import { finiteTransform, finiteVec3, SCENE_OBJECT_KINDS } from "../core/SceneObject";
import { mountWhenReady, provisionAction } from "./actionProvisioning";
import { TimelineTrack } from "../timeline/TimelineTrack";
import { assembleDeskDocument, DESK_DOCUMENT_VERSION } from "../document/DeskDocument";
import type { DeskDocument } from "../document/DeskDocument";
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
    readonly document: DeskDocument;
}

function validateShotEntry(entry: unknown): boolean {
    if (typeof entry !== "object" || entry === null || !("shot" in entry)) return false;
    const shot: unknown = entry.shot;
    if (typeof shot !== "object" || shot === null) return false;
    if (!("position" in shot) || !("target" in shot) || !("fov" in shot)) return false;
    return (
        finiteVec3(shot.position) &&
        finiteVec3(shot.target) &&
        typeof shot.fov === "number" &&
        Number.isFinite(shot.fov)
    );
}

/**
 * 导入整桌文档(替换式):清空现有实体/机位/运镜,按文档重建。
 * 动作 clip 是运行时资源——按 URL 异步重取注册后恢复挂载,失败经 applicationNotice 上报。
 * 可撤销:invert 快照导入前的文档。
 */
export class ImportDocumentCommand extends DirectorCommand<ImportDocumentPayload> {
    static readonly TYPE = "desk.import-document";
    readonly type = ImportDocumentCommand.TYPE;

    constructor(readonly payload: ImportDocumentPayload) {
        super();
    }

    validate(): string[] {
        const doc = this.payload.document;
        if (typeof doc !== "object" || doc === null) return ["文档缺失"];
        const issues: string[] = [];
        if (doc.version !== DESK_DOCUMENT_VERSION) issues.push(`文档版本不支持: ${String(doc.version)}`);
        if (!Array.isArray(doc.entities) || !Array.isArray(doc.shots) || !Array.isArray(doc.actions)) {
            issues.push("文档结构无效(entities/shots/actions 必须是数组)");
        }
        if (typeof doc.timeline !== "object" || doc.timeline === null || !Number.isFinite(doc.timeline.duration)) {
            issues.push("文档时间轴无效");
        }
        for (const entity of doc.entities ?? []) {
            if (typeof entity.id !== "string" || entity.id.length === 0 || !SCENE_OBJECT_KINDS.includes(entity.kind)) {
                issues.push(`实体参数无效: ${String(entity.id)}`);
            } else if (!finiteTransform(entity.transform)) {
                issues.push(`实体 "${entity.id}" 的 transform 含非法数值`);
            }
        }
        for (const shot of doc.shots ?? []) {
            if (typeof shot.id !== "string" || !validateShotEntry(shot))
                issues.push(`机位参数无效: ${String(shot.id)}`);
        }
        return issues;
    }

    execute(ctx: DirectorContext): void {
        const doc = this.payload.document;
        for (const entity of [...ctx.scene.manager.list()]) ctx.scene.removeObject(entity.id);
        for (const [id] of ctx.camera.director.listShots()) ctx.camera.removeShot(id);
        ctx.motion.restorePath(null);
        ctx.timeline.setDuration(doc.timeline.duration);
        ctx.timeline.restoreTracks(
            doc.timeline.tracks.map((track) => (track instanceof TimelineTrack ? track : new TimelineTrack(track))),
        );
        for (const init of doc.entities) ctx.scene.addObject(init);
        for (const shot of doc.shots) ctx.camera.addShot(shot.id, new CameraShot(shot.shot));
        ctx.motion.restorePath(doc.motion ? new CameraMotionPath(doc.motion) : null);
        void this.restoreActions(ctx, doc);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly { readonly type: string; readonly payload: unknown }[] {
        return [{ type: ImportDocumentCommand.TYPE, payload: { document: assembleDeskDocument(ctx) } }];
    }

    private async restoreActions(ctx: DirectorContext, doc: DeskDocument): Promise<void> {
        for (const action of doc.actions) {
            try {
                const registered = await provisionAction(ctx, {
                    name: action.name,
                    url: action.url,
                    clipName: action.clipName,
                });
                if (action.mountedOn && !(await mountWhenReady(ctx, action.mountedOn, registered.id))) {
                    ctx.ui.setApplicationNotice(`动作挂载等待运行时超时:${action.mountedOn}`);
                }
            } catch {
                ctx.ui.setApplicationNotice(`动作 "${action.name}" 恢复失败:${action.url}`);
            }
        }
        ctx.playback.sampleCurrent();
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
