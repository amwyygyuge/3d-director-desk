import { makeAutoObservable, runInAction } from "mobx";

import { CameraMotionClip } from "@/camera/CameraMotionClip";
import { CameraProgramTrack, PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { CameraShot } from "@/camera/CameraShot";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import { mountWhenReady, provisionAction } from "@/command/actionProvisioning";
import { SceneObject, SCENE_OBJECT_KINDS, finiteTransform, finiteVec3 } from "@/core/SceneObject";
import { isSceneNarrativeIdentityInit, isSceneSpatialScaleInit } from "@/core/SceneSemantics";
import type {
    DeskDocument,
    DeskDocumentAction,
    DeskDocumentLighting,
    DeskDocumentOutput,
} from "@/document/DeskDocument";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import type { DocumentCompatibilityService } from "@/document/compatibility/DocumentCompatibilityService";
import { isActionLoopMode } from "@/assets/ActionAsset";
import { formatFromUrl, MODEL_FORMAT } from "@/assets/ModelAsset";
import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import { MINIMUM_ACTION_DURATION_SECONDS } from "@/animation/ActionPerformance";
import { parsePosePreset } from "@/pose/PosePreset";
import type { PosePreset } from "@/pose/PosePreset";
import { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import { isActorProfileInit } from "@/actor/ActorProfile";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import { isLightingMode } from "@/store/SceneStore";
import { isOutputFormatId } from "@/output/OutputFormat";
import { isStudioEnvironmentJSON } from "@/studio/StudioEnvironment";
import type { StudioEnvironmentJSON } from "@/studio/StudioEnvironment";
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
    readonly output: DeskDocumentOutput;
    readonly studio: StudioEnvironmentJSON;
}

interface DocumentImportPreparation {
    readonly issues: readonly string[];
    readonly plan: DocumentImportPlan | null;
}

/** 文档里的一条动作排期(挂载阶段按目标实体重新分组,故单独取别名)。 */
type MountRequest = DeskDocumentAction["mountedOn"][number];

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
    if (value.narrativeIdentity !== null && !isSceneNarrativeIdentityInit(value.narrativeIdentity)) {
        return [`实体 "${value.id}" 的叙事身份无效`];
    }
    if (!isSceneSpatialScaleInit(value.spatialScale)) return [`实体 "${value.id}" 的量纲模式无效`];
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
    // 段 id 是 v17 的硬要求:缺了它导入后段身份不可还原(段条、选中态、binder clip 全指不到)
    const missingId = mounts.filter(
        (mount: unknown) => !isRecord(mount) || typeof mount.id !== "string" || mount.id.length === 0,
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
    if (missingId.length > 0) return [`动作 "${value.name}" 的排期缺少段 id`];
    if (invalidSchedule.length > 0) return [`动作 "${value.name}" 的排期无效`];
    return value.url.length > 0 ? [] : [`动作 "${value.name}" 的 url 无效`];
}

function actionScheduleIssues(plan: DocumentImportPlan): readonly string[] {
    return plan.actions.flatMap((action) =>
        action.mountedOn
            .filter((mount) => {
                const releaseSeconds = action.loopMode === ACTION_LOOP_MODE.ONCE ? mount.releaseSeconds : 0;
                return mount.startTimeSeconds + mount.durationSeconds + releaseSeconds > plan.timeline.duration;
            })
            .map((mount) => `动作 "${action.name}" 在实体 "${mount.objectId}" 上的排期或回收超出时间轴时长`),
    );
}

function actionMountIssues(plan: DocumentImportPlan): readonly string[] {
    const entitiesById = new Map(plan.entities.map((entity) => [entity.id, entity]));
    const seenPerformanceIds = new Set<string>();
    return plan.actions.flatMap((action) => {
        const isFbxAction = formatFromUrl(action.url) === MODEL_FORMAT.FBX;
        const targets = action.mountedOn.map((mount) => entitiesById.get(mount.objectId));
        const targetSignatures = new Set(
            targets.flatMap((entity) => (entity?.kind === "model" ? [`${entity.sourceUrl}:${entity.format}`] : [])),
        );
        const issues = [
            ...(isFbxAction && action.mountedOn.length === 0 ? [`FBX 动作 "${action.name}" 必须至少挂载一个模型`] : []),
            ...(isFbxAction && targetSignatures.size > 1
                ? [`FBX 动作 "${action.name}" 不能同时挂到不同骨架来源的模型`]
                : []),
        ];
        const mountIssues = action.mountedOn.flatMap((mount) => {
            const entity = entitiesById.get(mount.objectId);
            // v17:段 id 全局唯一,重复判定按它——同实体同起点是合法的(两段不同动作首尾相接)
            const duplicate = seenPerformanceIds.has(mount.id);
            seenPerformanceIds.add(mount.id);
            return [
                ...(entity?.kind !== "model" ? [`动作 "${action.name}" 的挂载对象不是模型: ${mount.objectId}`] : []),
                ...(duplicate ? [`动作排期段 id 重复: ${mount.id}`] : []),
            ];
        });
        return [...issues, ...mountIssues];
    });
}

function lightingIssues(value: unknown): readonly string[] {
    return isRecord(value) && isLightingMode(value.mode) ? [] : ["灯光模式无效"];
}

function outputIssues(value: unknown): readonly string[] {
    return isRecord(value) && isOutputFormatId(value.formatId) ? [] : ["输出画幅无效"];
}

function studioIssues(value: unknown): readonly string[] {
    return isStudioEnvironmentJSON(value) ? [] : ["演播室档位无效(地板尺寸/渲染画质/读数显隐)"];
}

function posePresetIssues(value: unknown): readonly string[] {
    const preset = parsePosePreset(value);
    return preset?.custom ? [] : ["自建姿势预设参数无效"];
}

function timelineIssues(timeline: TimelineDoc, entityIds: ReadonlySet<string>): readonly string[] {
    const trackIds = new Set<string>();
    const targetKinds = new Set<string>();
    return timeline.tracks.flatMap((track) => trackIssues(track, timeline.duration, entityIds, trackIds, targetKinds));
}

function trackIssues(
    track: TimelineTrack,
    durationSeconds: number,
    entityIds: ReadonlySet<string>,
    trackIds: Set<string>,
    targetKinds: Set<string>,
): readonly string[] {
    if (!entityIds.has(track.targetId)) return [`时间轴轨道 "${track.id}" 引用不存在的对象: ${track.targetId}`];
    // 查重键带 kind:同一实体可以同时持有不同种类的轨道(走位 + 未来的动作轨),
    // 只按 targetId 判重会让第二种轨道一进文档就打不开
    const targetKey = `${track.targetId}:${track.kind}`;
    if (trackIds.has(track.id) || targetKinds.has(targetKey)) return [`时间轴轨道 id 或目标重复: ${track.id}`];
    trackIds.add(track.id);
    targetKinds.add(targetKey);
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

/** 只接受已经升级到当前版本的文档；历史版本的宽松结构只存在于对应迁移器内。 */
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
    if (
        !isRecord(document.motion) ||
        !Array.isArray(document.motion.clips) ||
        !isRecord(document.motion.program) ||
        !isRecord(document.output)
    ) {
        return { issues: ["文档运镜或输出数据无效"], plan: null };
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
        ...outputIssues(document.output),
        ...studioIssues(document.studio),
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
            output: typed.output,
            studio: typed.studio,
        };
        const relationalIssues = [
            ...timelineIssues(plan.timeline, entityIdSet),
            ...motionIssues(plan),
            ...actionScheduleIssues(plan),
            ...actionMountIssues(plan),
        ];
        return relationalIssues.length > 0 ? { issues: relationalIssues, plan: null } : { issues: [], plan };
    } catch {
        return { issues: ["文档包含无法恢复的领域数据"], plan: null };
    }
}

