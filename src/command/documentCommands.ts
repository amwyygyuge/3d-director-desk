import { FOCUS_TARGET_KIND } from "../camera/CameraFocusTrack";
import { CameraMotionClip } from "../camera/CameraMotionClip";
import { CameraProgramTrack } from "../camera/CameraProgramTrack";
import { CameraShot } from "../camera/CameraShot";
import { finiteTransform, finiteVec3, SCENE_OBJECT_KINDS } from "../core/SceneObject";
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
    return { type, version: DOCUMENT_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.document-v4" };
}

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
    return finiteVec3(shot.position) && finiteVec3(shot.target) && typeof shot.fov === "number" && Number.isFinite(shot.fov);
}

function hasValidMotion(value: unknown): boolean {
    if (typeof value !== "object" || value === null || !("clips" in value) || !("program" in value)) return false;
    const motion = value as { clips: unknown; program: unknown };
    if (!Array.isArray(motion.clips) || typeof motion.program !== "object" || motion.program === null) return false;
    try {
        const clips = motion.clips.map((clip) => new CameraMotionClip(clip as ConstructorParameters<typeof CameraMotionClip>[0]));
        new CameraProgramTrack(motion.program as ConstructorParameters<typeof CameraProgramTrack>[0]);
        return clips.every((clip) => clip.cameraId.length > 0);
    } catch {
        return false;
    }
}

function missingFocusObjectIds(doc: DeskDocument): readonly string[] {
    const entityIds = new Set(doc.entities.map((entity) => entity.id));
    const clips = doc.motion.clips.map((clip) => new CameraMotionClip(clip));
    const focusObjectIds = clips.flatMap((clip) =>
        clip.focus.target.kind === FOCUS_TARGET_KIND.SCENE_OBJECT ? [clip.focus.target.objectId] : [],
    );
    return focusObjectIds.filter((objectId) => !entityIds.has(objectId));
}

function documentIssues(doc: DeskDocument): readonly string[] {
    if (doc.version !== DESK_DOCUMENT_VERSION) return [`文档版本不支持: ${String(doc.version)}`];
    if (!Array.isArray(doc.entities) || !Array.isArray(doc.shots)) return ["文档结构无效(entities/shots 必须是数组)"];
    if (!Number.isFinite(doc.durationSeconds) || doc.durationSeconds <= 0) return ["镜头序列时长无效"];
    if (!hasValidMotion(doc.motion)) return ["文档运镜数据无效"];
    const entityIssues = doc.entities.flatMap((entity) => {
        if (typeof entity.id !== "string" || entity.id.length === 0 || !SCENE_OBJECT_KINDS.includes(entity.kind)) {
            return [`实体参数无效: ${String(entity.id)}`];
        }
        return finiteTransform(entity.transform) ? [] : [`实体 "${entity.id}" 的 transform 含非法数值`];
    });
    const shotIssues = doc.shots.flatMap((shot) =>
        typeof shot.id === "string" && validateShotEntry(shot) ? [] : [`机位参数无效: ${String(shot.id)}`],
    );
    const focusIssues = missingFocusObjectIds(doc).map((objectId) => `运镜注视绑定对象不存在: ${objectId}`);
    return [...entityIssues, ...shotIssues, ...focusIssues];
}

/** Replaces one camera-first desk document; model actions and object transform tracks are intentionally absent. */
export class ImportDocumentCommand extends DirectorCommand<ImportDocumentPayload> {
    static readonly TYPE = "desk.import-document";
    readonly type = ImportDocumentCommand.TYPE;

    constructor(readonly payload: ImportDocumentPayload) {
        super();
    }

    validate(): string[] {
        const document = this.payload.document;
        return typeof document === "object" && document !== null ? [...documentIssues(document)] : ["文档缺失"];
    }

    execute(ctx: DirectorContext): void {
        const document = this.payload.document;
        for (const entity of [...ctx.scene.manager.list()]) ctx.scene.removeObject(entity.id);
        for (const [id] of ctx.camera.director.listShots()) ctx.camera.removeShot(id);
        ctx.timeline.setDuration(document.durationSeconds);
        for (const init of document.entities) ctx.scene.addObject(init);
        for (const shot of document.shots) ctx.camera.addShot(shot.id, new CameraShot(shot.shot));
        ctx.motion.restore(
            document.motion.clips.map((clip) => new CameraMotionClip(clip)),
            new CameraProgramTrack(document.motion.program),
        );
        ctx.playback.sampleCurrent();
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
