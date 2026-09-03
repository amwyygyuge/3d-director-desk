import AccountTreeIcon from "@mui/icons-material/AccountTree";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { SvgIconComponent } from "@mui/icons-material";

/**
 * 左侧工作台导航的分区。
 *
 * 这正是它取代旧 `WorkspaceStage` 的原因(旧阶段既管显隐又管 Program 回放绑定,
 * 两个职责耦在一个枚举里;如今壳层由 WorkbenchLayoutStore.shellMode 编排,
 * Program 回放接管则收敛为 isProgramTakeover 派生语义)。
 */
export const WORKSPACE_SECTION = {
    OUTLINE: "outline",
    ASSETS: "assets",
    CAMERA: "camera",
    LIGHT: "light",
    REVIEW: "review",
} as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTION)[keyof typeof WORKSPACE_SECTION];

export interface WorkspaceSectionDef {
    /** 全称:无障碍名与需要完整语义的场合 */
    readonly label: string;
    readonly icon: SvgIconComponent;
}

export const WORKSPACE_SECTION_ORDER: readonly WorkspaceSection[] = [
    WORKSPACE_SECTION.OUTLINE,
    WORKSPACE_SECTION.ASSETS,
    WORKSPACE_SECTION.CAMERA,
    WORKSPACE_SECTION.LIGHT,
    WORKSPACE_SECTION.REVIEW,
];

export const WORKSPACE_SECTION_DEFS: Record<WorkspaceSection, WorkspaceSectionDef> = {
    [WORKSPACE_SECTION.OUTLINE]: { label: "资源大纲", icon: AccountTreeIcon },
    [WORKSPACE_SECTION.ASSETS]: { label: "模型资产", icon: ViewInArIcon },
    [WORKSPACE_SECTION.CAMERA]: { label: "机位与运镜", icon: VideocamIcon },
    [WORKSPACE_SECTION.LIGHT]: { label: "灯光环境", icon: LightbulbIcon },
    [WORKSPACE_SECTION.REVIEW]: { label: "成片巡检", icon: FactCheckIcon },
};
