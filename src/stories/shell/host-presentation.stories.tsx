import AddToPhotosIcon from "@mui/icons-material/AddToPhotos";
import CloseIcon from "@mui/icons-material/Close";
import RemoveIcon from "@mui/icons-material/Remove";
import SaveIcon from "@mui/icons-material/Save";
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
 * 宿主壳层呈现定制走查(Monet 接入验收 R1/R2):
 * - 项目药丸显示宿主产品名;
 * - 截图/录制按钮带「到画布」可见文案与 tooltip;
 * - 扩展位落在采集区右侧,禁用态(保存模板)与可用态(从画布导入)并存;
 * - 最右扩展位(全屏预览右侧)承载宿主窗口控制类纯图标按钮(缩小/关闭节点);
 * - width/height 固定尺寸(模拟 Monet 节点嵌入);
 * - 对照「场景/场景画布」:默认形态保持纯图标与内置文案。
 */
export const HostPresentation: Story = {
    name: "宿主定制与尺寸",
    render: () => (
        <div style={STAGE_STYLE}>
            <DirectorDesk
                height={NODE_SIZE.HEIGHT_PX}
                width={NODE_SIZE.WIDTH_PX}
                presentation={{
                    productName: "Monet 导演台",
                    captureImage: { label: "截图到画布", tooltip: "截图并添加到画布" },
                    captureVideo: { label: "录制到画布", tooltip: "录制并添加到画布" },
                    toolbarExtensions: [
                        {
                            key: "import-from-canvas",
                            icon: <AddToPhotosIcon />,
                            label: "从画布导入",
                            onClick: () => console.info("[story] 从画布导入(宿主接管)"),
                        },
                        {
                            key: "save-template",
                            icon: <SaveIcon />,
                            label: "保存模板",
                            tooltip: "无可保存资产时禁用",
                            disabled: true,
                            onClick: () => console.info("[story] 不应触发:已禁用"),
                        },
                    ],
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
