import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "输出/全屏预览", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const SUBJECT_ID = "presentation-subject";
const CLIP_DURATION_SECONDS = 3;

const CHECKLIST = [
    "点工具条「全屏预览」:壳层全隐,Program 从头播放;Esc 或右上「预览中」按钮退出",
    "空 Program 时进入被拒(底部结构化提示)——已由播种断言",
    "预览是瞬态视图模式:不进撤销栈(⌘Z 列表无预览进出记录)",
    "预览中 Program 运镜接管视口相机;退出后编辑相机构图还原",
] as const;

function seedPresentationMode(stores: DirectorDeskStores): void {
    placeModel(stores, TEST_ASSETS.fox, { id: SUBJECT_ID });

    // 负例:空 Program 进入预览 → 结构化拒绝
    const rejected = stores.dispatcher.dispatch({ type: "desk.enter-presentation", payload: {} }, stores);
    assertAcceptance(!rejected.ok, "空 Program 进入预览应被拒绝");

    // 快速运镜一段造出 Program,再验证 进入 → 壳层隐藏 → 退出还原
    dispatchOk(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: CLIP_DURATION_SECONDS,
        degrees: 360,
        direction: "ccw",
    });
    assertAcceptance(stores.motion.program.clips.length === 1, "Program 未就位");

    dispatchOk(stores, "desk.enter-presentation", {});
    assertAcceptance(stores.layout.presentationMode, "未进入预览态");
    assertAcceptance(!stores.layout.authoringVisible, "预览期壳层未隐藏");

    dispatchOk(stores, "desk.exit-presentation", {});
    assertAcceptance(!stores.layout.presentationMode, "未退出预览态");
    assertAcceptance(stores.layout.authoringVisible, "退出后壳层未还原");
}

/** 进出预览的壳层显隐与空 Program 拒绝已在播种断言;手动走查 Program 接管与 Esc */
export const PresentationMode: Story = {
    name: "进入/退出预览",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedPresentationMode} />
            <AcceptancePanel task="输出 · 全屏预览" items={CHECKLIST} />
        </div>
    ),
};
