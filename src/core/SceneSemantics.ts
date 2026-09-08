/** 场景叙事角色：AI 通过稳定领域标签理解“主角/反派/道具”，不从资源文件名猜测。 */
export const SCENE_NARRATIVE_ROLE = {
    PROTAGONIST: "protagonist",
    ANTAGONIST: "antagonist",
    SUPPORTING: "supporting",
    PROP: "prop",
    SET: "set",
} as const;

export type SceneNarrativeRole = (typeof SCENE_NARRATIVE_ROLE)[keyof typeof SCENE_NARRATIVE_ROLE];

export interface SceneNarrativeIdentityInit {
    readonly role: SceneNarrativeRole;
    readonly label: string;
}

const SCENE_NARRATIVE_ROLES = Object.values(SCENE_NARRATIVE_ROLE) as readonly SceneNarrativeRole[];

/** 可序列化的实体叙事身份值对象；label 区分多个同类角色。 */
export class SceneNarrativeIdentity {
    readonly role: SceneNarrativeRole;
    readonly label: string;

    constructor(init: SceneNarrativeIdentityInit) {
        if (!isSceneNarrativeIdentityInit(init)) throw new Error("SceneNarrativeIdentity: 身份参数无效");
        this.role = init.role;
        this.label = init.label;
        Object.freeze(this);
    }

    toJSON(): SceneNarrativeIdentityInit {
        return { role: this.role, label: this.label };
    }
}

export function isSceneNarrativeIdentityInit(value: unknown): value is SceneNarrativeIdentityInit {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { readonly role?: unknown; readonly label?: unknown };
    return (
        typeof candidate.role === "string" &&
        SCENE_NARRATIVE_ROLES.includes(candidate.role as SceneNarrativeRole) &&
        typeof candidate.label === "string" &&
        candidate.label.length > 0
    );
}

/** 量纲模式：演员按身高落尺；已标定通用资产按参考最大边落尺；未知来源只能相对构图。 */
export const SCENE_SPATIAL_SCALE_KIND = {
    ACTOR_METERS: "actor-meters",
    REFERENCE_METERS: "reference-meters",
    RELATIVE: "relative",
} as const;

export type SceneSpatialScaleKind = (typeof SCENE_SPATIAL_SCALE_KIND)[keyof typeof SCENE_SPATIAL_SCALE_KIND];

export interface SceneSpatialScaleInit {
    readonly kind: SceneSpatialScaleKind;
    readonly referenceMaxDimensionMeters: number | null;
}

const SCENE_SPATIAL_SCALE_KINDS = Object.values(SCENE_SPATIAL_SCALE_KIND) as readonly SceneSpatialScaleKind[];

/** 场景量纲值对象；所有坐标仍为场景单位，只有米制模式允许把距离解释为真实米。 */
export class SceneSpatialScale {
    readonly kind: SceneSpatialScaleKind;
    readonly referenceMaxDimensionMeters: number | null;

    constructor(init: SceneSpatialScaleInit) {
        if (!isSceneSpatialScaleInit(init)) throw new Error("SceneSpatialScale: 量纲参数无效");
        this.kind = init.kind;
        this.referenceMaxDimensionMeters = init.referenceMaxDimensionMeters;
        Object.freeze(this);
    }

    get isMetric(): boolean {
        return this.kind !== SCENE_SPATIAL_SCALE_KIND.RELATIVE;
    }

    toJSON(): SceneSpatialScaleInit {
        return { kind: this.kind, referenceMaxDimensionMeters: this.referenceMaxDimensionMeters };
    }
}

export function isSceneSpatialScaleInit(value: unknown): value is SceneSpatialScaleInit {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { readonly kind?: unknown; readonly referenceMaxDimensionMeters?: unknown };
    const isKnownKind =
        typeof candidate.kind === "string" &&
        SCENE_SPATIAL_SCALE_KINDS.includes(candidate.kind as SceneSpatialScaleKind);
    const isReferenceDimension =
        typeof candidate.referenceMaxDimensionMeters === "number" &&
        Number.isFinite(candidate.referenceMaxDimensionMeters) &&
        candidate.referenceMaxDimensionMeters > 0;
    const hasNoReferenceDimension = candidate.referenceMaxDimensionMeters === null;
    const requiresReferenceDimension = candidate.kind === SCENE_SPATIAL_SCALE_KIND.REFERENCE_METERS;
    return isKnownKind && (requiresReferenceDimension ? isReferenceDimension : hasNoReferenceDimension);
}

export const ACTOR_METERS_SCALE = new SceneSpatialScale({
    kind: SCENE_SPATIAL_SCALE_KIND.ACTOR_METERS,
    referenceMaxDimensionMeters: null,
});

export const RELATIVE_SPATIAL_SCALE = new SceneSpatialScale({
    kind: SCENE_SPATIAL_SCALE_KIND.RELATIVE,
    referenceMaxDimensionMeters: null,
});

export function scaleForReferenceMaxDimension(referenceMaxDimensionMeters: number): SceneSpatialScale {
    return new SceneSpatialScale({ kind: SCENE_SPATIAL_SCALE_KIND.REFERENCE_METERS, referenceMaxDimensionMeters });
}
