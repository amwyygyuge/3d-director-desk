import CloseIcon from "@mui/icons-material/Close";
import RemoveIcon from "@mui/icons-material/Remove";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";

const meta: Meta<typeof DirectorDesk> = {
    title: "壳层/宿主接入与尺寸",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/** 模拟 Monet 节点嵌入的固定尺寸(走查 width/height prop 与小尺寸下壳层排布;充满容器的缺省形态见「场景/场景画布」) */
const NODE_SIZE = { WIDTH_PX: 1080, HEIGHT_PX: 640 } as const;
const STAGE_STYLE = {
    alignItems: "center",
    background: "#0a0a0b",
    display: "flex",
    height: "100vh",
    justifyContent: "center",
    width: "100vw",
} as const;

/**
 * 宿主壳层呈现定制走查(Monet 接入验收 R1/R3):
 * - 截图/录制保持图标按钮，tooltip 使用宿主语义;
 * - 最右扩展位排在项目菜单左侧，项目菜单始终贴右;
 * - width/height 固定尺寸(模拟 Monet 节点嵌入);
 * - initialGridSizeMeters 把参考地板初始化为 24m(对照「场景/场景画布」的默认 12m;运行期由项目菜单滑杆接管)。
 */
export const HostPresentation: Story = {
    name: "宿主定制与尺寸",
    render: () => (
        <div style={STAGE_STYLE}>
            <DirectorDesk
                height={NODE_SIZE.HEIGHT_PX}
                width={NODE_SIZE.WIDTH_PX}
                initialGridSizeMeters={24}
                presentation={{
                    captureImage: { label: "截图到画布", tooltip: "截图并添加到画布" },
                    captureVideo: { label: "录制到画布", tooltip: "录制并添加到画布" },
                    trailingExtensions: [
                        {
                            key: "minimize-node",
                            icon: <RemoveIcon fontSize="small" />,
                            tooltip: "缩小节点",
                            onClick: () => console.info("[story] 缩小节点(宿主接管)"),
                        },
                        {
                            key: "close-node",
                            icon: <CloseIcon fontSize="small" />,
                            tooltip: "关闭节点",
                            onClick: () => console.info("[story] 关闭节点(宿主接管)"),
                        },
                    ],
                }}
            />
        </div>
    ),
};
