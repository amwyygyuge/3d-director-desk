import { toJS } from "mobx";

import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { entityReadinessIssue, subjectBoundsFor } from "@/command/subjectBounds";
import type { PayloadContract } from "@/command/PayloadContract";
import type { Transform, Vec3 } from "@/core/SceneObject";
import { HOME_DIRECTOR_POSE } from "@/store/CameraStore";

export const PLACEMENT_RELATION = {
    LEFT_OF: "left-of",
    RIGHT_OF: "right-of",
    IN_FRONT_OF: "in-front-of",
    BEHIND: "behind",
    FACING: "facing",
} as const;

export type PlacementRelation = (typeof PLACEMENT_RELATION)[keyof typeof PLACEMENT_RELATION];

interface PlacementSubject {
    readonly center: Vec3;
    readonly radius: number;
    readonly transform: Transform;
}

interface PlacementAnchor {
    readonly center: Vec3;
    readonly radius: number;
}

interface PlacementRequest {
    readonly subject: PlacementSubject;
    readonly anchor: PlacementAnchor;
    readonly forward: Vec3;
    readonly relation: PlacementRelation;
    readonly distance: number;
}

type PlacementResolver = (request: PlacementRequest) => Transform;

const DEFAULT_PLACEMENT_DISTANCE = 0;
const DEFAULT_HORIZONTAL_FORWARD: Vec3 = [0, 0, 1];
const UP: Vec3 = [0, 1, 0];
const LEFT_DIRECTION = -1;
const RIGHT_DIRECTION = 1;
// 与 MoveObjectCommand.TYPE 同值但不得 import commands.ts(聚合依赖成环);scene.stage 的 invert 也复用它
export const MOVE_OBJECT_COMMAND_TYPE = "object.move";
const SCENE_EDIT_PERMISSION = "scene:edit";
const SCENE_APPLIES_WHEN = "director-desk.scene-v1";
const PLACEMENT_RELATIONS = Object.values(PLACEMENT_RELATION) as readonly PlacementRelation[];

const ISSUE_CODE = {
    SUBJECT_ID: "placement-invalid-subject-id",
    ANCHOR_ID: "placement-invalid-anchor-id",
    RELATION: "placement-invalid-relation",
    DISTANCE: "placement-invalid-distance",
    SUBJECT_NOT_FOUND: "placement-subject-not-found",
    ANCHOR_NOT_FOUND: "placement-anchor-not-found",
    SAME_OBJECT: "placement-same-object",
} as const;

const placeRelativeContract: PayloadContract = {
    properties: {
        id: { type: "string" },
        anchorId: { type: "string" },
        relation: { type: "string", enum: Object.values(PLACEMENT_RELATION) },
        distance: { type: "number" },
    },
    required: ["id", "anchorId", "relation"],
};

/** 水平化视线前向(scene.stage 配方与 place-relative 共用参考系) */
export function horizontalForward(forward: Vec3): Vec3 {
    const [x, , z] = forward;
    const length = Math.hypot(x, z);
    return length > 0 ? [x / length, 0, z / length] : DEFAULT_HORIZONTAL_FORWARD;
}

/** 水平右向 = forward × up(画面右方;scene.stage 配方与 place-relative 共用) */
export function rightFor(forward: Vec3): Vec3 {
    const [forwardX, forwardY, forwardZ] = forward;
    const [upX, upY, upZ] = UP;
    return [forwardY * upZ - forwardZ * upY, forwardZ * upX - forwardX * upZ, forwardX * upY - forwardY * upX];
}

function spacingFor(request: PlacementRequest): number {
    return request.anchor.radius + request.subject.radius + request.distance;
}

function translatedTransform(request: PlacementRequest, direction: Vec3, sign: number): Transform {
    const [directionX, , directionZ] = direction;
    const [anchorX, , anchorZ] = request.anchor.center;
    const [, subjectY] = request.subject.transform.position;
    const spacing = spacingFor(request) * sign;
    return {
        position: [anchorX + directionX * spacing, subjectY, anchorZ + directionZ * spacing],
        rotation: request.subject.transform.rotation,
        scale: request.subject.transform.scale,
    };
}

function leftOf(request: PlacementRequest): Transform {
    return translatedTransform(request, rightFor(request.forward), LEFT_DIRECTION);
}

function rightOf(request: PlacementRequest): Transform {
    return translatedTransform(request, rightFor(request.forward), RIGHT_DIRECTION);
}

function inFrontOf(request: PlacementRequest): Transform {
    return translatedTransform(request, request.forward, LEFT_DIRECTION);
}

function behind(request: PlacementRequest): Transform {
    return translatedTransform(request, request.forward, RIGHT_DIRECTION);
}

function facing(request: PlacementRequest): Transform {
    const [subjectX, , subjectZ] = request.subject.transform.position;
    const [anchorX, , anchorZ] = request.anchor.center;
    const [rotationX, , rotationZ] = request.subject.transform.rotation;
    return {
        position: request.subject.transform.position,
        rotation: [rotationX, Math.atan2(anchorX - subjectX, anchorZ - subjectZ), rotationZ],
        scale: request.subject.transform.scale,
    };
}

const PLACEMENT_RESOLVERS: Record<PlacementRelation, PlacementResolver> = {
    [PLACEMENT_RELATION.LEFT_OF]: leftOf,
    [PLACEMENT_RELATION.RIGHT_OF]: rightOf,
    [PLACEMENT_RELATION.IN_FRONT_OF]: inFrontOf,
    [PLACEMENT_RELATION.BEHIND]: behind,
    [PLACEMENT_RELATION.FACING]: facing,
};

