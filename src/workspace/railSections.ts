import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { SvgIconComponent } from "@mui/icons-material";

/**
 * 左侧资产中枢的分区(方案 D 抽屉式资产栏)。
 *
 * 分区只是面板的编排索引:不改变选中、视角或场景数据,也不门控任何领域行为——
 * 这正是它取代旧 `WorkspaceStage` 的原因(旧阶段既管显隐又管 Program 回放绑定,
 * 两个职责耦在一个枚举里;Program 回放已归位到 WorkbenchLayoutStore.presentationMode)。
 */
export const RAIL_SECTION = {
    OUTLINE: "outline",
    ASSETS: "assets",
    CAMERA: "camera",
    LIGHT: "light",
} as const;
export type RailSection = (typeof RAIL_SECTION)[keyof typeof RAIL_SECTION];

export interface RailSectionDef {
    readonly label: string;
    readonly icon: SvgIconComponent;
}

export const RAIL_SECTION_ORDER: readonly RailSection[] = [
    RAIL_SECTION.OUTLINE,
    RAIL_SECTION.ASSETS,
    RAIL_SECTION.CAMERA,
    RAIL_SECTION.LIGHT,
];

export const RAIL_SECTION_DEFS: Record<RailSection, RailSectionDef> = {
    [RAIL_SECTION.OUTLINE]: { label: "资源大纲", icon: AccountTreeIcon },
    [RAIL_SECTION.ASSETS]: { label: "模型资产", icon: ViewInArIcon },
    [RAIL_SECTION.CAMERA]: { label: "机位与运镜", icon: VideocamIcon },
    [RAIL_SECTION.LIGHT]: { label: "灯光环境", icon: LightbulbIcon },
};
