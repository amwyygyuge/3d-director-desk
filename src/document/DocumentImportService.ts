import { runInAction } from "mobx";

import { CameraMotionClip } from "@/camera/CameraMotionClip";
import { CameraProgramTrack, PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { CameraShot } from "@/camera/CameraShot";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import { mountWhenReady, provisionAction } from "@/command/actionProvisioning";
import { SceneObject, SCENE_OBJECT_KINDS, finiteTransform, finiteVec3 } from "@/core/SceneObject";
import type { DeskDocument, DeskDocumentAction, DeskDocumentLighting } from "@/document/DeskDocument";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import { isActionLoopMode } from "@/assets/ActionAsset";
import { MINIMUM_ACTION_DURATION_SECONDS } from "@/animation/ActionPerformance";
import { parsePosePreset } from "@/pose/PosePreset";
import type { PosePreset } from "@/pose/PosePreset";
import { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import { isActorProfileInit } from "@/actor/ActorProfile";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import { isLightingMode } from "@/store/SceneStore";
const SCENE_OBJECT_KIND_VALUES: readonly string[] = SCENE_OBJECT_KINDS;

interface DocumentImportPlan {
    readonly entities: readonly SceneObject[];
    readonly shots: readonly { readonly id: string; readonly shot: CameraShot }[];
    readonly timeline: TimelineDoc;
    readonly motionClips: readonly CameraMotionClip[];
    readonly program: CameraProgramTrack;
    readonly actions: readonly DeskDocumentAction[];
    readonly posePresets: readonly PosePreset[];
    readonly lighting: DeskDocumentLighting;
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

export const DOCUMENT_IMPORT_ISSUE_CODE = {
    INVALID: "document-invalid",
    UNSUPPORTED_VERSION: "document-version-unsupported",
} as const;
const DOCUMENT_IMPORT_PATH = {
    DOCUMENT: "document",
    VERSION: "version",
} as const;

function validationIssuesFor(document: unknown, issues: readonly string[]): readonly CommandIssue[] {
    const isUnsupportedVersion = isRecord(document) && document.version !== DESK_DOCUMENT_VERSION;
    return issues.map((message) =>
        isUnsupportedVersion
            ? { code: DOCUMENT_IMPORT_ISSUE_CODE.UNSUPPORTED_VERSION, path: DOCUMENT_IMPORT_PATH.VERSION, message }
            : { code: DOCUMENT_IMPORT_ISSUE_CODE.INVALID, path: DOCUMENT_IMPORT_PATH.DOCUMENT, message },
    );
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
    if (value.actor !== undefined && value.actor !== null && !isActorProfileInit(value.actor)) {
        return [`实体 "${value.id}" 的人偶画像无效`];
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
    if (!isActionLoopMode(value.loopMode)) return [`动作 "${value.name}" 的 loopMode 无效`];
    if (
        !Number.isFinite(value.trimStartSeconds) ||
        !Number.isFinite(value.trimEndSeconds) ||
        (value.trimStartSeconds as number) < 0 ||
        (value.trimEndSeconds as number) < 0
    ) {
        return [`动作 "${value.name}" 的裁剪窗口无效`];
    }
    if (!Array.isArray(value.mountedOn)) return [`动作 "${value.name}" 的挂载列表无效`];
    const mounts = value.mountedOn;
    const missing = mounts.filter(
        (mount: unknown) => !isRecord(mount) || typeof mount.objectId !== "string" || !entityIds.has(mount.objectId),
    );
    const invalidSchedule = mounts.filter(
        (mount: unknown) =>
            !isRecord(mount) ||
            !Number.isFinite(mount.startTimeSeconds) ||
            !Number.isFinite(mount.durationSeconds) ||
            !Number.isFinite(mount.attackSeconds) ||
            !Number.isFinite(mount.releaseSeconds) ||
            (mount.startTimeSeconds as number) < 0 ||
            (mount.attackSeconds as number) < 0 ||
            (mount.releaseSeconds as number) < 0 ||
            (mount.durationSeconds as number) < MINIMUM_ACTION_DURATION_SECONDS,
    );
    if (missing.length > 0) return [`动作 "${value.name}" 的挂载对象不存在`];
    if (invalidSchedule.length > 0) return [`动作 "${value.name}" 的排期无效`];
    return value.url.length > 0 ? [] : [`动作 "${value.name}" 的 url 无效`];
}

function actionScheduleIssues(plan: DocumentImportPlan): readonly string[] {
    return plan.actions.flatMap((action) =>
        action.mountedOn
            .filter((mount) => mount.startTimeSeconds + mount.durationSeconds > plan.timeline.duration)
            .map((mount) => `动作 "${action.name}" 在实体 "${mount.objectId}" 上的排期超出时间轴时长`),
    );
}

function lightingIssues(value: unknown): readonly string[] {
    return isRecord(value) && isLightingMode(value.mode) ? [] : ["灯光模式无效"];
}

function posePresetIssues(value: unknown): readonly string[] {
    const preset = parsePosePreset(value);
    return preset?.custom ? [] : ["自建姿势预设参数无效"];
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
    const shotIds = new Set(plan.shots.map(({ id }) => id));
    const entityIds = new Set(plan.entities.map((entity) => entity.id));
    const clipIds = new Set<string>();
    const clipsById = new Map<string, CameraMotionClip>();
    const clipIssues = plan.motionClips.flatMap((clip) => {
        const isDuplicate = clipIds.has(clip.id);
        clipIds.add(clip.id);
        clipsById.set(clip.id, clip);
        const focusTarget = clip.focus?.target;
        const focusObjectId = focusTarget?.kind === FOCUS_TARGET_KIND.SCENE_OBJECT ? focusTarget.objectId : null;
        const followObjectId = clip.follow?.objectId ?? null;
        return [
            ...(isDuplicate ? [`运镜片段 id 重复: ${clip.id}`] : []),
            ...(focusObjectId !== null && !entityIds.has(focusObjectId)
                ? [`运镜注视绑定对象不存在: ${focusObjectId}`]
                : []),
            ...(followObjectId !== null && !entityIds.has(followObjectId)
                ? [`运镜跟拍主体不存在: ${followObjectId}`]
                : []),
            ...(clip.endTimeSeconds > plan.timeline.duration ? [`运镜片段 "${clip.id}" 超出时间轴时长`] : []),
        ];
    });
    const programIssues = plan.program.clips.flatMap((clip) => {
        const sourceIssue =
            clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT
                ? !shotIds.has(clip.source.shotId)
                    ? [`Program 片段 "${clip.id}" 引用不存在的机位`]
                    : []
                : (() => {
                      const motion = clipsById.get(clip.source.motionClipId);
                      const isAligned =
                          motion !== undefined &&
                          motion.startTimeSeconds === clip.startTimeSeconds &&
                          motion.durationSeconds === clip.durationSeconds;
                      return isAligned ? [] : [`Program 片段 "${clip.id}" 引用不存在或未对齐的运镜`];
                  })();
        return [
            ...sourceIssue,
            ...(clip.endTimeSeconds > plan.timeline.duration ? [`Program 片段 "${clip.id}" 超出时间轴时长`] : []),
        ];
    });
    return [...clipIssues, ...programIssues];
}

function preparePlan(document: unknown): DocumentImportPreparation {
    if (!isRecord(document)) return { issues: ["文档缺失"], plan: null };
    if (document.version !== DESK_DOCUMENT_VERSION) {
        return { issues: [`文档版本不支持: ${String(document.version)}`], plan: null };
    }
    if (
        !Array.isArray(document.entities) ||
        !Array.isArray(document.shots) ||
        !Array.isArray(document.actions) ||
        !Array.isArray(document.posePresets)
    ) {
        return { issues: ["文档结构无效(entities/shots/actions/posePresets 必须是数组)"], plan: null };
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
        ...document.posePresets.flatMap(posePresetIssues),
        ...duplicateFieldIssues(document.posePresets, "id", "姿势预设 id"),
        ...lightingIssues(document.lighting),
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
            posePresets: typed.posePresets.flatMap((value) => {
                const preset = parsePosePreset(value);
                return preset?.custom ? [preset] : [];
            }),
            lighting: typed.lighting,
        };
        const relationalIssues = [
            ...timelineIssues(plan.timeline, entityIdSet),
            ...motionIssues(plan),
            ...actionScheduleIssues(plan),
        ];
        return relationalIssues.length > 0 ? { issues: relationalIssues, plan: null } : { issues: [], plan };
    } catch {
        return { issues: ["文档包含无法恢复的领域数据"], plan: null };
    }
}

/** 工程快照替换应用服务：候选聚合先完整构造，提交后只保留新工程的运行时与读模型。 */
export class DocumentImportService {
    private restoreController: AbortController | null = null;
    private disposed = false;

    validate(document: unknown): readonly CommandIssue[] {
        const preparation = preparePlan(document);
        return validationIssuesFor(document, preparation.issues);
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
            ctx.posePresets.replaceCustom(plan.posePresets);
            ctx.clock.pause();
            ctx.actionPreview.reset();
            ctx.binder.clear();
            ctx.animations.clear();
            ctx.selection.clear();
            // 留任模型的骨架未更换,索引与其 bind 基线必须保留;整表清空会把当前姿势烙成 rest
            ctx.skeletons.retainOnly(plan.entities.map((entity) => entity.id));
            ctx.ui.setPosePicking(null, null);
            ctx.scene.setLightingMode(plan.lighting.mode);
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
                const targetObjectId = action.mountedOn[0]?.objectId;
                const registered = await provisionAction(ctx, action, {
                    signal,
                    ...(targetObjectId ? { targetObjectId } : {}),
                });
                if (signal.aborted) return;
                await this.mountOnEntities({ ctx, action, actionId: registered.id, signal });
            } catch {
                if (!signal.aborted) ctx.ui.setApplicationNotice(`动作 "${action.name}" 恢复失败:${action.url}`);
            }
        }
        if (!signal.aborted) ctx.playback.sampleCurrent();
    }

    /** 同一动作依次挂回全部实体;单个超时只通知,不阻断后续实体与动作 */
    private async mountOnEntities({
        ctx,
        action,
        actionId,
        signal,
    }: {
        readonly ctx: DirectorContext;
        readonly action: DeskDocumentAction;
        readonly actionId: string;
        readonly signal: AbortSignal;
    }): Promise<void> {
        for (const mount of action.mountedOn) {
            if (signal.aborted) return;
            const isMounted = await mountWhenReady(ctx, mount.objectId, actionId, {
                signal,
                startTimeSeconds: mount.startTimeSeconds,
                durationSeconds: mount.durationSeconds,
                attackSeconds: mount.attackSeconds,
                releaseSeconds: mount.releaseSeconds,
            });
            if (!isMounted && !signal.aborted) ctx.ui.setApplicationNotice(`动作挂载等待运行时超时:${mount.objectId}`);
        }
    }
}