/**
 * 内容标识未变的留任实体 id。
 *
 * 与渲染层的模型内容签名同口径:`[id, sourceUrl, format]`(见 contents.tsx 的 requestKey)。
 * 三元组一致才说明该 id 的 Three 内容不会被重新装载,其装载结局仍然成立;
 * 任一项变化都要按「新装载」对待,旧结局必须作废。
 */
function retainedContentIds(entities: readonly SceneObject[], ctx: DirectorContext): readonly string[] {
    return entities
        .filter((entity) => {
            const current = ctx.scene.manager.getEntity(entity.id);
            return (
                current !== undefined &&
                current.kind === entity.kind &&
                current.sourceUrl === entity.sourceUrl &&
                current.format === entity.format
            );
        })
        .map((entity) => entity.id);
}

/**
 * 工程快照替换应用服务：候选聚合先完整构造，提交后只保留新工程的运行时与读模型。
 *
 * 版本兼容不属于本服务：历史文档先由 DocumentCompatibilityService 单向升级到当前版本，
 * 本服务只认识当前 schema——否则版本分支会扩散进 SceneObject / TimelineDoc / CameraMotionClip。
 */
export class DocumentImportService {
    private restoreController: AbortController | null = null;
    private disposed = false;
    /**
     * 动作恢复是否在途。
     *
     * 动作置备与挂载不在 `commit()` 的原子事务里(见 restoreActions),所以 `commit()` 返回后
     * 有一段窗口:实体已就位,但动作库仍是空的。此窗口内装配文档会产出「实体齐全、动作全无」
     * 的残档——结构合法、能通过校验、能再导入,只是动作永久丢失。导出查询与宿主自动存档
     * 必须据此设闸,而不是各自去猜恢复进度。
     */
    private restoring = false;

