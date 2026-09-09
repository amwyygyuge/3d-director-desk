import { Box3, Vector3 } from "three";
import type { Object3D } from "three";

import type { DirectorContext } from "@/command/DirectorCommand";
import { entityLoadState } from "@/command/subjectBounds";
import type { EntityLoadState } from "@/command/subjectBounds";
import { measureModelBox } from "@/core/measureModelBox";
import type { SceneObject, SceneObjectKind, Transform, Vec3 } from "@/core/SceneObject";
import type { SceneNarrativeIdentityInit, SceneSpatialScaleInit } from "@/core/SceneSemantics";

/** AI 与人工验收共用的场景实体读模型；只暴露可序列化领域数据。 */
export interface SceneEntityInspection {
    readonly id: string;
    readonly kind: SceneObjectKind;
    readonly name: string;
    readonly narrativeIdentity: SceneNarrativeIdentityInit | null;
    readonly spatialScale: SceneSpatialScaleInit;
    readonly transform: Transform;
    readonly loadState: EntityLoadState;
    readonly mountedActionId: string | null;
    readonly actionSchedule: {
        readonly startTimeSeconds: number;
        readonly durationSeconds: number;
        readonly attackSeconds: number;
        readonly releaseSeconds: number;
    } | null;
    /** 完整动作序列(按起始升序);多动作表演读这里,actionSchedule 只是首条的兼容投影。 */
    readonly actionSequence: readonly {
        /**
         * 排期段 id:`action.set-range` / `action.unmount-performance` 定位「改哪一段」的入参。
         * 多段序列下 actionId 不足以定位——同一动作可以演多次。
         */
        readonly performanceId: string;
        readonly actionId: string;
        readonly startTimeSeconds: number;
        readonly durationSeconds: number;
        readonly attackSeconds: number;
        readonly releaseSeconds: number;
        /** 非空 = 时段对齐到该走位轨区间,轨道重定时后自动跟随。 */
        readonly alignedToTrackId: string | null;
    }[];
    readonly bounds: { readonly size: Vec3; readonly center: Vec3 } | null;
}

/** 场景只读投影服务：运行时包围盒仅在显式查询时测量，不进入 MobX。 */
export class SceneInspectionService {
    private readonly box = new Box3();
    private readonly size = new Vector3();
    private readonly center = new Vector3();

    inspect(ctx: DirectorContext, entityIds?: readonly string[]): readonly SceneEntityInspection[] {
        const candidates = entityIds
            ? entityIds.flatMap((id) => {
                  const entity = ctx.scene.manager.getEntity(id);
                  return entity ? [entity] : [];
              })
            : ctx.scene.manager.list();
        return candidates.map((entity) => this.inspectEntity(ctx, entity));
    }

    private inspectEntity(ctx: DirectorContext, entity: SceneObject): SceneEntityInspection {
        const serialized = entity.toJSON();
        // 兼容投影仍取首段;多段表演的真相在 actionSequence
        const performance = entity.actionPerformances[0] ?? null;
        return {
            id: entity.id,
            kind: entity.kind,
            name: entity.name,
            narrativeIdentity: serialized.narrativeIdentity ?? null,
            spatialScale: serialized.spatialScale ?? entity.spatialScale.toJSON(),
            transform: serialized.transform ?? entity.transform,
            loadState: entityLoadState(ctx, entity),
            mountedActionId: entity.actionId,
            actionSchedule: performance
                ? {
                      startTimeSeconds: performance.startTimeSeconds,
                      durationSeconds: performance.durationSeconds,
                      attackSeconds: performance.attackSeconds,
                      releaseSeconds: performance.releaseSeconds,
                  }
                : null,
            actionSequence: entity.actionPerformances.map((entry) => ({
                performanceId: entry.id,
                actionId: entry.actionId,
                startTimeSeconds: entry.startTimeSeconds,
                durationSeconds: entry.durationSeconds,
                attackSeconds: entry.attackSeconds,
                releaseSeconds: entry.releaseSeconds,
                alignedToTrackId: entry.alignment?.trackId ?? null,
            })),
            bounds: this.boundsFor(ctx.scene.manager.getRuntime(entity.id)),
        };
    }

    private boundsFor(runtime: Object3D | undefined): SceneEntityInspection["bounds"] {
        if (!runtime) return null;
        measureModelBox(runtime, this.box);
        if (this.box.isEmpty()) return null;
        this.box.getSize(this.size);
        this.box.getCenter(this.center);
        return { size: this.size.toArray() as Vec3, center: this.center.toArray() as Vec3 };
    }
}
