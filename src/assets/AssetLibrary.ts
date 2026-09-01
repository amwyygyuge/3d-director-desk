import { makeAutoObservable } from "mobx";

import { ModelAsset } from "@/assets/ModelAsset";
import type { ModelFormat } from "@/assets/ModelAsset";

/**
 * 资产库(仓储):已导入模型的纯数据注册表。
 * 去重判定:同 url 或同「文件名 + 体积」视为同一资产——
 * 重复导入不重复加载,调用方负责提示。
 */
export class AssetLibrary {
    readonly assets: ModelAsset[] = [];

    constructor() {
        makeAutoObservable(this);
    }

    register(init: { name: string; url: string; format: ModelFormat; sizeBytes: number }): {
        asset: ModelAsset;
        duplicate: boolean;
    } {
        const existing = this.assets.find(
            (a) => a.url === init.url || (a.name === init.name && a.sizeBytes === init.sizeBytes),
        );
        if (existing) return { asset: existing, duplicate: true };

        const asset = new ModelAsset({ id: `asset-${crypto.randomUUID()}`, ...init });
        this.assets.push(asset);
        return { asset, duplicate: false };
    }

    /** 卸载时回收本库创建的 blob URL;对 http(s) URL revoke 是无害空操作 */
    dispose(): void {
        for (const asset of this.assets) URL.revokeObjectURL(asset.url);
        this.assets.length = 0;
    }
}
