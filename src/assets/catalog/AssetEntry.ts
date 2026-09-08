import { MODEL_FORMAT } from "@/assets/ModelAsset";
import type { ModelFormat } from "@/assets/ModelAsset";
import { isActionLoopMode } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

/** 资源大类:模型 / 动作 */
export const ASSET_KIND = {
    MODEL: "model",
    ACTION: "action",
} as const;
export type AssetKind = (typeof ASSET_KIND)[keyof typeof ASSET_KIND];

/** 来源:内置(入库缓存)/ 宿主注入 / 线上远程 */
export const ASSET_SOURCE = {
    BUILTIN: "builtin",
    INJECTED: "injected",
    REMOTE: "remote",
} as const;
export type AssetSource = (typeof ASSET_SOURCE)[keyof typeof ASSET_SOURCE];

/** 资源分类(开放词表,常用先行):人/动物/植物/家具/道具/布景/动作语义。 */
export const ASSET_CATEGORY = {
    HUMAN: "character.human",
    ANIMAL: "character.animal",
    PLANT: "plant",
    FURNITURE: "furniture",
    PROP: "prop",
    SCENERY: "scenery.geometry",
    ACTION_PERFORMANCE: "action.performance",
} as const;

/** 人偶资产声明:存在即表示该模型放置后带人偶画像(可改色/体型/姿势)。 */
export interface AssetActorDefaults {
    /** 放置时的真实身高(米);归一化策略据此等比缩放,替代通用模型的单位盒归一化。 */
    readonly defaultHeightMeters: number;
}

function isAssetActorDefaults(value: unknown): value is AssetActorDefaults {
    return (
        typeof value === "object" &&
        value !== null &&
        Number.isFinite((value as AssetActorDefaults).defaultHeightMeters)
    );
}

/**
 * 资源条目(值对象,纯数据可序列化):目录只存元数据 + 定位符,资源本体在 provider 侧——
 * 模块与资源完全解耦;license 随条目走(许可纪律,AI 可见)。
 */
export interface AssetEntry {
    readonly id: string;
    readonly kind: AssetKind;
    /** 分类词表:character.human / character.animal / plant / furniture / prop / scenery.geometry(动作资产按语义归类,如 action.combat) */
    readonly category: string;
    readonly name: string;
    readonly source: AssetSource;
    /** 定位符:站内路径(/builtin-assets/…)或可 fetch 的 URL */
    readonly url: string;
    readonly format: ModelFormat | null;
    readonly license: string;
    /** 骨骼家族(动作↔模型兼容声明,如 "mixamo");无骨骼为 null——重定向约束的前置表达 */
    readonly skeletonFamily: string | null;
    /** 动作资产:目标 clip 名(多 clip 文件内定位) */
    readonly clipName?: string | null;
    /** 动作资产:loop = 无缝循环;once = 播完进入回收段。 */
    readonly loopMode?: ActionLoopMode | null;
    /** 动作资产:去除源文件开头/结尾的静态参考帧;单位秒。 */
    readonly trimStartSeconds?: number | null;
    readonly trimEndSeconds?: number | null;
    /** 模型资产:内嵌动作名清单(AI 选型可读) */
    readonly embeddedClips?: readonly string[];
    /** 人偶资产:放置时注入默认画像;缺省即普通模型,不具备外观/体型/姿势能力 */
    readonly actor?: AssetActorDefaults | null;
    /** 已标定通用模型的最大边真实长度(米);缺省则按视觉单位盒归一化且不得声称物理距离。 */
    readonly physicalMaxDimensionMeters?: number | null;
    readonly tags: readonly string[];
}

const ASSET_KINDS: readonly string[] = Object.values(ASSET_KIND);
export function isAssetKind(value: unknown): value is AssetKind {
    return typeof value === "string" && ASSET_KINDS.includes(value);
}
const ASSET_SOURCES: readonly string[] = Object.values(ASSET_SOURCE);
const MODEL_FORMATS: readonly string[] = Object.values(MODEL_FORMAT);

/** 外部输入(宿主注入/catalog.json)的条目校验;不合格条目丢弃并计数 */
function isNonNegativeFinite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseAssetEntry(value: unknown): AssetEntry | null {
    if (typeof value !== "object" || value === null) return null;
    if (!("id" in value) || !("kind" in value) || !("url" in value)) return null;
    const candidate = value as { id: unknown; kind: unknown; url: unknown };
    if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
    if (typeof candidate.url !== "string" || candidate.url.length === 0) return null;
    if (typeof candidate.kind !== "string" || !ASSET_KINDS.includes(candidate.kind)) return null;
    const entry = value as AssetEntry;
    if (typeof entry.name !== "string" || typeof entry.category !== "string" || typeof entry.license !== "string")
        return null;
    if (typeof entry.source !== "string" || !ASSET_SOURCES.includes(entry.source)) return null;
    if (entry.format !== null && (typeof entry.format !== "string" || !MODEL_FORMATS.includes(entry.format)))
        return null;
    if (entry.skeletonFamily !== null && typeof entry.skeletonFamily !== "string") return null;
    if (!Array.isArray(entry.tags)) return null;
    if (
        (entry.actor !== undefined && entry.actor !== null && !isAssetActorDefaults(entry.actor)) ||
        (entry.actor !== undefined && entry.actor !== null && entry.physicalMaxDimensionMeters !== undefined) ||
        (entry.physicalMaxDimensionMeters !== undefined &&
            entry.physicalMaxDimensionMeters !== null &&
            !isPositiveFinite(entry.physicalMaxDimensionMeters)) ||
        (entry.loopMode !== undefined && entry.loopMode !== null && !isActionLoopMode(entry.loopMode)) ||
        (entry.trimStartSeconds !== undefined &&
            entry.trimStartSeconds !== null &&
            !isNonNegativeFinite(entry.trimStartSeconds)) ||
        (entry.trimEndSeconds !== undefined &&
            entry.trimEndSeconds !== null &&
            !isNonNegativeFinite(entry.trimEndSeconds))
    ) {
        return null;
    }
    return entry;
}