    constructor(private readonly compatibility: DocumentCompatibilityService) {
        makeAutoObservable<DocumentImportService, "compatibility" | "restoreController">(this, {
            compatibility: false,
            restoreController: false,
        });
    }

    /** 恢复在途期间文档不完整:导出与持久化必须先读这里。 */
    get isRestoring(): boolean {
        return this.restoring;
    }

    validate(document: unknown): readonly CommandIssue[] {
        const upgraded = this.compatibility.prepare(document);
        if (!upgraded.ok) return upgraded.issues;
        const preparation = preparePlan(upgraded.document);
        return validationIssuesFor(upgraded.document, preparation.issues);
    }

    import(document: unknown, ctx: DirectorContext): void {
        const upgraded = this.compatibility.prepare(document);
        if (!upgraded.ok) throw new Error(upgraded.issues.map((issue) => issue.message).join(";"));
        const preparation = preparePlan(upgraded.document);
        if (!preparation.plan) throw new Error(preparation.issues.join(";"));
        if (this.disposed) throw new Error("DocumentImportService 已释放");
        this.restoreController?.abort();
        const restoreController = new AbortController();
        this.restoreController = restoreController;
        // 闸门必须在 commit 之前落下:commit 会清空动作库并触发 MobX 反应,
        // 晚一步就会有一次「动作全无」的快照逃出去。
        runInAction(() => {
            this.restoring = true;
        });
        this.commit(preparation.plan, ctx);
        // 旧工程只在内存中升级；宿主保存的原文件保持不动，作为回滚锚点。
        if (upgraded.report.appliedSteps.length > 0) {
            ctx.ui.setApplicationNotice(
                `工程已从 v${upgraded.report.sourceVersion} 升级到 v${upgraded.report.targetVersion}，保存后写入新版本`,
            );
        }
        void this.restoreActions({ ctx, actions: preparation.plan.actions, signal: restoreController.signal });
    }

