import type { DirectorContext } from "@/command/DirectorCommand";
import { SceneInspectionService } from "@/command/SceneInspectionService";
import type { SceneEntityInspection } from "@/command/SceneInspectionService";

/** AI 感知档位：先读极简索引，再针对对象读几何数据，避免把整桌快照塞进上下文。 */
export const DESK_PERCEPTION_DETAIL = {
    BRIEF: "brief",
    FOCUSED: "focused",
    FULL: "full",
} as const;

export type DeskPerceptionDetail = (typeof DESK_PERCEPTION_DETAIL)[keyof typeof DESK_PERCEPTION_DETAIL];

export interface DeskPerceptionRequest {
    readonly detail: DeskPerceptionDetail;
    readonly entityIds?: readonly string[];
}

export interface DeskPerceptionCoordinateSystem {
    readonly handedness: "right";
    readonly upAxis: "y";
    readonly horizontalAxes: readonly ["x", "z"];
    readonly rotationUnit: "radians";
    readonly semanticDirections: "director-camera";
}

interface DeskPerceptionBriefEntity {
    readonly id: string;
    readonly name: string;
    readonly kind: SceneEntityInspection["kind"];
    readonly narrativeIdentity: SceneEntityInspection["narrativeIdentity"];
    readonly loadState: SceneEntityInspection["loadState"];
    readonly spatialScale: SceneEntityInspection["spatialScale"];
}

const COORDINATE_SYSTEM: DeskPerceptionCoordinateSystem = {
    handedness: "right",
    upAxis: "y",
    horizontalAxes: ["x", "z"],
    rotationUnit: "radians",
    semanticDirections: "director-camera",
};

function briefEntityFor(entity: SceneEntityInspection): DeskPerceptionBriefEntity {
    return {
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        narrativeIdentity: entity.narrativeIdentity,
        loadState: entity.loadState,
        spatialScale: entity.spatialScale,
    };
}

/** 导演台 AI 读模型服务：所有结果纯数据，不泄露 store 或 Three 引用。 */
export class DirectorDeskPerceptionService {
    constructor(private readonly sceneInspection: SceneInspectionService = new SceneInspectionService()) {}

    inspect(ctx: DirectorContext, request: DeskPerceptionRequest): unknown {
        const base = {
            coordinateSystem: COORDINATE_SYSTEM,
            scalePolicy: {
                actorMeters: "演员按身高落尺，场景单位可解释为米",
                referenceMeters: "标定资产按 physicalMaxDimensionMeters 落尺，场景单位可解释为米",
                relative: "未标定资产按视觉单位盒归一化，只能用于相对构图与包围盒间距",
            },
            transport: {
                timeSeconds: ctx.clock.time,
                isPlaying: ctx.clock.isPlaying,
                isLooping: ctx.clock.isLooping,
                durationSeconds: ctx.timeline.document.duration,
            },
            output: { formatId: ctx.output.formatId, aspectRatio: ctx.output.format.aspectRatio },
            activeShotId: ctx.camera.activeShotId,
        };
        switch (request.detail) {
            case DESK_PERCEPTION_DETAIL.BRIEF:
                return { ...base, entities: this.sceneInspection.inspect(ctx).map(briefEntityFor) };
            case DESK_PERCEPTION_DETAIL.FOCUSED:
                return { ...base, entities: this.sceneInspection.inspect(ctx, request.entityIds) };
            case DESK_PERCEPTION_DETAIL.FULL:
                return {
                    ...base,
                    entities: this.sceneInspection.inspect(ctx),
                    shots: ctx.camera.director.listShots().map(([id, shot]) => ({ id, shot: shot.toJSON() })),
                    motion: {
                        clips: ctx.motion.clips.map((clip) => clip.toJSON()),
                        program: ctx.motion.program.toJSON(),
                    },
                    timeline: ctx.timeline.document.toJSON(),
                };
        }
    }
}
