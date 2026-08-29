import type { Transform, Vec3 } from "../core/SceneObject";
import { TimelineDoc } from "../timeline/TimelineDoc";
import type { TimelineDocInit } from "../timeline/TimelineDoc";
import { TIMELINE_TRACK_KIND } from "../timeline/TimelineTrack";
import { evaluateTimelineTransform } from "../timeline/TimelineSampler";

const AXIS_EPSILON = 1e-4;
const AXIS_ALIGNMENT_MINIMUM = 0.98;

export const CONTINUITY_ISSUE_KIND = {
    AXIS_CROSSING: "axis-crossing",
    AXIS_AMBIGUOUS: "axis-ambiguous",
    TELEPORT: "teleport",
} as const;

export type ContinuityIssueKind = (typeof CONTINUITY_ISSUE_KIND)[keyof typeof CONTINUITY_ISSUE_KIND];

export interface ContinuitySubject {
    readonly id: string;
    readonly transform: Transform;
}

/** Ordered camera snapshot: serializable and independent from CameraDirector's observable map. */
export interface ContinuityShot {
    readonly id: string;
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
}

/** Axis data is optional diagnostic context for the transient scene overlay. */
export interface ContinuityAxis {
    readonly start: Vec3;
    readonly end: Vec3;
}

export interface ContinuityIssue {
    readonly kind: ContinuityIssueKind;
    readonly shotIds: readonly [string, string];
    readonly detail: string;
    readonly axis?: ContinuityAxis;
}

/**
 * Complete, JSON-serializable input to a continuity check. The caller must explicitly select
 * the subject, shot order, and sample times; this service never infers authoring intent.
 */
export interface ContinuityCheckRequest {
    readonly subject: ContinuitySubject;
    readonly shots: readonly ContinuityShot[];
    readonly sampleTimes: readonly number[];
    readonly teleportThreshold: number;
    readonly timeline: TimelineDocInit;
}

function vec3(x: number, y: number, z: number): Vec3 {
    return Object.freeze([x, y, z] as const);
}

function distance(left: Vec3, right: Vec3): number {
    const x = left[0] - right[0];
    const y = left[1] - right[1];
    const z = left[2] - right[2];
    return Math.hypot(x, y, z);
}

function hasTransformKeyBetween(
    document: TimelineDoc,
    subjectId: string,
    leftTime: number,
    rightTime: number,
): boolean {
    const track = document.trackForTarget(subjectId, TIMELINE_TRACK_KIND.TRANSFORM);
    if (!track) return false;
    const start = Math.min(leftTime, rightTime);
    const end = Math.max(leftTime, rightTime);
    return track.keyframes.some((keyframe) => keyframe.time > start && keyframe.time < end);
}

function issue(
    kind: ContinuityIssueKind,
    shotIds: readonly [string, string],
    detail: string,
    axis?: ContinuityAxis,
): ContinuityIssue {
    return Object.freeze({
        kind,
        shotIds: Object.freeze([shotIds[0], shotIds[1]] as const),
        detail,
        ...(axis ? { axis: Object.freeze({ start: axis.start, end: axis.end }) } : {}),
    });
}

interface SideOfAxis {
    readonly side: number;
    readonly axis: ContinuityAxis | null;
}

function sideOfAxis(subject: Vec3, shot: ContinuityShot): SideOfAxis {
    const axisX = shot.target[0] - subject[0];
    const axisZ = shot.target[2] - subject[2];
    const cameraX = shot.position[0] - subject[0];
    const cameraZ = shot.position[2] - subject[2];
    const axisLength = Math.hypot(axisX, axisZ);
    const cameraLength = Math.hypot(cameraX, cameraZ);
    if (axisLength < AXIS_EPSILON || cameraLength < AXIS_EPSILON) return { side: 0, axis: null };
    const side = axisX * cameraZ - axisZ * cameraX;
    return {
        side: Math.abs(side) < AXIS_EPSILON ? 0 : side,
        axis: { start: subject, end: vec3(shot.target[0], subject[1], shot.target[2]) },
    };
}

function axesAlign(left: ContinuityAxis, right: ContinuityAxis): boolean {
    const leftX = left.end[0] - left.start[0];
    const leftZ = left.end[2] - left.start[2];
    const rightX = right.end[0] - right.start[0];
    const rightZ = right.end[2] - right.start[2];
    const lengths = Math.hypot(leftX, leftZ) * Math.hypot(rightX, rightZ);
    return lengths >= AXIS_EPSILON && Math.abs((leftX * rightX + leftZ * rightZ) / lengths) >= AXIS_ALIGNMENT_MINIMUM;
}

/**
 * Pure domain service. It samples only immutable timeline data into a stack-owned buffer and
 * returns serializable diagnostics; it has no Three, command, store, or runtime dependencies.
 */
export class ContinuityChecker {
    check(request: ContinuityCheckRequest): readonly ContinuityIssue[] {
        const document = new TimelineDoc(request.timeline);
        const issues: ContinuityIssue[] = [];
        const current = {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
        };
        const next = {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
        };

        for (let index = 0; index + 1 < request.shots.length; index += 1) {
            const leftShot = request.shots[index];
            const rightShot = request.shots[index + 1];
            const leftTime = request.sampleTimes[index];
            const rightTime = request.sampleTimes[index + 1];
            if (!leftShot || !rightShot || leftTime === undefined || rightTime === undefined) continue;

            evaluateTimelineTransform(document, request.subject.id, leftTime, request.subject.transform, current);
            evaluateTimelineTransform(document, request.subject.id, rightTime, request.subject.transform, next);
            const leftSubject = vec3(current.position[0], current.position[1], current.position[2]);
            const rightSubject = vec3(next.position[0], next.position[1], next.position[2]);
            const leftAxis = sideOfAxis(leftSubject, leftShot);
            const rightAxis = sideOfAxis(rightSubject, rightShot);

            if (
                !leftAxis.axis ||
                !rightAxis.axis ||
                leftAxis.side === 0 ||
                rightAxis.side === 0 ||
                !axesAlign(leftAxis.axis, rightAxis.axis)
            ) {
                issues.push(
                    issue(
                        CONTINUITY_ISSUE_KIND.AXIS_AMBIGUOUS,
                        [leftShot.id, rightShot.id],
                        `机位 ${leftShot.id} 与 ${rightShot.id} 的轴线端点或站位不明确，无法可靠判定 180° 规则。`,
                        leftAxis.axis ?? rightAxis.axis ?? undefined,
                    ),
                );
            } else if (leftAxis.side < 0 !== rightAxis.side < 0) {
                issues.push(
                    issue(
                        CONTINUITY_ISSUE_KIND.AXIS_CROSSING,
                        [leftShot.id, rightShot.id],
                        `机位 ${leftShot.id} 与 ${rightShot.id} 位于主体轴线两侧，疑似越轴。`,
                        leftAxis.axis,
                    ),
                );
            }

            if (
                distance(leftSubject, rightSubject) > request.teleportThreshold &&
                !hasTransformKeyBetween(document, request.subject.id, leftTime, rightTime)
            ) {
                issues.push(
                    issue(
                        CONTINUITY_ISSUE_KIND.TELEPORT,
                        [leftShot.id, rightShot.id],
                        `主体在 ${leftShot.id} 与 ${rightShot.id} 之间位移超过 ${request.teleportThreshold}，但区间内没有走位关键帧。`,
                    ),
                );
            }
        }
        return Object.freeze(issues);
    }
}
