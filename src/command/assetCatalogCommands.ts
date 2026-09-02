import { ASSET_CATEGORY, ASSET_KIND, isAssetKind } from "@/assets/catalog/AssetEntry";
import type { AssetEntry } from "@/assets/catalog/AssetEntry";
import type { ActorProfileInit } from "@/actor/ActorProfile";
import { finiteTransform } from "@/core/SceneObject";
import type { Transform } from "@/core/SceneObject";
import { DirectorCommand } from "@/command/DirectorCommand";
import { mountWhenReady, provisionAction } from "@/command/actionProvisioning";
import type { DirectorContext } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { TRANSFORM_SCHEMA } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
const ASSETS_COMMAND_VERSION = "1" as const;
const ASSETS_READ_PERMISSION = "assets:read";
const ASSETS_EDIT_PERMISSION = "assets:edit";

function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return {
        type,
        version: ASSETS_COMMAND_VERSION,
        kind,
        permissions,
        appliesWhen: "director-desk.assets-v1",
        payload,
    };
}

interface AssetsListPayload {
    readonly kind?: string;

    readonly category?: string;
}
const ASSET_ENTITY_ID_PREFIX = "asset-";

const ASSETS_LIST_CONTRACT: PayloadContract = {
    properties: {
        kind: { type: "string", enum: Object.values(ASSET_KIND) },
        category: { type: "string", enum: Object.values(ASSET_CATEGORY) },
    },
};

const ASSETS_PLACE_CONTRACT: PayloadContract = {
    properties: {
        assetId: { type: "string" },
        id: { type: "string" },
        transform: TRANSFORM_SCHEMA,
    },
    required: ["assetId"],
};

const ASSETS_MOUNT_CONTRACT: PayloadContract = {
    properties: {
        assetId: { type: "string" },
        objectId: { type: "string" },
    },
    required: ["assetId", "objectId"],
};

/** 资源目录查询:AI 发现面的主入口(过滤 kind/category;许可与骨骼家族随条目返回) */
export class AssetsListQuery implements DirectorQuery<AssetsListPayload> {
    static readonly TYPE = "assets.list";
    readonly type = AssetsListQuery.TYPE;

    constructor(readonly payload: AssetsListPayload = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        const kind = isAssetKind(this.payload.kind) ? this.payload.kind : undefined;
        return ctx.catalog.list({ kind, category: this.payload.category });
    }
}

interface AssetsPlacePayload {
    readonly assetId: string;
    /** 场景内实体 id;缺省时命令创建稳定 UUID，允许同一资产重复放置。 */
    readonly id?: string;
    readonly transform?: Transform;
}

interface ResolvedAssetsPlacePayload extends AssetsPlacePayload {
    readonly id: string;
}

function createAssetEntityId(assetId: string): string {
    return `${ASSET_ENTITY_ID_PREFIX}${assetId}-${crypto.randomUUID()}`;
}

/** 目录条目 → 人偶画像:仅声明了 actor 且有骨架家族的条目成为人偶,普通模型保持无画像。 */
function actorProfileInitFor(entry: AssetEntry): ActorProfileInit | null {
    return entry.actor && entry.skeletonFamily
        ? { skeletonFamily: entry.skeletonFamily, build: { heightMeters: entry.actor.defaultHeightMeters } }
        : null;
}

/** 按目录条目放置模型资产(格式/定位符由条目携带,AI 不猜 URL) */
export class AssetsPlaceCommand extends DirectorCommand<AssetsPlacePayload> {
    static readonly TYPE = "assets.place";
    readonly type = AssetsPlaceCommand.TYPE;

    readonly payload: ResolvedAssetsPlacePayload;

    constructor(payload: AssetsPlacePayload) {
        super();
        this.payload = { ...payload, id: payload.id ?? createAssetEntityId(payload.assetId) };
    }

    validate(ctx: DirectorContext): string[] {
        const entry = ctx.catalog.get(this.payload.assetId);
        if (!entry) return [`资源 "${this.payload.assetId}" 不在目录(先 assets.list 发现)`];
        if (entry.kind !== ASSET_KIND.MODEL) return [`资源 "${this.payload.assetId}" 不是模型(动作用 assets.mount)`];
        const id = this.payload.id;
        if (ctx.scene.manager.getEntity(id)) return [`id "${id}" 已存在`];
        if (this.payload.transform !== undefined && !finiteTransform(this.payload.transform)) {
            return ["transform 含非法数值"];
        }
        return [];
    }

    execute(ctx: DirectorContext): void {
        const entry = ctx.catalog.get(this.payload.assetId);
        if (!entry) return;
        const actor = actorProfileInitFor(entry);
        ctx.scene.addObject({
            id: this.payload.id,
            kind: "model",
            sourceUrl: entry.url,
            format: entry.format,
            name: entry.name,
            ...(this.payload.transform ? { transform: this.payload.transform } : {}),
            ...(actor ? { actor } : {}),
        });
    }

    override invert(): readonly { readonly type: string; readonly payload: unknown }[] {
        return [{ type: "object.remove", payload: { id: this.payload.id } }];
    }
}

interface AssetsMountPayload {
    readonly assetId: string;
    readonly objectId: string;
}

/** 按目录条目挂载动作资产(clip 置备 + 运行时就绪等待;骨骼不兼容由动作挂载校验拦截) */
export class AssetsMountCommand extends DirectorCommand<AssetsMountPayload> {
    static readonly TYPE = "assets.mount";
    readonly type = AssetsMountCommand.TYPE;

    constructor(readonly payload: AssetsMountPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const entry = ctx.catalog.get(this.payload.assetId);
        if (!entry) return [`资源 "${this.payload.assetId}" 不在目录(先 assets.list 发现)`];
        if (entry.kind !== ASSET_KIND.ACTION) return [`资源 "${this.payload.assetId}" 不是动作(模型用 assets.place)`];
        if (!ctx.scene.manager.getEntity(this.payload.objectId)) return [`对象 "${this.payload.objectId}" 不存在`];
        return [];
    }

    execute(ctx: DirectorContext): void {
        const entry = ctx.catalog.get(this.payload.assetId);
        if (!entry) return;
        void (async () => {
            try {
                const action = await provisionAction(ctx, {
                    name: entry.name,
                    url: entry.url,
                    clipName: entry.clipName,
                });
                const mounted = await mountWhenReady(ctx, this.payload.objectId, action.id);
                if (!mounted) ctx.ui.setApplicationNotice(`动作挂载等待运行时超时:${this.payload.objectId}`);
                ctx.playback.sampleCurrent();
            } catch {
                ctx.ui.setApplicationNotice(`动作资产加载失败:${entry.name}`);
            }
        })();
    }
}

export function registerAssetCatalogCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AssetsPlaceCommand.TYPE,
        (payload: AssetsPlacePayload) => new AssetsPlaceCommand(payload),
        capability(AssetsPlaceCommand.TYPE, "command", [ASSETS_EDIT_PERMISSION], ASSETS_PLACE_CONTRACT),
    );
    dispatcher.register(
        AssetsMountCommand.TYPE,
        (payload: AssetsMountPayload) => new AssetsMountCommand(payload),
        capability(AssetsMountCommand.TYPE, "command", [ASSETS_EDIT_PERMISSION], ASSETS_MOUNT_CONTRACT),
    );
    dispatcher.registerQuery(
        AssetsListQuery.TYPE,
        (payload: AssetsListPayload) => new AssetsListQuery(payload),
        capability(AssetsListQuery.TYPE, "query", [ASSETS_READ_PERMISSION], ASSETS_LIST_CONTRACT),
    );
}
