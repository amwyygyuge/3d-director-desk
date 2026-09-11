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

/** 内置资源目录相对基址下的清单文件名。 */
const BUILTIN_CATALOG_FILE = "catalog.json";
/** 站点根部署的缺省基址(playground / Storybook 的 `public/builtin-assets`)。 */
export const DEFAULT_BUILTIN_ASSET_BASE_URL = "/builtin-assets";

/**
 * 内置资源:读取入库的 catalog.json(许可随文件入库审计,headless/内网零外部依赖)。
 *
 * 基址必须可注入,不能钉死站点绝对路径:资产随 npm 包发布到 `dist/builtin-assets/`,
 * 而宿主页面的站点根是宿主自己的。钉死 `/builtin-assets` 只在「本包恰好就是站点根」时成立
 * (playground/Storybook),嵌入宿主后该路径指向宿主根 → 404 → 资源面板空白。
 * 宿主把这批资产 serve 到任意前缀后,经 `builtinAssetBaseUrl` 告知即可。
 *
 * 目录内的条目 url 是相对基址解析的,故基址变化无需改 catalog.json。
 */
export class BuiltinAssetProvider implements AssetProvider {
    private readonly baseUrl: string;

    constructor(baseUrl: string = DEFAULT_BUILTIN_ASSET_BASE_URL) {
        // 去尾斜杠:与宿主 vendor 解析约定一致(resolve("x") → "/x",不带尾斜杠)
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async load(): Promise<readonly AssetEntry[]> {
        const catalogUrl = `${this.baseUrl}/${BUILTIN_CATALOG_FILE}`;
        const response = await fetch(catalogUrl);
        if (!response.ok) throw new Error(`内置资源目录拉取失败(${response.status}): ${catalogUrl}`);
        // 基址配错的典型表现不是 404:SPA 宿主的 history fallback 会以 200 返回 index.html,
        // 直接 .json() 只会抛出「Unexpected token '<'」,完全指不到根因。先按内容类型判。
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("json")) {
            throw new Error(
                `内置资源目录不是 JSON(content-type: ${contentType || "未知"}): ${catalogUrl};` +
                    `基址可能配错——请确认宿主已把包内 dist/builtin-assets/ serve 到该前缀`,
            );
        }
        const raw: unknown = await response.json();
        if (typeof raw !== "object" || raw === null || !("assets" in raw) || !Array.isArray(raw.assets)) {
            throw new Error(`内置资源目录格式无效: ${catalogUrl}`);
        }
        return raw.assets
            .map(parseAssetEntry)
            .filter((entry): entry is AssetEntry => entry !== null)
            .map((entry) => ({ ...entry, url: this.resolveEntryUrl(entry.url) }));
    }

    /**
     * 条目 url 落到实际基址。
     *
     * catalog.json 里的 url 写作 `/builtin-assets/...`(站内绝对路径,历史口径)。
     * 基址被宿主改写后,这些 url 必须同步改写,否则目录能读到、模型仍 404。
     * 已是绝对 URL(http/blob/data)的条目原样透传:那是宿主注入或线上资产,不归本基址管。
     */
    private resolveEntryUrl(url: string): string {
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
        const relative = url.startsWith(DEFAULT_BUILTIN_ASSET_BASE_URL)
            ? url.slice(DEFAULT_BUILTIN_ASSET_BASE_URL.length)
            : url;
        return `${this.baseUrl}${relative.startsWith("/") ? "" : "/"}${relative}`;
    }
}
