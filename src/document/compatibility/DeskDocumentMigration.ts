import type { CommandIssue } from "@/command/DirectorCommand";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";

/**
 * 工程文档兼容领域的契约。
 *
 * 版本边界纪律:`DeskDocument.version` 只描述「持久化工程 JSON 的结构与语义」,
 * 与 npm 包版本、宿主协议版本(`PROTOCOL_VERSION`)、命令能力契约版本、资产目录版本
 * 各自独立演进,永不复用——混用会让「工程打不开」失去可定位性。
 *
 * 迁移方向纪律:只支持「历史工程 → 当前版本」单向升级。
 * 旧客户端读新工程只能丢字段或伪造语义,那不是兼容而是静默损坏。
 */

/**
 * 已正式发布过的最低文档版本;此版本起承诺永久可迁入当前版本。
 *
 * 当前 = `DESK_DOCUMENT_VERSION`:功能尚未发布,不存在需要承诺的历史存档,
 * 因此注册表出厂为空,v15 之前的实验版本一律判不支持(零兼容纪律不变)。
 * 首个正式发布时把本常量**冻结**为那一刻的版本号,此后不再跟随当前版本移动——
 * 它一动,已发布存档的支持承诺就悄悄失效了。
 */
export const MINIMUM_SUPPORTED_DESK_DOCUMENT_VERSION = DESK_DOCUMENT_VERSION;

export const DOCUMENT_COMPATIBILITY_ISSUE_CODE = {
    /** 信封无效:不是对象,或 version 缺失/非正整数。 */
    INVALID_ENVELOPE: "document-envelope-invalid",
    /** 早于承诺支持区间(发布前的实验版本)。 */
    VERSION_TOO_OLD: "document-version-too-old",
    /** 来自更高版本客户端,当前版本无法保证不丢语义。 */
    VERSION_TOO_NEW: "document-version-too-new",
    /** 注册表缺少某一段相邻迁移,链路断裂。 */
    MIGRATION_PATH_MISSING: "document-migration-path-missing",
    /** 该版本迁移器不认识的历史结构。 */
    MIGRATION_SOURCE_INVALID: "document-migration-source-invalid",
    /** 历史文档从未表达过新模型必需的语义,不允许编造默认值。 */
    MIGRATION_SEMANTICS_UNRECOVERABLE: "document-migration-semantics-unrecoverable",
} as const;

export type DocumentCompatibilityIssueCode =
    (typeof DOCUMENT_COMPATIBILITY_ISSUE_CODE)[keyof typeof DOCUMENT_COMPATIBILITY_ISSUE_CODE];

export const DOCUMENT_COMPATIBILITY_PATH = {
    DOCUMENT: "document",
    VERSION: "version",
} as const;

/** 迁移失败一律收敛为结构化 issue:宿主与 AI 据此决定下一步,不接触原始异常。 */
export type DocumentMigrationResult =
    { readonly ok: true; readonly document: unknown } | { readonly ok: false; readonly issue: CommandIssue };

/**
 * 单条相邻版本迁移策略(纯数据转换)。
 *
 * 实现约束:
 * - 只跨一个版本边界(`toVersion === fromVersion + 1`),`v15 → v18` 由注册表串联相邻迁移完成;
 * - 不得修改入参(调用方持有的历史文档必须保持可复现);
 * - 输出必须是可 JSON 往返的纯数据,且 `version` 等于 `toVersion`;
 * - 不得读取 MobX store、Three 运行时或 DOM;
 * - 只允许补「有确定历史含义」的默认值;新模型需要历史文档从未表达的信息时,
 *   必须返回 `MIGRATION_SEMANTICS_UNRECOVERABLE`,不得编造用户意图。
 */
export interface DeskDocumentMigration {
    readonly fromVersion: number;
    readonly toVersion: number;

    migrate(source: unknown): DocumentMigrationResult;
}

export function compatibilityIssue(
    code: DocumentCompatibilityIssueCode,
    message: string,
    path: string = DOCUMENT_COMPATIBILITY_PATH.VERSION,
): CommandIssue {
    return { code, path, message };
}

/**
 * 信封读取:兼容层在迁移前唯一允许解释的字段。
 * 其余字段的语义归各版本迁移器与当前领域模型,绝不在此处提前判断。
 */
export function readDocumentVersion(document: unknown): number | null {
    if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
    const { version } = document as { readonly version?: unknown };
    return typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? version : null;
}
