import type { DeskDocumentMigration } from "@/document/compatibility/DeskDocumentMigration";

/** 迁移链解析结果;缺口以断点版本表达,调用方据此产出结构化拒绝。 */
export type DocumentMigrationPath =
    | { readonly ok: true; readonly migrations: readonly DeskDocumentMigration[] }
    | { readonly ok: false; readonly missingFromVersion: number };

/**
 * 版本迁移注册表:每桌一份,禁全局可变单例。
 *
 * 不变量(注册期即拒绝,不留到导入时才暴露):
 * - 每个 fromVersion 最多一条迁移(否则同一历史版本有两条升级语义,结果不可确定);
 * - 只允许相邻步进 toVersion === fromVersion + 1(大跨度迁移不可审计,且无法与后续版本组合);
 * - 相邻步进天然无环,链路解析因此必然终止。
 */
export class DocumentMigrationRegistry {
    private readonly migrations = new Map<number, DeskDocumentMigration>();

    register(migration: DeskDocumentMigration): void {
        if (migration.toVersion !== migration.fromVersion + 1) {
            throw new Error(
                `DocumentMigrationRegistry: 只允许相邻版本迁移,收到 v${migration.fromVersion} → v${migration.toVersion}`,
            );
        }
        if (this.migrations.has(migration.fromVersion)) {
            throw new Error(`DocumentMigrationRegistry: v${migration.fromVersion} 已注册迁移`);
        }
        this.migrations.set(migration.fromVersion, migration);
    }

    /**
     * 解析 sourceVersion → targetVersion 的相邻迁移链。
     * 任一段缺失即返回断点版本,调用方据此产出结构化拒绝——绝不静默跳过缺失的语义转换。
     */
    resolvePath(sourceVersion: number, targetVersion: number): DocumentMigrationPath {
        const path: DeskDocumentMigration[] = [];
        for (let version = sourceVersion; version < targetVersion; version++) {
            const migration = this.migrations.get(version);
            if (!migration) return { ok: false, missingFromVersion: version };
            path.push(migration);
        }
        return { ok: true, migrations: path };
    }
}
