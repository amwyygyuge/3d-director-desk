import type { Meta, StoryObj } from "@storybook/react-vite";

import { ACTION_FILL_POLICY } from "@/animation/ActionFillPolicy";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import { provisionAction } from "@/command/actionProvisioning";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchCatching, dispatchOk, required, waitRuntime } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "时间轴/动作填充策略", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const FOX_ID = "fill-policy-fox";
const FOX_CLIP_NAME = "Survey";
const TIMELINE_DURATION_SECONDS = 20;
/** 段时长刻意远大于 clip 原生时长:三档策略只有在「时段比 clip 长」时才有可观测差异 */
const SEGMENT_DURATION_SECONDS = 12;
const SEGMENT_START_SECONDS = 1;
const SHORTENED_DURATION_SECONDS = 10;
const SAMPLE_EPSILON_SECONDS = 1e-6;
const FRAME_TOLERANCE_SECONDS = 0.01;

const CHECKLIST = [
    "选中时间轴上的动作段条:操作条出现「跟随资产 / 重复 / 保持 / 拉伸」四态,当前态高亮",
    "点「重复」后拉长段条:动作原速演更久(不是慢放);点「拉伸」再拉长:同一动作明显变慢",
    "点「保持」:动作播一次后停在末帧,余下时段保持终态",
    "点「跟随资产」:回到缺省态,loop 资产表现同重复(策略与时段互不干扰已由播种断言)",
] as const;

/**
 * 时段填充策略验收:三档策略 + 「跟随资产」第四态的采样差异、撤销回放、与 set-range 的正交性。
 *
 * 断言口径是 `clipTimeAt` 的返回值而不是画面——填充策略是纯函数(相位取模 / 钳末帧 / 线性映射),
 * 故可在不渲染的前提下证伪。截图只能说明「动了」,说明不了「按哪档铺的」。
 */
