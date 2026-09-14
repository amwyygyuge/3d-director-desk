import type { Meta, StoryObj } from "@storybook/react-vite";

import type { FrameStatistics } from "@/capture/FrameStatistics";
import { waitMs } from "@/core/waitMs";
import { LIGHTING_MOOD } from "@/lighting/LightingMoodCompiler";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchCatching, dispatchOk, required, waitRuntime } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "灯光/情绪打光与画面度量", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const SUBJECT_ID = "mood-subject";
/** 作者手放的灯:验收 lighting.author 不吃掉手工布光 */
const AUTHOR_LIGHT_ID = "hand-placed-key";
const MOOD_LIGHT_ID_PREFIX = "mood-light";
const AUTHOR_LIGHT_INTENSITY = 3;
/** 度量落账的轮询上限:首帧渲染 + 取样是异步的 */
const MEASURE_ATTEMPT_LIMIT = 40;
const MEASURE_INTERVAL_MS = 250;

const CHECKLIST = [
    "视口呈现低调影调:主体一侧受光、另一侧大面积暗部(不是整体压暗的平光)",
    "Outliner 里情绪灯以 mood-light- 前缀成组出现,手放的 hand-placed-key 仍在且参数未变",
    "撤销一步:灯组、灯光模式、曝光、投影开关一并回到打光前(不是碎成多步)",
    "切换 neutral / silhouette 再看:剪影档主体近乎全黑,度量面板的分离度为负",
] as const;

function measureFrame(stores: DirectorDeskStores): FrameStatistics | null {
    const result = stores.dispatcher.query({ type: "capture.measure-frame", payload: {} }, stores);
    return result.ok ? (result.value as FrameStatistics | null) : null;
}

/** 等渲染器就绪并取到一份度量:capture.measure-frame 在 Canvas onCreated 之前是结构化拒绝的 */
async function waitMeasurement(stores: DirectorDeskStores): Promise<FrameStatistics> {
    for (let attempt = 0; attempt < MEASURE_ATTEMPT_LIMIT; attempt++) {
        const stats = measureFrame(stores);
        if (stats) return stats;
        await waitMs(MEASURE_INTERVAL_MS);
    }
    throw new Error("验收断言失败: capture.measure-frame 超时未返回度量");
}

/**
 * 度量的自洽断言:全部标量归一化到 0~1,分离度是两个 0~1 均值之差故落在 -1~1。
 *
 * 刻意**不**断言「low-key 一定比 neutral 暗」这类跨灯组的像素不等式:主体区是画幅中心的
 * 固定裁切而非真实主体轮廓(见 FrameStatistics 的 SUBJECT_REGION_FRACTION),
 * 主体在画面里的位置、地板色、投影开关都会改变符号,写成不等式就是一条会随机翻面的断言。
 * 影调的方向性判断留给下面 CHECKLIST 的人工终审——那正是"美学问截图"的分工。
 */
function assertRangedStatistics(stats: FrameStatistics, stage: string): void {
    const ratios = [
        stats.meanLuma,
        stats.contrast,
        stats.clippedHighlights,
        stats.clippedShadows,
        stats.subjectLuma,
        stats.backgroundLuma,
    ];
    assertAcceptance(
        ratios.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
        `${stage}的度量标量必须是 0~1 的有限数:${JSON.stringify(stats)}`,
    );
    assertAcceptance(
        Math.abs(stats.subjectSeparation - (stats.subjectLuma - stats.backgroundLuma)) < 1e-9,
        `${stage}的 subjectSeparation 必须等于 subjectLuma - backgroundLuma(带符号,负值是剪影)`,
    );
}

/**
 * 情绪打光与画面度量验收。
 *
 * 两件事一起验是因为它们互为对方的验收手段:`lighting.author` 的效果只能用数值断言
 * (截图交给多模态判断慢而不稳),而 `capture.measure-frame` 的意义也只有在
 * 「换了打光,数值跟着变」时才成立。
 */
