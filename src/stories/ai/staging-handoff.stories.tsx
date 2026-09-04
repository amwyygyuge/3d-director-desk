import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";

const meta: Meta = { title: "AI/布景与交接" };
export default meta;

const HUMANOID_ASSET_ID = "builtin.humanoid-generic";
const SECOND_ACTOR_X = 1.4;

function seedActors(stores: DirectorDeskStores): void {
    stores.dispatcher.dispatch({ type: "assets.place", payload: { assetId: HUMANOID_ASSET_ID } }, stores);
    stores.dispatcher.dispatch(
        {
            type: "assets.place",
            payload: {
                assetId: HUMANOID_ASSET_ID,
                transform: { position: [SECOND_ACTOR_X, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        },
        stores,
    );
}

const CHECKLIST = [
    "两个人偶装载完成后,点选任一人偶 → 右栏检查器出现「布景」tab(不足两个人偶时该 tab 不显示)",
    "配方 chip 切「对峙」:下方出两行槽位 a/b,默认按场景顺序绑好两个人偶",
    "给槽位 a 选「姿势·坐地」、视线选「互瞪」,b 视线「互瞪」→ 点「应用布景」→ 两人对位互瞪、a 落坐,画面即时更新",
    "⌘Z 一次:站位+姿势+视线整组回到应用前(聚合命令一步撤销)",
    "拖「疏密」滑杆到更大 → 再「应用布景」:两人间距变宽;「平衡」滑杆偏移整体左右;🎲换一版 换一版抖动构图",
    "点「出 i2v 首帧」:画布短暂切中性灰着色并截一帧,产物停靠层出现缩略图(bundle 已封入 prompt 与被摄体身份)",
    "先给机位排出 Program 片段,再点「出 v2v 参考片」导出中性参考视频;Program 为空时结构化拒绝并提示先排机位",
] as const;

export const StagingToHandoff: StoryObj = {
    name: "布景表现力 → 视频模型交接",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedActors} />
            <AcceptancePanel task="AI 布景 · 姿态/视线/构图 + 交接产物" items={CHECKLIST} />
        </div>
    ),
};
