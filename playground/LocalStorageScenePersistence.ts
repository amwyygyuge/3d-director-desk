import { reaction } from "mobx";
import type { IReactionDisposer } from "mobx";

import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import type { DeskDocument } from "@/document/DeskDocument";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const DOCUMENT_COMMAND = {
    EXPORT: "desk.export-document",
    IMPORT: "desk.import-document",
} as const;
const STORAGE_KEY = `3d-director-desk.playground.scene.v${DESK_DOCUMENT_VERSION}`;
const BLOB_URL_PREFIX = "blob:";
const STORAGE_ERROR = {
    READ: "无法读取本地场景存档",
    RESTORE: "无法恢复本地场景存档",
    TRANSIENT_RESOURCE: "场景含本地导入资源，刷新后无法从本地存档恢复",
    WRITE: "无法保存本地场景存档",
} as const;

interface PersistedSceneDocument {
    readonly serialized: string;
    readonly hasTransientResources: boolean;
}

function hasTransientResources(document: DeskDocument): boolean {
    return (
        document.entities.some((entity) => entity.sourceUrl?.startsWith(BLOB_URL_PREFIX) === true) ||
        document.actions.some((action) => action.url.startsWith(BLOB_URL_PREFIX))
    );
}

/**
 * playground 基础设施适配器:以正式文档协议读写 localStorage。
 *
 * 与产品内导入导出保持同一条路径。观察范围仅覆盖 DeskDocument，编辑器瞬时 UI 状态不入存档；
 * 本地导入文件的 blob URL 跨刷新无效，检测到后清除存档而非制造不可恢复的假持久化。
 */
export class LocalStorageScenePersistence {
    private stopReaction: IReactionDisposer | null = null;
    private hasReportedStorageFailure = false;

    constructor(
        private readonly stores: DirectorDeskStores,
        private readonly storage: Storage,
    ) {}

    restore(): void {
        const document = this.readDocument();
        if (document === null) return;
        const result = this.stores.dispatcher.dispatch(
            { type: DOCUMENT_COMMAND.IMPORT, payload: { document } },
            this.stores,
            { record: false },
        );
        if (result.ok) return;
        this.reportFailure(STORAGE_ERROR.RESTORE);
    }

    start(): void {
        this.stopReaction?.();
        this.stopReaction = reaction(
            () => this.exportDocument(),
            (document) => this.persistDocument(document),
        );
    }

    dispose(): void {
        this.stopReaction?.();
        this.stopReaction = null;
    }

    private exportDocument(): PersistedSceneDocument {
        const result = this.stores.dispatcher.query({ type: DOCUMENT_COMMAND.EXPORT, payload: {} }, this.stores);
        if (!result.ok) throw new Error(STORAGE_ERROR.WRITE);
        const document = result.value as DeskDocument;
        return { serialized: JSON.stringify(document), hasTransientResources: hasTransientResources(document) };
    }

    private readDocument(): unknown | null {
        try {
            const document = this.storage.getItem(STORAGE_KEY);
            return document === null ? null : JSON.parse(document);
        } catch {
            this.reportFailure(STORAGE_ERROR.READ);
            return null;
        }
    }

    private persistDocument(document: PersistedSceneDocument): void {
        if (document.hasTransientResources) {
            this.clearDocument();
            this.reportFailure(STORAGE_ERROR.TRANSIENT_RESOURCE);
            return;
        }
        try {
            this.storage.setItem(STORAGE_KEY, document.serialized);
        } catch {
            this.reportFailure(STORAGE_ERROR.WRITE);
        }
    }

    private clearDocument(): void {
        try {
            this.storage.removeItem(STORAGE_KEY);
        } catch {
            this.reportFailure(STORAGE_ERROR.WRITE);
        }
    }

    private reportFailure(message: string): void {
        if (this.hasReportedStorageFailure) return;
        this.hasReportedStorageFailure = true;
        this.stores.ui.setApplicationNotice(message);
    }
}