async function seedFillPolicy(stores: DirectorDeskStores): Promise<void> {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    assertAcceptance(capabilityTypes.includes("action.set-fill-policy"), "action.set-fill-policy capability 未注册");

    placeModel(stores, TEST_ASSETS.fox, { id: FOX_ID });
    await waitRuntime(stores, FOX_ID);

    dispatchOk(stores, "timeline.set-duration", { duration: TIMELINE_DURATION_SECONDS });
    const action = await provisionAction(stores, {
        name: `狐狸#${FOX_CLIP_NAME}`,
        url: TEST_ASSETS.fox,
        clipName: FOX_CLIP_NAME,
        loopMode: ACTION_LOOP_MODE.LOOP,
    });
    dispatchOk(stores, "action.mount", {
        objectId: FOX_ID,
        actionId: action.id,
        startTimeSeconds: SEGMENT_START_SECONDS,
        durationSeconds: SEGMENT_DURATION_SECONDS,
    });

    const clipDurationSeconds = action.duration;
    assertAcceptance(
        clipDurationSeconds > 0 && clipDurationSeconds < SEGMENT_DURATION_SECONDS,
        `验收前提不成立:clip 时长 ${clipDurationSeconds}s 必须短于段时长 ${SEGMENT_DURATION_SECONDS}s`,
    );

    const currentPerformance = (): ActionPerformance =>
        required(stores.scene.manager.getEntity(FOX_ID)?.actionPerformances[0], "动作排期段未落账");
    /** 段内某时刻的 clip 局部时刻;null = 本段不驱动骨骼(仅 hold 回收后出现) */
    const sampleAt = (timeSeconds: number): number | null =>
        currentPerformance().clipTimeAt(timeSeconds, clipDurationSeconds, ACTION_LOOP_MODE.LOOP);
    const sampleValueAt = (timeSeconds: number, message: string): number =>
        required(sampleAt(timeSeconds) ?? undefined, message);

    const seeded = currentPerformance();
    assertAcceptance(seeded.fillPolicy === null, "action.mount 缺省应落「跟随资产」(null),而非某个具体策略");

    // 采样点取段尾:此处三档策略的 clip 局部时刻必然不同,是最强的可证伪点
    const tailSeconds = SEGMENT_START_SECONDS + SEGMENT_DURATION_SECONDS - SAMPLE_EPSILON_SECONDS;
    const followedTail = sampleValueAt(tailSeconds, "「跟随资产」段尾采样为空");

    // 「跟随资产」+ loop 资产 == repeat:第四态不是别名,但对 loop 资产按 defaultFillPolicyFor 推同一档
    dispatchOk(stores, "action.set-fill-policy", {
        objectId: FOX_ID,
        performanceId: seeded.id,
        fillPolicy: ACTION_FILL_POLICY.REPEAT,
    });
    assertAcceptance(currentPerformance().fillPolicy === ACTION_FILL_POLICY.REPEAT, "repeat 未落账");
    const repeatTail = sampleValueAt(tailSeconds, "repeat 段尾采样为空");
    assertAcceptance(
        Math.abs(repeatTail - followedTail) < SAMPLE_EPSILON_SECONDS,
        "loop 资产下「跟随资产」与 repeat 的采样应一致(默认推导走 defaultFillPolicyFor)",
    );
    // repeat = 原速重复:段尾的 clip 局部时刻取模落在一个周期内,而不是被拉到 clip 末端
    assertAcceptance(
        repeatTail >= 0 && repeatTail < clipDurationSeconds,
        `repeat 段尾应取模落在 [0, ${clipDurationSeconds}) 内,实得 ${repeatTail}`,
    );

    // stretch = 变速铺满:段尾必须正好是 clip 末端(整段被线性映射)
    dispatchOk(stores, "action.set-fill-policy", {
        objectId: FOX_ID,
        performanceId: seeded.id,
        fillPolicy: ACTION_FILL_POLICY.STRETCH,
    });
    const stretchTail = sampleValueAt(tailSeconds, "stretch 段尾采样为空");
    assertAcceptance(
        Math.abs(stretchTail - clipDurationSeconds) < FRAME_TOLERANCE_SECONDS,
        `stretch 段尾应逼近 clip 末端 ${clipDurationSeconds},实得 ${stretchTail}`,
    );
    // 同一时刻两档策略取到不同帧:这就是「拉长段条 ≠ 慢放」的可执行证据
    assertAcceptance(
        Math.abs(stretchTail - repeatTail) > FRAME_TOLERANCE_SECONDS,
        "repeat 与 stretch 在段尾取到同一帧,策略未生效",
    );

    // hold = 播一次后钳末帧,回收结束后交还骨骼(返回 null)
    dispatchOk(stores, "action.set-fill-policy", {
        objectId: FOX_ID,
        performanceId: seeded.id,
        fillPolicy: ACTION_FILL_POLICY.HOLD,
    });
    const heldTail = sampleValueAt(tailSeconds, "hold 在 clip 播完后应钳住末帧而非交还骨骼");
    assertAcceptance(
        Math.abs(heldTail - clipDurationSeconds) < SAMPLE_EPSILON_SECONDS,
        `hold 播完后应钳在 clip 末端,实得 ${heldTail}`,
    );
    assertAcceptance(
        sampleAt(currentPerformance().releaseEndTimeSeconds + FRAME_TOLERANCE_SECONDS) === null,
        "hold 在回收结束后应交还骨骼(返回 null)",
    );

    // 撤销回放:策略是可撤销的领域写入,逆命令带 performanceId 精确回退到上一档
    assertAcceptance(stores.history.undo(stores).ok, "填充策略 undo 失败");
    assertAcceptance(
        currentPerformance().fillPolicy === ACTION_FILL_POLICY.STRETCH,
        "undo 未回到上一档策略(逆命令未按段回放)",
    );
    assertAcceptance(stores.history.redo(stores).ok, "填充策略 redo 失败");
    assertAcceptance(currentPerformance().fillPolicy === ACTION_FILL_POLICY.HOLD, "redo 未恢复 hold");

    // 与 set-range 正交:改时段不得顺带改填充策略(作者选的铺法应当留存)
    dispatchOk(stores, "action.set-range", {
        objectId: FOX_ID,
        performanceId: seeded.id,
        startTimeSeconds: SEGMENT_START_SECONDS,
        durationSeconds: SHORTENED_DURATION_SECONDS,
    });
    assertAcceptance(currentPerformance().fillPolicy === ACTION_FILL_POLICY.HOLD, "action.set-range 擦掉了填充策略");
    assertAcceptance(
        currentPerformance().durationSeconds === SHORTENED_DURATION_SECONDS,
        "action.set-range 未改到时段(前一条断言失去意义)",
    );

    // 负例:未知策略被结构化拒绝;不存在的段 id 报 action-performance-not-found
    assertAcceptance(
        !dispatchCatching(stores, "action.set-fill-policy", {
            objectId: FOX_ID,
            performanceId: seeded.id,
            fillPolicy: "slow-motion",
        }).ok,
        "未知填充策略未被拒绝",
    );
    const missingSegment = dispatchCatching(stores, "action.set-fill-policy", {
        objectId: FOX_ID,
        performanceId: "no-such-performance",
        fillPolicy: ACTION_FILL_POLICY.REPEAT,
    });
    assertAcceptance(
        !missingSegment.ok && (missingSegment.issues?.[0]?.includes("action-performance-not-found") ?? false),
        "不存在的段 id 未返回 action-performance-not-found",
    );

    // 终态留在「跟随资产」:走查从四态里的缺省态开始;null 是有效值,必须能被显式写回
    dispatchOk(stores, "action.set-fill-policy", { objectId: FOX_ID, performanceId: seeded.id, fillPolicy: null });
    assertAcceptance(currentPerformance().fillPolicy === null, "「跟随资产」(null)未能被显式写回");
    stores.selection.select(FOX_ID);
}

/** 三档策略的采样差异、「跟随资产」第四态、撤销回放与 set-range 正交性均在播种断言 */
export const ActionFillPolicy: Story = {
    name: "重复/保持/拉伸与跟随资产",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedFillPolicy(stores)} />
            <AcceptancePanel task="时间轴 · 动作填充策略" items={CHECKLIST} />
        </div>
    ),
};