    dispose(): void {
        this.disposed = true;
        this.restoreController?.abort();
        this.restoreController = null;
        runInAction(() => {
            this.restoring = false;
        });
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
            // 装载结局同口径收束,但判据比「id 留任」更严:必须**内容标识**未变。
            // 渲染层按 [id, sourceUrl, format] 钉住模型内容(见 contents.tsx 的 requestKey),
            // 其中任一项变化即重新装载,旧结局当场作废。而结局撤回发生在 React 提交时,
            // 动作恢复的首次就绪探测可能早于那一刻——只按 id 保留就会读到上一份 "loaded",
            // 对着空壳 root 预检得到匹配率 0%,被 validate 当成 bone-incompatible 拒下。
            ctx.ui.retainModelOutcomes(retainedContentIds(plan.entities, ctx));
            ctx.ui.setPosePicking(null, null);
            ctx.scene.setLightingMode(plan.lighting.mode);
            ctx.scene.replaceObjects(plan.entities);
            ctx.output.setFormat(plan.output.formatId);
            ctx.studio.restore(plan.studio);
            ctx.camera.replaceShots(plan.shots);
            ctx.timeline.replaceDocument(plan.timeline);
            ctx.motion.restore(plan.motionClips, plan.program);
        });
        ctx.playback.sampleCurrent();
    }

    /**
     * 置备并行、同实体挂载串行。
     *
     * 置备(取 clip + FBX 重定向)彼此独立,且每个 FBX 都要各自等目标骨架就绪(上限 10s);串行时
     * 这份等待预算逐个累加——导入后模型正在重新加载,前几个动作就把预算烧光,余下的全部判恢复失败。
     * ModelImporter 按 URL 合并 inflight 请求,并行置备不会重复解析同一资产。
     *
     * 挂载按目标实体分组:组间并行(不同实体的排期互不可见),组内保持文档顺序串行——
     * MountActionCommand 的重叠围栏要读同一实体的现有排期,同实体并发会让校验读到未定的中间态。
     * 全局串行则让每个 mountWhenReady 的 10s 预算按挂载总数累加,大场景必然拖满。
     */
    private async restoreActions({ ctx, actions, signal }: ActionRestoreRequest): Promise<void> {
        try {
            const provisioned = await Promise.all(
                actions.map(async (action) => {
                    try {
                        const targetObjectId = action.mountedOn[0]?.objectId;
                        const registered = await provisionAction(ctx, action, {
                            signal,
                            ...(targetObjectId ? { targetObjectId } : {}),
                        });
                        return { action, actionId: registered.id };
                    } catch {
                        if (!signal.aborted) {
                            ctx.ui.setApplicationNotice(`动作 "${action.name}" 恢复失败:${action.url}`);
                        }
                        return { action, actionId: null };
                    }
                }),
            );
            if (signal.aborted) return;
            const queuesByObject = new Map<string, { readonly actionId: string; readonly mount: MountRequest }[]>();
            for (const { action, actionId } of provisioned) {
                if (actionId === null) continue;
                for (const mount of action.mountedOn) {
                    const queue = queuesByObject.get(mount.objectId) ?? [];
                    queue.push({ actionId, mount });
                    queuesByObject.set(mount.objectId, queue);
                }
            }
            await Promise.all([...queuesByObject.values()].map((queue) => this.mountQueue({ ctx, queue, signal })));
            if (!signal.aborted) ctx.playback.sampleCurrent();
        } finally {
            // 只有仍属自己的恢复才落闸:被新导入取代时新一轮已把 restoring 置为 true。
            if (!signal.aborted) {
                runInAction(() => {
                    this.restoring = false;
                });
            }
        }
    }

    /** 单实体的挂载队列:保持文档顺序,单个超时只通知,不阻断同队列后续。 */
    private async mountQueue({
        ctx,
        queue,
        signal,
    }: {
        readonly ctx: DirectorContext;
        readonly queue: readonly { readonly actionId: string; readonly mount: MountRequest }[];
        readonly signal: AbortSignal;
    }): Promise<void> {
        for (const { actionId, mount } of queue) {
            if (signal.aborted) return;
            const outcome = await mountWhenReady(ctx, mount.objectId, actionId, {
                signal,
                performanceId: mount.id,
                startTimeSeconds: mount.startTimeSeconds,
                durationSeconds: mount.durationSeconds,
                attackSeconds: mount.attackSeconds,
                releaseSeconds: mount.releaseSeconds,
                ...(mount.alignment ? { alignToTrack: mount.alignment } : {}),
            });
            if (!outcome.ok && !signal.aborted) {
                ctx.ui.setApplicationNotice(
                    outcome.reason === "rejected"
                        ? `动作恢复被拒:${mount.objectId} — ${outcome.issues.join(";")}`
                        : `动作挂载等待运行时超时:${mount.objectId}`,
                );
            }
        }
    }
}
