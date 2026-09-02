import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { placeModel, seedShots, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta = { title: "镜头/基础机位" };
export default meta;

const CHECKLIST = [
    "预置两个机位;点机位切入:画幅框+三分格 overlay 出现,轨道拖拽锁死",
    "回导演视角乱拖 → 再切回机位:构图精确还原",
    "「当前视角存为机位」→ 新增进列表;删除激活机位自动回导演视角",
    "选中狐狸 → 景别下拉逐档(大远景~大特写):自动生成并激活新机位",
    "激活机位后拖 FOV 滑杆实时生效;非法值被命令层拦截(0/200/NaN)",
] as const;

/** 预置狐狸 + 两个机位 */
export const CameraShots: StoryObj = {
    name: "机位与景别",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    placeModel(stores, TEST_ASSETS.fox);
                    seedShots(stores);
                }}
            />
            <AcceptancePanel task="镜头 · 基础机位" items={CHECKLIST} />
        </div>
    ),
};
