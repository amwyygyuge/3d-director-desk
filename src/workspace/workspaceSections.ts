import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { SvgIconComponent } from "@mui/icons-material";

/**
 * 左侧工作台导航的分区。
 *
 * 分区只是面板的编排索引:不改变选中、视角或场景数据,也不门控任何领域行为——
 * 这正是它取代旧 `WorkspaceStage` 的原因(旧阶段既管显隐又管 Program 回放绑定,
 * 两个职责耦在一个枚举里;Program 回放已归位到 WorkbenchLayoutStore.presentationMode)。
 */
export const WORKSPACE_SECTION = {
    OUTLINE: "outline",
    ASSETS: "assets",
    CAMERA: "camera",
    LIGHT: "light",
} as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTION)[keyof typeof WORKSPACE_SECTION];

export interface WorkspaceSectionDef {
    /** 全称:无障碍名与需要完整语义的场合 */
    readonly label: string;
    /** 短称:tab 条等窄空间的显示文案 */
    readonly shortLabel: string;
    readonly icon: SvgIconComponent;
}

export const WORKSPACE_SECTION_ORDER: readonly WorkspaceSection[] = [
    WORKSPACE_SECTION.OUTLINE,
    WORKSPACE_SECTION.ASSETS,
    WORKSPACE_SECTION.CAMERA,
    WORKSPACE_SECTION.LIGHT,
];

export const WORKSPACE_SECTION_DEFS: Record<WorkspaceSection, WorkspaceSectionDef> = {
    [WORKSPACE_SECTION.OUTLINE]: { label: "资源大纲", shortLabel: "大纲", icon: AccountTreeIcon },
    [WORKSPACE_SECTION.ASSETS]: { label: "模型资产", shortLabel: "资产", icon: ViewInArIcon },
    [WORKSPACE_SECTION.CAMERA]: { label: "机位与运镜", shortLabel: "机位", icon: VideocamIcon },
    [WORKSPACE_SECTION.LIGHT]: { label: "灯光环境", shortLabel: "灯光", icon: LightbulbIcon },
};
