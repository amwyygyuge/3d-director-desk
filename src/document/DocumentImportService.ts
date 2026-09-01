import { runInAction } from "mobx";

import { provisionAction, mountWhenReady } from "@/command/actionProvisioning";
import type { DirectorContext } from "@/command/DirectorCommand";
import { CameraMotionClip } from "@/camera/CameraMotionClip";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import { CameraProgramTrack } from "@/camera/CameraProgramTrack";
import { CameraShot } from "@/camera/CameraShot";
import { finiteTransform, finiteVec3, SceneObject, SCENE_OBJECT_KINDS } from "@/core/SceneObject";
import { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import type { DeskDocument, DeskDocumentAction } from "@/document/DeskDocument";
const SCENE_OBJECT_KIND_VALUES: readonly string[] = SCENE_OBJECT_KINDS;

interface DocumentImportPlan {
    readonly entities: readonly SceneObject[];
    readonly shots: readonly { readonly id: string; readonly shot: CameraShot }[];
    readonly timeline: TimelineDoc;
    readonly motionClips: readonly CameraMotionClip[];
    readonly program: CameraProgramTrack;
    readonly actions: readonly DeskDocumentAction[];
}

interface DocumentImportPreparation {
    readonly issues: readonly string[];
    readonly plan: DocumentImportPlan | null;
}

interface ActionRestoreRequest {
    readonly ctx: DirectorContext;
    readonly actions: readonly DeskDocumentAction[];
    readonly signal: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTimelineDocument(
    value: unknown,
): value is { readonly duration: number; readonly tracks: readonly unknown[] } {
    return (
        isRecord(value) &&
        Array.isArray(value.tracks) &&
        typeof value.duration === "number" &&
        Number.isFinite(value.duration) &&
        value.duration > 0
    );
}

function duplicateFieldIssues(values: readonly unknown[], field: string, label: string): readonly string[] {
    const seen = new Set<string>();
    return values.flatMap((value) => {
        const identifier = isRecord(value) && typeof value[field] === "string" ? value[field] : null;
        if (identifier === null || !seen.has(identifier)) {
            if (identifier !== null) seen.add(identifier);
            return [];
        }
        return [`${label} 重复: ${identifier}`];
    });
}

function entityIssues(value: unknown): readonly string[] {
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return ["实体 id 无效"];
    if (typeof value.kind !== "string" || !SCENE_OBJECT_KIND_VALUES.includes(value.kind)) {
        return [`实体 "${value.id}" 类型无效`];
    }
    return finiteTransform(value.transform) ? [] : [`实体 "${value.id}" 的 transform 含非法数值`];
}

function shotIssues(value: unknown): readonly string[] {
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || !isRecord(value.shot)) {
        return ["机位参数无效"];
    }
    const { position, target, fov } = value.shot;
    return finiteVec3(position) && finiteVec3(target) && typeof fov === "number" && Number.isFinite(fov)
        ? []
        : [`机位 "${value.id}" 参数无效`];
}

function actionIssues(value: unknown, entityIds: ReadonlySet<string>): readonly string[] {
    if (
        !isRecord(value) ||
        typeof value.name !== "string" ||
        value.name.length === 0 ||
        typeof value.url !== "string"
    ) {
        return ["动作资产参数无效"];
    }
    if (typeof value.clipName !== "string") return [`动作 "${value.name}" 的 clipName 无效`];
    if (value.mountedOn !== null && (typeof value.mountedOn !== "string" || !entityIds.has(value.mountedOn))) {
        return [`动作 "${value.name}" 的挂载对象不存在`];
    }
    return value.url.length > 0 ? [] : [`动作 "${value.name}" 的 url 无效`];
}

function timelineIssues(timeline: TimelineDoc, entityIds: ReadonlySet<string>): readonly string[] {
    const trackIds = new Set<string>();
    const targetIds = new Set<string>();
    return timeline.tracks.flatMap((track) => trackIssues(track, timeline.duration, entityIds, trackIds, targetIds));
}

function trackIssues(
    track: TimelineTrack,
    durationSeconds: number,
    entityIds: ReadonlySet<string>,
    trackIds: Set<string>,
    targetIds: Set<string>,
): readonly string[] {
    if (!entityIds.has(track.targetId)) return [`时间轴轨道 "${track.id}" 引用不存在的对象: ${track.targetId}`];
    if (trackIds.has(track.id) || targetIds.has(track.targetId)) return [`时间轴轨道 id 或目标重复: ${track.id}`];
    trackIds.add(track.id);
    targetIds.add(track.targetId);
    const keyIds = new Set<string>();
    const keyTimes = new Set<number>();
    return track.keyframes.flatMap((keyframe) => {
        const isValid =
            typeof keyframe.id === "string" &&
            keyframe.id.length > 0 &&
            Number.isFinite(keyframe.time) &&
            keyframe.time >= 0 &&
            keyframe.time <= durationSeconds &&
            finiteTransform(keyframe.value) &&
            (keyframe.easing === "linear" || keyframe.easing === "smooth");
        if (!isValid) return [`轨道 "${track.id}" 的关键帧参数无效`];
        if (keyIds.has(keyframe.id) || keyTimes.has(keyframe.time))
            return [`轨道 "${track.id}" 的关键帧 id 或时间重复`];
        keyIds.add(keyframe.id);
        keyTimes.add(keyframe.time);
        return [];
    });
}

function motionIssues(plan: DocumentImportPlan): readonly string[] {
    const cameraIds = new Set(plan.shots.map(({ id }) => id));
    const entityIds = new Set(plan.entities.map((entity) => entity.id));
    const clipIds = new Set<string>();
    const clipsByCamera = new Map<string, CameraMotionClip[]>();
    const clipIssues = plan.motionClips.flatMap((clip) => {
        const isDuplicate = clipIds.has(clip.id);
        clipIds.add(clip.id);
        const cameraClips = clipsByCamera.get(clip.cameraId) ?? [];
        clipsByCamera.set(clip.cameraId, [...cameraClips, clip]);
        const focusTarget = clip.focus?.target;
        const focusObjectId = focusTarget?.kind === FOCUS_TARGET_KIND.SCENE_OBJECT ? focusTarget.objectId : null;
        const issues = [
            ...(isDuplicate ? [`运镜片段 id 重复: ${clip.id}`] : []),
            ...(!cameraIds.has(clip.cameraId) ? [`运镜片段 "${clip.id}" 引用不存在的机位`] : []),
            ...(focusObjectId !== null && !entityIds.has(focusObjectId)
                ? [`运镜注视绑定对象不存在: ${focusObjectId}`]
                : []),
            ...(clip.endTimeSeconds > plan.timeline.duration ? [`运镜片段 "${clip.id}" 超出时间轴时长`] : []),
        ];
        return issues;
    });
    const overlapIssues = [...clipsByCamera.values()].flatMap((clips) => {
        const ordered = [...clips].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
        const hasOverlap = ordered.some((clip, index) => {
            const next = ordered[index + 1];
            return next ? clip.endTimeSeconds > next.startTimeSeconds : false;
        });
        return hasOverlap ? [`同一机位的运镜片段不能重叠: ${ordered[0]?.cameraId ?? ""}`] : [];
    });
    const programIssues = plan.program.clips.flatMap((clip) => [
        ...(!cameraIds.has(clip.cameraId) ? [`Program 片段 "${clip.id}" 引用不存在的机位`] : []),
        ...(clip.endTimeSeconds > plan.timeline.duration ? [`Program 片段 "${clip.id}" 超出时间轴时长`] : []),
    ]);
    return [...clipIssues, ...overlapIssues, ...programIssues];
}

function preparePlan(document: unknown): DocumentImportPreparation {
    if (!isRecord(document)) return { issues: ["文档缺失"], plan: null };
    if (document.version !== DESK_DOCUMENT_VERSION) {
        return { issues: [`文档版本不支持: ${String(document.version)}`], plan: null };
    }
    if (!Array.isArray(document.entities) || !Array.isArray(document.shots) || !Array.isArray(document.actions)) {
        return { issues: ["文档结构无效(entities/shots/actions 必须是数组)"], plan: null };
    }
    if (!isTimelineDocument(document.timeline)) {
        return { issues: ["文档时间轴无效"], plan: null };
    }
    if (!isRecord(document.motion) || !Array.isArray(document.motion.clips) || !isRecord(document.motion.program)) {
        return { issues: ["文档运镜数据无效"], plan: null };
    }
    const entityIdSet = new Set(
        document.entities.flatMap((entity) => (isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [])),
    );
    const basicIssues = [
        ...document.entities.flatMap(entityIssues),
        ...duplicateFieldIssues(document.entities, "id", "实体 id"),
        ...document.shots.flatMap(shotIssues),
        ...duplicateFieldIssues(document.shots, "id", "机位 id"),
        ...document.actions.flatMap((action) => actionIssues(action, entityIdSet)),
        ...duplicateFieldIssues(document.actions, "name", "动作名称"),
    ];
    if (basicIssues.length > 0) return { issues: basicIssues, plan: null };
    try {
        const typed = document as unknown as DeskDocument;
        const plan: DocumentImportPlan = {
            entities: typed.entities.map((entity) => new SceneObject(entity)),
            shots: typed.shots.map(({ id, shot }) => ({ id, shot: new CameraShot(shot) })),
            timeline: new TimelineDoc(typed.timeline),
            motionClips: typed.motion.clips.map((clip) => new CameraMotionClip(clip)),
            program: new CameraProgramTrack(typed.motion.program),
            actions: typed.actions,
        };
        const relationalIssues = [...timelineIssues(plan.timeline, entityIdSet), ...motionIssues(plan)];
        return relationalIssues.length > 0 ? { issues: relationalIssues, plan: null } : { issues: [], plan };
    } catch {
        return { issues: ["文档包含无法恢复的领域数据"], plan: null };
    }
}

/** 工程快照替换应用服务：候选聚合先完整构造，提交后只保留新工程的运行时与读模型。 */
export class DocumentImportService {
    private restoreController: AbortController | null = null;
    private disposed = false;

    validate(document: unknown): readonly string[] {
        return preparePlan(document).issues;
    }

    import(document: unknown, ctx: DirectorContext): void {
        const preparation = preparePlan(document);
        if (!preparation.plan) throw new Error(preparation.issues.join(";"));
        if (this.disposed) throw new Error("DocumentImportService 已释放");
        this.restoreController?.abort();
        const restoreController = new AbortController();
        this.restoreController = restoreController;
        this.commit(preparation.plan, ctx);
        void this.restoreActions({ ctx, actions: preparation.plan.actions, signal: restoreController.signal });
    }

    dispose(): void {
        this.disposed = true;
        this.restoreController?.abort();
        this.restoreController = null;
    }

    private commit(plan: DocumentImportPlan, ctx: DirectorContext): void {
        runInAction(() => {
            ctx.clock.pause();
            ctx.actionPreview.reset();
            ctx.binder.clear();
            ctx.animations.clear();
            ctx.selection.clear();
            ctx.skeletons.clear();
            ctx.ui.setPosePicking(null, null);
            ctx.scene.replaceObjects(plan.entities);
            ctx.camera.replaceShots(plan.shots);
            ctx.timeline.replaceDocument(plan.timeline);
            ctx.motion.restore(plan.motionClips, plan.program);
        });
        ctx.playback.sampleCurrent();
    }

    private async restoreActions({ ctx, actions, signal }: ActionRestoreRequest): Promise<void> {
        for (const action of actions) {
            if (signal.aborted) return;
            try {
                const registered = await provisionAction(ctx, action, { signal });
                if (signal.aborted) return;
                const isMounted =
                    action.mountedOn === null ||
                    (await mountWhenReady(ctx, action.mountedOn, registered.id, { signal }));
                if (!isMounted && !signal.aborted)
                    ctx.ui.setApplicationNotice(`动作挂载等待运行时超时:${action.mountedOn}`);
            } catch {
                if (!signal.aborted) ctx.ui.setApplicationNotice(`动作 "${action.name}" 恢复失败:${action.url}`);
            }
        }
        if (!signal.aborted) ctx.playback.sampleCurrent();
    }
}
