import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "../DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { importActionFromUrl, placeModel, TEST_ASSETS } from "./seeds";

const meta: Meta = { title: "验收/05 动作挂载" };
export default meta;

const CHECKLIST = [
    "选中左侧狐狸 → 右侧动作列表挂 Walk/Run → 播放/暂停/拖时间条",
    "狐狸在播动作时,选中右侧无骨骼头盔挂动作 → 结构化拒绝(bone-incompatible + 可用清单)",
    "暂停后静置:DevTools 看零渲染帧;拖动时间条立即成像",
    "两只狐狸各挂不同动作同时播放,互不干扰(每对象独立 mixer)",
] as const;

/** 预置狐狸(带骨骼)+ 头盔(无骨骼)+ 狐狸三段动作入库 */
export const MountActions: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    placeModel(stores, TEST_ASSETS.fox, [-2, 0, 0]);
                    placeModel(stores, TEST_ASSETS.helmet, [2, 0, 0]);
                    void importActionFromUrl(stores, TEST_ASSETS.fox, "fox.glb");
                }}
            />
            <AcceptancePanel task="05 · 动作挂载(狐狸×头盔)" items={CHECKLIST} />
        </div>
    ),
};
