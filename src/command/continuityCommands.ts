import { ContinuityChecker } from "../camera/ContinuityChecker";
import type { ContinuityCheckRequest, ContinuityIssue, ContinuityShot } from "../camera/ContinuityChecker";
import type { CommandDispatcher, DirectorQuery } from "./CommandDispatcher";
import type { CommandIssue, DirectorContext } from "./DirectorCommand";

const CONTINUITY_VERSION = "1" as const;
const CONTINUITY_READ_PERMISSION = "continuity:read";
const EMPTY_PAYLOAD: Record<string, never> = {};

const ISSUE_CODE = {
    PAYLOAD: "continuity.invalid-payload",
    SUBJECT: "continuity.subject-not-found",
    SHOT: "continuity.shot-not-found",
    DUPLICATE_SHOT: "continuity.duplicate-shot",
    SAMPLE_TIME: "continuity.invalid-sample-time",
    SAMPLE_RANGE: "continuity.sample-time-outside-duration",
    THRESHOLD: "continuity.invalid-threshold",
} as const;

export interface ContinuityCheckPayload {
    readonly subjectId: string;
    readonly shotIds: readonly string[];
    readonly sampleTimes: readonly number[];
    readonly teleportThreshold: number;
}

export interface ContinuitySelectionOption {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
}

export interface ContinuitySelectionOptions {
    readonly subjects: readonly ContinuitySelectionOption[];
    readonly shots: readonly { readonly id: string }[];
    readonly duration: number;
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyPayloadIssues(payload: unknown, type: string): readonly CommandIssue[] {
    if (
        isRecord(payload) &&
        Object.getPrototypeOf(payload) === Object.prototype &&
        Object.keys(payload).length === 0
    ) {
        return [];
    }
    return [issue(ISSUE_CODE.PAYLOAD, "", `${type} payload 必须是空对象`)];
}

function continuityPayloadIssues(payload: unknown, ctx: DirectorContext): readonly CommandIssue[] {
    if (!isRecord(payload)) return [issue(ISSUE_CODE.PAYLOAD, "", "continuity.check 参数格式无效")];
    const issues: CommandIssue[] = [];
    if (typeof payload.subjectId !== "string" || payload.subjectId.length === 0) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, "subjectId", "主体 id 必须是非空字符串"));
    } else if (!ctx.scene.manager.getEntity(payload.subjectId)) {
        issues.push(issue(ISSUE_CODE.SUBJECT, "subjectId", `主体对象 "${payload.subjectId}" 不存在`));
    }
    if (!Array.isArray(payload.shotIds) || payload.shotIds.length < 2) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, "shotIds", "必须按顺序指定至少两个机位 id"));
    } else {
        const seen = new Set<string>();
        payload.shotIds.forEach((shotId, index) => {
            if (typeof shotId !== "string" || shotId.length === 0) {
                issues.push(issue(ISSUE_CODE.PAYLOAD, `shotIds.${index}`, "机位 id 必须是非空字符串"));
            } else if (seen.has(shotId)) {
                issues.push(issue(ISSUE_CODE.DUPLICATE_SHOT, `shotIds.${index}`, `机位 "${shotId}" 不能重复`));
            } else if (!ctx.camera.director.getShot(shotId)) {
                issues.push(issue(ISSUE_CODE.SHOT, `shotIds.${index}`, `机位 "${shotId}" 不存在`));
            }
            seen.add(shotId);
        });
    }
    if (!Array.isArray(payload.sampleTimes) || !Array.isArray(payload.shotIds) || payload.sampleTimes.length !== payload.shotIds.length) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, "sampleTimes", "采样时间必须与机位顺序一一对应"));
    } else {
        payload.sampleTimes.forEach((time, index) => {
            if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
                issues.push(issue(ISSUE_CODE.SAMPLE_TIME, `sampleTimes.${index}`, "采样时间必须是非负有限秒数"));
            } else if (time > ctx.timeline.document.duration) {
                issues.push(issue(ISSUE_CODE.SAMPLE_RANGE, `sampleTimes.${index}`, "采样时间不能超过时间轴时长"));
            }
        });
    }
    if (
        typeof payload.teleportThreshold !== "number" ||
        !Number.isFinite(payload.teleportThreshold) ||
        payload.teleportThreshold < 0
    ) {
        issues.push(issue(ISSUE_CODE.THRESHOLD, "teleportThreshold", "突变阈值必须是非负有限数"));
    }
    return issues;
}

function selectionOptions(ctx: DirectorContext): ContinuitySelectionOptions {
    return {
        subjects: ctx.scene.manager.list().map((entity) => ({ id: entity.id, name: entity.name, kind: entity.kind })),
        shots: ctx.camera.director.listShots().map(([id]) => ({ id })),
        duration: ctx.timeline.document.duration,
    };
}

/** Query-only capability for manual subject/shot/time authoring controls. */
export class ContinuitySelectionOptionsQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "continuity.selection-options";
    readonly type = ContinuitySelectionOptionsQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return this.validateIssues().map((current) => current.message);
    }

    validateIssues(): readonly CommandIssue[] {
        return emptyPayloadIssues(this.payload, ContinuitySelectionOptionsQuery.TYPE);
    }

    execute(ctx: DirectorContext): ContinuitySelectionOptions {
        return selectionOptions(ctx);
    }
}

/**
 * Query-only continuity inspection. It cannot mutate scene data, history, grouping, or runtime
 * objects; callers may present its serializable issue list in a transient diagnostics store.
 */
export class ContinuityCheckQuery implements DirectorQuery<ContinuityCheckPayload> {
    static readonly TYPE = "continuity.check";
    readonly type = ContinuityCheckQuery.TYPE;

    constructor(readonly payload: ContinuityCheckPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return continuityPayloadIssues(this.payload, ctx);
    }

    execute(ctx: DirectorContext): { readonly issues: readonly ContinuityIssue[] } {
        const subject = ctx.scene.manager.getEntity(this.payload.subjectId);
        if (!subject) throw new Error("Continuity subject disappeared after validation");
        const shots: ContinuityShot[] = this.payload.shotIds.map((id) => {
            const shot = ctx.camera.director.getShot(id);
            if (!shot) throw new Error("Continuity shot disappeared after validation");
            return { id, ...shot.toJSON() };
        });
        const request: ContinuityCheckRequest = {
            subject: { id: subject.id, transform: subject.transform },
            shots,
            sampleTimes: this.payload.sampleTimes,
            teleportThreshold: this.payload.teleportThreshold,
            timeline: ctx.timeline.document.toJSON(),
        };
        return { issues: new ContinuityChecker().check(request) };
    }
}


/** continuity.* is intentionally query-only: diagnostics are never scene edits or history entries. */
export function registerContinuityQueries(dispatcher: CommandDispatcher): void {
    dispatcher.registerQuery(
        ContinuitySelectionOptionsQuery.TYPE,
        (payload: Record<string, never>) => new ContinuitySelectionOptionsQuery(payload),
        {
            type: ContinuitySelectionOptionsQuery.TYPE,
            version: CONTINUITY_VERSION,
            kind: "query",
            permissions: [CONTINUITY_READ_PERMISSION],
            appliesWhen: "director-desk.continuity-v1",
        },
    );
    dispatcher.registerQuery(
        ContinuityCheckQuery.TYPE,
        (payload: ContinuityCheckPayload) => new ContinuityCheckQuery(payload),
        {
            type: ContinuityCheckQuery.TYPE,
            version: CONTINUITY_VERSION,
            kind: "query",
            permissions: [CONTINUITY_READ_PERMISSION],
            appliesWhen: "director-desk.continuity-v1",
        },
    );
}
