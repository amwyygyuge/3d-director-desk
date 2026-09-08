import type { CommandIssue } from "@/command/DirectorCommand";
import {
    compatibilityIssue,
    DOCUMENT_COMPATIBILITY_ISSUE_CODE,
    DOCUMENT_COMPATIBILITY_PATH,
    MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION,
    readDocumentVersion,
} from "@/document/compatibility/DeskDocumentMigration";
import type { DeskDocumentMigration } from "@/document/compatibility/DeskDocumentMigration";
import type { DocumentMigrationRegistry } from "@/document/compatibility/DocumentMigrationRegistry";

/** 升级留痕:导入成功后宿主与验收据此确认「这份工程来自哪个历史版本」。 */
export interface DocumentMigrationReport {
    readonly sourceVersion: number;
    readonly targetVersion: number;
    /** 实际执行的相邻迁移边,按顺序;当前版本文档为空数组。 */
    readonly appliedSteps: readonly string[];
}

export type DocumentCompatibilityResult =
    | { readonly ok: true; readonly document: unknown; readonly report: DocumentMigrationReport }
    | { readonly ok: false; readonly issues: readonly CommandIssue[] };

/**
 * 工程文档兼容领域服务:把历史工程 JSON 单向升级到当前版本。
 *
 * 边界:不持有 MobX 状态、不接触 Three 运行时、不提交场景。
 * 失败时既不修改入参,也不触碰正在编辑的工程——原子性由 DocumentImportService 的提交阶段保证。
 *
 * 尚未发布时注册表为空,最低支持版本 = 当前版本,行为等价于原先的「版本不符即拒」;
 * 首个正式发布后每次 schema 变更补一条相邻迁移,导入路径无需改动。
 */
export class DocumentCompatibilityService {
    constructor(
        private readonly registry: DocumentMigrationRegistry,
        private readonly currentVersion: number,
        private readonly minimumSupportedVersion: number = MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION,
    ) {}

    prepare(document: unknown): DocumentCompatibilityResult {
        const sourceVersion = readDocumentVersion(document);
        if (sourceVersion === null) {
            return {
                ok: false,
                issues: [
                    compatibilityIssue(
                        DOCUMENT_COMPATIBILITY_ISSUE_CODE.INVALID_ENVELOPE,
                        "工程文档信封无效:缺少正整数 version 字段",
                        DOCUMENT_COMPATIBILITY_PATH.DOCUMENT,
                    ),
                ],
            };
        }
        if (sourceVersion > this.currentVersion) {
            return {
                ok: false,
                issues: [
                    compatibilityIssue(
                        DOCUMENT_COMPATIBILITY_ISSUE_CODE.VERSION_TOO_NEW,
                        `工程来自更高版本(v${sourceVersion} > 当前 v${this.currentVersion}),请升级导演台后再打开`,
                    ),
                ],
            };
        }
        if (sourceVersion < this.minimumSupportedVersion) {
            return {
                ok: false,
                issues: [
                    compatibilityIssue(
                        DOCUMENT_COMPATIBILITY_ISSUE_CODE.VERSION_TOO_OLD,
                        `工程版本 v${sourceVersion} 早于最低支持版本 v${this.minimumSupportedVersion},无法安全升级`,
                    ),
                ],
            };
        }
        const path = this.registry.resolvePath(sourceVersion, this.currentVersion);
        if (!path.ok) {
            return {
                ok: false,
                issues: [
                    compatibilityIssue(
                        DOCUMENT_COMPATIBILITY_ISSUE_CODE.MIGRATION_PATH_MISSING,
                        `缺少 v${path.missingFromVersion} → v${path.missingFromVersion + 1} 的文档迁移,无法升级到 v${this.currentVersion}`,
                    ),
                ],
            };
        }
        return this.applyPath(document, sourceVersion, path.migrations);
    }

    private applyPath(
        document: unknown,
        sourceVersion: number,
        migrations: readonly DeskDocumentMigration[],
    ): DocumentCompatibilityResult {
        const appliedSteps: string[] = [];
        let current = document;
        for (const migration of migrations) {
            const result = migration.migrate(current);
            if (!result.ok) return { ok: false, issues: [result.issue] };
            const producedVersion = readDocumentVersion(result.document);
            if (producedVersion !== migration.toVersion) {
                return {
                    ok: false,
                    issues: [
                        compatibilityIssue(
                            DOCUMENT_COMPATIBILITY_ISSUE_CODE.MIGRATION_SOURCE_INVALID,
                            `迁移 v${migration.fromVersion} → v${migration.toVersion} 产出的版本号为 ${String(producedVersion)},与声明不符`,
                        ),
                    ],
                };
            }
            current = result.document;
            appliedSteps.push(`v${migration.fromVersion}→v${migration.toVersion}`);
        }
        return {
            ok: true,
            document: current,
            report: { sourceVersion, targetVersion: this.currentVersion, appliedSteps },
        };
    }
}
