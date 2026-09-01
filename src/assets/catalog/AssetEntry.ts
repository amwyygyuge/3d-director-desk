import { MODEL_FORMAT } from "@/assets/ModelAsset";
import type { ModelFormat } from "@/assets/ModelAsset";

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

/** 模型分类(开放词表,常用先行):人/动物/植物/家具/道具 */
export const ASSET_CATEGORY = {
    HUMAN: "character.human",
    ANIMAL: "character.animal",
    PLANT: "plant",
    FURNITURE: "furniture",
    PROP: "prop",
} as const;

/**
 * 资源条目(值对象,纯数据可序列化):目录只存元数据 + 定位符,资源本体在 provider 侧——
 * 模块与资源完全解耦;license 随条目走(许可纪律,AI 可见)。
 */
export interface AssetEntry {
    readonly id: string;
    readonly kind: AssetKind;
    /** 分类词表:character.human / character.animal / plant / furniture / prop(动作资产按语义归类,如 action.combat) */
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
    /** 模型资产:内嵌动作名清单(AI 选型可读) */
    readonly embeddedClips?: readonly string[];
    readonly tags: readonly string[];
}

const ASSET_KINDS: readonly string[] = Object.values(ASSET_KIND);
export function isAssetKind(value: unknown): value is AssetKind {
    return typeof value === "string" && ASSET_KINDS.includes(value);
}
const ASSET_SOURCES: readonly string[] = Object.values(ASSET_SOURCE);
const MODEL_FORMATS: readonly string[] = Object.values(MODEL_FORMAT);

/** 外部输入(宿主注入/catalog.json)的条目校验;不合格条目丢弃并计数 */
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
    return entry;
}