function isPlacementRelation(value: unknown): value is PlacementRelation {
    return typeof value === "string" && PLACEMENT_RELATIONS.includes(value as PlacementRelation);
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function isValidObjectId(id: unknown): id is string {
    return typeof id === "string" && id.length > 0;
}

/** 装载闸门:subject/anchor 任一方未就绪即拒(ready 判定见 readinessIssue) */
function readinessIssues(ctx: DirectorContext, payload: PlaceRelativePayload): readonly CommandIssue[] {
    const subject = isValidObjectId(payload.id) ? ctx.scene.manager.getEntity(payload.id) : undefined;
    const anchor = isValidObjectId(payload.anchorId) ? ctx.scene.manager.getEntity(payload.anchorId) : undefined;
    return [
        ...(subject ? [entityReadinessIssue(ctx, subject, "id")] : []),
        ...(anchor ? [entityReadinessIssue(ctx, anchor, "anchorId")] : []),
    ].filter((item) => item !== null);
}

function placementIssues(ctx: DirectorContext, payload: PlaceRelativePayload): readonly CommandIssue[] {
    const hasValidSubjectId = isValidObjectId(payload.id);
    const hasValidAnchorId = isValidObjectId(payload.anchorId);
    const subject = hasValidSubjectId ? ctx.scene.manager.getEntity(payload.id) : null;
    const anchor = hasValidAnchorId ? ctx.scene.manager.getEntity(payload.anchorId) : null;
    const hasValidDistance =
        payload.distance === undefined ||
        (Number.isFinite(payload.distance) && payload.distance >= DEFAULT_PLACEMENT_DISTANCE);
    return [
        ...(hasValidSubjectId ? [] : [issue(ISSUE_CODE.SUBJECT_ID, "id", "对象 id 格式无效")]),
        ...(hasValidAnchorId ? [] : [issue(ISSUE_CODE.ANCHOR_ID, "anchorId", "锚点对象 id 格式无效")]),
        ...(isPlacementRelation(payload.relation) ? [] : [issue(ISSUE_CODE.RELATION, "relation", "摆位关系无效")]),
        ...(hasValidDistance ? [] : [issue(ISSUE_CODE.DISTANCE, "distance", "摆位距离必须是大于或等于零的有限数")]),
        ...(subject ? [] : [issue(ISSUE_CODE.SUBJECT_NOT_FOUND, "id", `对象 "${payload.id}" 不存在`)]),
        ...(anchor ? [] : [issue(ISSUE_CODE.ANCHOR_NOT_FOUND, "anchorId", `锚点对象 "${payload.anchorId}" 不存在`)]),
        ...(payload.id === payload.anchorId ? [issue(ISSUE_CODE.SAME_OBJECT, "anchorId", "对象不能相对自身摆位")] : []),
        ...readinessIssues(ctx, payload),
    ];
}

/** 导演视线前向:scene.stage 配方与 place-relative 共用同一参考系(Rule of Two) */
export function forwardFromDirectorPose(ctx: DirectorContext): Vec3 {
    const pose = ctx.camera.lastDirectorPose ?? HOME_DIRECTOR_POSE;
    return [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
}

function resolvedPlacement(ctx: DirectorContext, payload: PlaceRelativePayload): Transform | null {
    const subject = ctx.scene.manager.getEntity(payload.id);
    const anchor = ctx.scene.manager.getEntity(payload.anchorId);
    if (!subject || !anchor) return null;
    const subjectBounds = subjectBoundsFor(ctx, payload.id);
    const anchorBounds = subjectBoundsFor(ctx, payload.anchorId);
    if (!subjectBounds || !anchorBounds) return null;
    return placementCompiler.resolve({
        subject: { ...subjectBounds, transform: subject.transform },
        anchor: anchorBounds,
        forward: forwardFromDirectorPose(ctx),
        relation: payload.relation,
        distance: payload.distance ?? DEFAULT_PLACEMENT_DISTANCE,
    });
}

function commandCapability(
    type: string,
    permission: string,
    appliesWhen: string,
    payload: PayloadContract,
): CommandCapability {
    return { type, version: "1", kind: "command", permissions: [permission], appliesWhen, payload };
}

/** 语义摆位编译器:以导演相机水平视线作为左右、前后的纯数据参考系。 */
export class PlacementCompiler {
    resolve(request: PlacementRequest): Transform {
        const normalizedRequest = { ...request, forward: horizontalForward(request.forward) };
        return PLACEMENT_RESOLVERS[normalizedRequest.relation](normalizedRequest);
    }
}

const placementCompiler = new PlacementCompiler();

interface PlaceRelativePayload {
    readonly id: string;
    readonly anchorId: string;
    readonly relation: PlacementRelation;
    readonly distance?: number;
}

export class PlaceRelativeCommand extends DirectorCommand<PlaceRelativePayload> {
    static readonly TYPE = "object.place-relative";
    readonly type = PlaceRelativeCommand.TYPE;

    constructor(readonly payload: PlaceRelativePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return placementIssues(ctx, this.payload);
    }

    execute(ctx: DirectorContext): void {
        const transform = resolvedPlacement(ctx, this.payload);
        if (transform) ctx.scene.updateTransform(this.payload.id, transform);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const previous = ctx.scene.manager.getEntity(this.payload.id)?.transform;
        return previous
            ? [{ type: MOVE_OBJECT_COMMAND_TYPE, payload: { id: this.payload.id, transform: toJS(previous) } }]
            : null;
    }
}

export function registerPlacementCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        PlaceRelativeCommand.TYPE,
        (payload) => new PlaceRelativeCommand(payload),
        commandCapability(PlaceRelativeCommand.TYPE, SCENE_EDIT_PERMISSION, SCENE_APPLIES_WHEN, placeRelativeContract),
    );
}
