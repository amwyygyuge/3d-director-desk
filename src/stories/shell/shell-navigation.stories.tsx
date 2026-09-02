import type { Meta, StoryObj } from "@storybook/react-vite";

import { SHORTCUT_SPECS } from "@/shortcuts/builtinShortcuts";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, waitRuntime } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "壳层/导航与快捷键", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const SEED_MODEL_IDS = ["nav-model-a", "nav-model-b", "nav-model-c"] as const;

const CHECKLIST = [
    "⌘K 打开「视角与元素导航」:按名称搜对象/机位,回车聚焦跳转",
    "选中对象按 F 聚焦;Home 取景全部对象;` 切换导演/镜头视角",
    "WASD+QE 飞行(飞行期画面持续渲染,松手回 demand)",
    "Shift+/ 打开快捷键速查;Esc 逐层退出面板/选中/预览",
] as const;

async function seedShellNavigation(stores: DirectorDeskStores): Promise<void> {
    for (const id of SEED_MODEL_IDS) placeModel(stores, TEST_ASSETS.helmet, { id });
    // view.frame 需要可度量的包围盒:模型加载期会被「存在未就绪对象」拒绝,等运行时就绪再取景
    for (const id of SEED_MODEL_IDS) await waitRuntime(stores, id);

    // 视角命令与快捷键注册表
    dispatchOk(stores, "view.frame", {});
    dispatchOk(stores, "view.reset", {});
    assertAcceptance(SHORTCUT_SPECS.length > 0, "快捷键注册表为空");

    // ⌘K 面板与帮助浮层的开合(瞬时 UI 态,不经命令层)
    stores.ui.setPaletteOpen(true);
    assertAcceptance(stores.ui.paletteOpen, "命令面板未打开");
    stores.ui.setPaletteOpen(false);
    assertAcceptance(!stores.ui.paletteOpen, "命令面板未关闭");
    stores.ui.toggleHelp();
    assertAcceptance(stores.ui.helpOpen, "帮助浮层未打开");
    stores.ui.toggleHelp();
    assertAcceptance(!stores.ui.helpOpen, "帮助浮层未关闭");
}

/** 面板开合与视角命令已在播种断言;手动走查快捷键全表 */
export const ShellNavigation: Story = {
    name: "命令面板与快捷键",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedShellNavigation(stores)} />
            <AcceptancePanel task="壳层 · 导航与快捷键" items={CHECKLIST} />
        </div>
    ),
};
