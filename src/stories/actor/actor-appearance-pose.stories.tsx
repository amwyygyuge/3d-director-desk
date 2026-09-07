import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";

const meta: Meta = { title: "演员/形象与姿势" };
export default meta;

const HUMANOID_ASSET_ID = "builtin.humanoid-generic";
const SECOND_ACTOR_X = 1.2;

const CHECKLIST = [
    "「形象」tab 只在人偶上出现;放一只狐狸对比,它没有该 tab",
    "色板任选一色即时生效;质感切「微光」后高光变化明显(默认材质是全金属,不压金属度就看不出颜色)",
    "体型 chip「魁梧/矮壮」切换:身高、围度、肩宽同时变化,脚底始终贴地",
    "展开「微调」拖围度滑杆:拖拽期实时变形,松手才进撤销栈(⌘Z 一次回到拖拽前)",
    "收起「微调」后滑杆整块卸载(Elements 面板确认节点消失,不是 opacity:0)",
    "两个人偶分别上色:互不串色(实例材质克隆);删除其一后内存回落",
    "「常驻姿势」tab 两列:先点下半身「坐地」,再点上半身「抱臂/待机」,只换上半身不重选坐姿",
    "任何姿势切换后脚/臀贴地(骨骼度量贴地,包围盒对该 rig 不可信)",
    "精修骨骼后「存为我的姿势」→ 选部位保存 → 新条目出现在对应列,导出工程 JSON 里带 posePresets",
    "播放期间:体型与姿势按钮禁用/命令被拒(结构化提示),改颜色仍可用",
] as const;

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

/** 两个人偶:验证外观/体型的每实例隔离与姿势组合 */
export const TwoActors: StoryObj = {
    name: "形象/体型/姿势组合",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedActors} />
            <AcceptancePanel task="演员 · 形象与姿势(颜色/体型/组合)" items={CHECKLIST} />
        </div>
    ),
};
