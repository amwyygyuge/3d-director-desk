import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import { MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION } from "@/document/compatibility/DeskDocumentMigration";
import { DocumentMigrationRegistry } from "@/document/compatibility/DocumentMigrationRegistry";

/**
 * 内置迁移登记的唯一入口。
 *
 * 当前为空:功能尚未发布,`MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION === DESK_DOCUMENT_VERSION`,
 * 没有需要承诺的历史存档——发布前的实验版本继续判不支持,不写任何迁移器。
 *
 * 首个正式发布时:冻结 `MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION` 为当时版本号。
 * 此后每次持久化 schema 破坏性变更,必须在同一次交付里同时完成
 * 「DESK_DOCUMENT_VERSION 升位 + 新领域模型 + 一条相邻迁移在此注册 + 历史 fixture 恢复验收」。
 * 下方完整性断言保证漏写迁移时构造导演台即失败,而不是等用户打不开旧工程才发现。
 */
export function createBuiltinDocumentMigrationRegistry(): DocumentMigrationRegistry {
    const registry = new DocumentMigrationRegistry();
    const path = registry.resolvePath(MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION, DESK_DOCUMENT_VERSION);
    if (!path.ok) {
        throw new Error(
            `文档迁移链断裂:缺少 v${path.missingFromVersion} → v${path.missingFromVersion + 1};升 DESK_DOCUMENT_VERSION 必须同批交付迁移器`,
        );
    }
    return registry;
}
