import type { CommandResult } from "@/command/DirectorCommand";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 只需要通知通道的最小依赖:调用方传整份 stores 即可满足。 */
type NoticeSink = Pick<DirectorDeskStores, "ui">;

type CommandFailure = Exclude<CommandResult, { readonly ok: true }>;

/**
 * 失败文案:结构化 issue 优先,并把 `options` 的可选项一并说出来——
 * 命令层给的是「换个方案」而不是「不行」,提示不该把这条信息吞掉。
 */
export function commandFailureMessage(result: CommandFailure): string {
    const details = result.issueDetails
        ?.flatMap((issue) => [issue.message, ...(issue.options?.map((option) => option.label) ?? [])])
        .join(";");
    return details || result.issues?.join(";") || result.error;
}

/**
 * 命令失败的统一落点,永不静默。
 * 五处面板曾各写一份同样的判断(Rule of Two),收敛在此,提示口径不再分叉。
 */
export function reportCommandFailure(stores: NoticeSink, result: CommandResult): void {
    if (result.ok) return;
    stores.ui.setApplicationNotice(commandFailureMessage(result));
}
