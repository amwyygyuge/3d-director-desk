import { parseAssetEntry } from "@/assets/catalog/AssetEntry";
import type { AssetEntry } from "@/assets/catalog/AssetEntry";

/**
 * 资源来源策略:每个 provider 负责把自己的条目加载进目录。
 * 模块只依赖本接口——内置/宿主/线上新增来源不改目录代码。
 */
export interface AssetProvider {
    /** 幂等加载;可重复调用(目录按 id 去重) */
    load(): Promise<readonly AssetEntry[]>;
}

/** 内置资源:读取入库的 catalog.json(许可随文件入库审计,headless/内网零外部依赖) */
export class BuiltinAssetProvider implements AssetProvider {
    constructor(private readonly catalogUrl = "/builtin-assets/catalog.json") {}

    async load(): Promise<readonly AssetEntry[]> {
        const response = await fetch(this.catalogUrl);
        if (!response.ok) throw new Error(`内置资源目录拉取失败: ${response.status}`);
        const raw: unknown = await response.json();
        if (typeof raw !== "object" || raw === null || !("assets" in raw) || !Array.isArray(raw.assets)) {
            throw new Error("内置资源目录格式无效");
        }
        return raw.assets.map(parseAssetEntry).filter((entry): entry is AssetEntry => entry !== null);
    }
}
