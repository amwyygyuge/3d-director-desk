import { makeAutoObservable } from "mobx";

import { parseAssetEntry } from "@/assets/catalog/AssetEntry";
import type { AssetEntry, AssetSource } from "@/assets/catalog/AssetEntry";
import type { AssetProvider } from "@/assets/catalog/AssetProvider";

export interface AssetListFilter {
    readonly kind?: AssetEntry["kind"] | undefined;
    readonly category?: string | undefined;
}

/**
 * 资源目录(注册表):全来源条目的统一可观察视图。
 * 纪律:目录只存元数据纯数据;three 运行时仍在 ModelImporter/AnimationLibrary。
 * id 冲突即拒绝(后写不覆盖),保证 AI 读取的目录是确定性的。
 */
export class AssetCatalog {
    private readonly entriesMap = new Map<string, AssetEntry>();

    constructor() {
        makeAutoObservable(this);
    }

    /** 注册条目;返回实际入表数(重复 id 不计) */
    registerEntries(entries: readonly AssetEntry[], source: AssetSource): number {
        let registered = 0;
        for (const entry of entries) {
            if (this.entriesMap.has(entry.id)) continue;
            this.entriesMap.set(entry.id, { ...entry, source });
            registered += 1;
        }
        return registered;
    }

    /** 宿主注入入口(bridge 消息/直嵌回调):先过条目校验围栏 */
    registerInjected(raw: readonly unknown[]): number {
        const parsed = raw.map(parseAssetEntry).filter((entry): entry is AssetEntry => entry !== null);
        return this.registerEntries(parsed, "injected");
    }

    /** 加载 provider 条目;单个失败不影响其他(provider 隔离) */
    async loadProvider(provider: AssetProvider, source: AssetSource, signal?: AbortSignal): Promise<number> {
        try {
            const entries = await provider.load();
            if (signal?.aborted) return 0;
            return this.registerEntries(entries, source);
        } catch {
            return 0;
        }
    }

    get(id: string): AssetEntry | undefined {
        return this.entriesMap.get(id);
    }

    list(filter?: AssetListFilter): readonly AssetEntry[] {
        return [...this.entriesMap.values()].filter((entry) => {
            if (filter?.kind !== undefined && entry.kind !== filter.kind) return false;
            return filter?.category === undefined || entry.category === filter.category;
        });
    }

    get size(): number {
        return this.entriesMap.size;
    }
}