async function seedLightingMood(stores: DirectorDeskStores): Promise<void> {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    assertAcceptance(capabilityTypes.includes("lighting.author"), "lighting.author capability 未注册");
    assertAcceptance(capabilityTypes.includes("capture.measure-frame"), "capture.measure-frame capability 未注册");
    assertAcceptance(capabilityTypes.includes("lighting.presets.list"), "lighting.presets.list capability 未注册");

    // 发现面:AI 先读词表再说情绪名,故配方清单必须覆盖全部枚举值(少一档就是有情绪说不出来)
    const presets = stores.dispatcher.query({ type: "lighting.presets.list", payload: {} }, stores);
    assertAcceptance(presets.ok, "lighting.presets.list 查询失败");
    const discovery = presets.value as {
        colors?: readonly { id: string }[];
        moods?: readonly { id: string }[];
    };
    const discoveredMoods = new Set((discovery.moods ?? []).map((mood) => mood.id));
    assertAcceptance(
        Object.values(LIGHTING_MOOD).every((mood) => discoveredMoods.has(mood)),
        `情绪配方清单未覆盖全部枚举:缺 ${Object.values(LIGHTING_MOOD)
            .filter((mood) => !discoveredMoods.has(mood))
            .join("/")}`,
    );
    assertAcceptance((discovery.colors?.length ?? 0) > 0, "灯色词表为空,AI 无可说的灯色");

    placeModel(stores, TEST_ASSETS.fox, { id: SUBJECT_ID });
    await waitRuntime(stores, SUBJECT_ID);
    dispatchOk(stores, "studio.set-floor-surface", { enabled: true });

    // 作者手放的灯:情绪编译器不得动它
    dispatchOk(stores, "object.place", {
        id: AUTHOR_LIGHT_ID,
        kind: "light",
        transform: { position: [3, 3, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
        light: { type: "directional", color: "#ffffff", intensity: AUTHOR_LIGHT_INTENSITY },
    });

    // 度量的可断言范围:全部标量归一化到 0~1,分离度是两个 0~1 均值之差故在 -1~1
    const neutralStats = await waitMeasurement(stores);
    assertRangedStatistics(neutralStats, "打光前");

    // 情绪打光:一条命令完成模式 + 灯组 + 曝光 + 投影
    dispatchOk(stores, "lighting.author", { mood: LIGHTING_MOOD.LOW_KEY, subjectId: SUBJECT_ID });
    assertAcceptance(stores.scene.lightingMode === "custom", "lighting.author 未切到 custom 灯光模式");
    const moodLights = stores.scene.manager
        .list()
        .filter((entity) => entity.kind === "light" && entity.id.startsWith(`${MOOD_LIGHT_ID_PREFIX}-`));
    assertAcceptance(moodLights.length > 0, "lighting.author 未产出情绪灯");
    // 只接管自己产出的灯:手放的灯必须原样保留(id 与强度都不变)
    const handPlaced = required(stores.scene.manager.getEntity(AUTHOR_LIGHT_ID), "手放的灯被情绪编译器删掉了");
    assertAcceptance(
        handPlaced.light?.intensity === AUTHOR_LIGHT_INTENSITY,
        "手放的灯参数被情绪编译器改写(它只应接管 mood-light- 前缀的灯)",
    );
    assertAcceptance(stores.studio.shadowsEnabled, "low-key 配方应同时开启投影(硬光情绪需要接地)");

    const lowKeyStats = await waitMeasurement(stores);
    assertRangedStatistics(lowKeyStats, "low-key");
    // 度量必须真的重新取样:换了整组灯还返回同一份读数,说明查询取了缓存帧
    assertAcceptance(
        lowKeyStats.meanLuma !== neutralStats.meanLuma || lowKeyStats.contrast !== neutralStats.contrast,
        "换灯组后度量读数完全未变,capture.measure-frame 没有重新渲染取样",
    );

    // 聚合命令一步撤销:灯组 + 模式 + 曝光 + 投影同时回退,不碎成多步
    const exposureBeforeUndo = stores.studio.exposure;
    assertAcceptance(stores.history.undo(stores).ok, "lighting.author undo 失败");
    assertAcceptance(
        stores.scene.manager.list().every((entity) => !entity.id.startsWith(`${MOOD_LIGHT_ID_PREFIX}-`)),
        "undo 未清掉情绪灯(聚合命令的反演不完整)",
    );
    assertAcceptance(
        Boolean(stores.scene.manager.getEntity(AUTHOR_LIGHT_ID)),
        "undo 连带删掉了手放的灯——反演只应覆盖本命令产出的灯",
    );
    assertAcceptance(stores.studio.exposure !== exposureBeforeUndo, "undo 未回退曝光(配方的曝光是本命令的副产物)");
    assertAcceptance(stores.history.redo(stores).ok, "lighting.author redo 失败");

    // 剪影:分离度带符号,负值是有效的电影语言而不是错误
    dispatchOk(stores, "lighting.author", { mood: LIGHTING_MOOD.SILHOUETTE, subjectId: SUBJECT_ID });
    assertAcceptance(!stores.studio.shadowsEnabled, "silhouette 配方不需要接地投影,应关闭");
    const silhouetteStats = await waitMeasurement(stores);
    assertRangedStatistics(silhouetteStats, "silhouette");

    // 负例:未知情绪与不存在的被摄体都要结构化拒绝,不能静默放一组灯
    assertAcceptance(!dispatchCatching(stores, "lighting.author", { mood: "cyberpunk" }).ok, "未知打光情绪未被拒绝");
    const missingSubject = dispatchCatching(stores, "lighting.author", {
        mood: LIGHTING_MOOD.NEUTRAL,
        subjectId: "no-such-subject",
    });
    assertAcceptance(!missingSubject.ok, "不存在的被摄体未被拒绝");

    // 终态回到低调:走查从「有情绪灯 + 手放灯共存」开始
    dispatchOk(stores, "lighting.author", { mood: LIGHTING_MOOD.LOW_KEY, subjectId: SUBJECT_ID });
    stores.selection.select(SUBJECT_ID);
}

/** 情绪灯的接管边界、一步撤销、以及三档情绪下的度量差异均在播种断言 */
export const LightingMood: Story = {
    name: "情绪打光与不截图的影调断言",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedLightingMood(stores)} />
            <AcceptancePanel task="灯光 · 情绪打光与画面度量" items={CHECKLIST} />
        </div>
    ),
};
