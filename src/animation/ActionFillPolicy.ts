import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

/**
 * 时段填充策略:排期时长与 clip 原生时长不等时,如何把 clip 铺满这段时间。
 *
 * 这三者原先被压在 `loopMode` 一个字段里,导致「拉长段条」只有一种结果——变慢放。
 * 拆开的判据是它们回答不同的问题:`loopMode` 说的是**资产的天然语义**
 * (走路可无缝接续 / 倒地只发生一次),填充策略说的是**这一段演出想怎么占时间**。
 * 同一段 `Walk_Loop` 既可以走得更久(repeat),也可以刻意放慢(stretch)。
 */
export const ACTION_FILL_POLICY = {
    /**
     * 按 clip 原速重复播放,时长不足处从头接续。
     *
     * 循环类动作的默认:拉长一段走路的自然预期是「走更久」,而不是「慢慢迈一步」。
     * 相位取 `offset % clipDuration`——纯函数,与 setStridePhaseFor 同一套算法,
     * scrub/倒放/跳帧都精确复现同一帧。
     */
    REPEAT: "repeat",
    /**
     * 按 clip 原速播一次,播完钳住末帧直到时段结束。
     *
     * 一次性动作的默认:倒地、受击、取物都只发生一次,多出来的时间该保持终态,
     * 而不是把动作拉慢到填满(那会让「摔倒」变成「缓缓躺下」)。
     */
    HOLD: "hold",
    /**
     * 拉伸/压缩 clip 铺满整个时段,即变速播放。
     *
     * 慢动作与快动作的唯一正当入口。曾是全部动作的隐式行为,现在必须显式选择。
     */
    STRETCH: "stretch",
} as const;
export type ActionFillPolicy = (typeof ACTION_FILL_POLICY)[keyof typeof ACTION_FILL_POLICY];

const FILL_POLICIES: readonly string[] = Object.values(ACTION_FILL_POLICY);

export function isActionFillPolicy(value: unknown): value is ActionFillPolicy {
    return typeof value === "string" && FILL_POLICIES.includes(value);
}

/**
 * 资产的循环语义 → 默认填充策略。
 *
 * 作者没有显式选择时的落点:资产声明 loop 说明它能无缝接续,故默认 repeat;
 * once 说明它只发生一次,故默认 hold。两者都不默认 stretch——变速必须是主动选择。
 */
export function defaultFillPolicyFor(loopMode: ActionLoopMode): ActionFillPolicy {
    return loopMode === ACTION_LOOP_MODE.LOOP ? ACTION_FILL_POLICY.REPEAT : ACTION_FILL_POLICY.HOLD;
}

/**
 * 时段内的经过时间 → clip 局部时刻。
 *
 * `null` = 该时刻不应由本段驱动(仅 hold 在回收结束后出现,骨骼交还常驻姿势)。
 * 三条分支都是**纯函数**:不积累状态,故 scrub、倒放、跳帧复现同一帧。
 */
export function clipTimeFor({
    policy,
    offsetSeconds,
    segmentDurationSeconds,
    clipDurationSeconds,
}: {
    readonly policy: ActionFillPolicy;
    readonly offsetSeconds: number;
    readonly segmentDurationSeconds: number;
    readonly clipDurationSeconds: number;
}): number {
    if (policy === ACTION_FILL_POLICY.STRETCH) {
        return segmentDurationSeconds === 0
            ? 0
            : Math.min(offsetSeconds / segmentDurationSeconds, 1) * clipDurationSeconds;
    }
    if (policy === ACTION_FILL_POLICY.REPEAT) {
        return clipDurationSeconds === 0 ? 0 : offsetSeconds % clipDurationSeconds;
    }
    return Math.min(offsetSeconds, clipDurationSeconds);
}
