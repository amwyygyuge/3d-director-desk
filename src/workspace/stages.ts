import CameraIcon from "@mui/icons-material/Videocam";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import LayoutIcon from "@mui/icons-material/ViewInAr";
import type { SvgIconComponent } from "@mui/icons-material";

/** 工作区阶段:布景（含模型姿势/动作）/ 运镜 / 成片。 */
export const WORKSPACE_STAGE = {
    SET: "set",
    CAMERA: "camera",
    OUTPUT: "output",
} as const;
export type WorkspaceStage = (typeof WORKSPACE_STAGE)[keyof typeof WORKSPACE_STAGE];

/** 阶段仅决定工具组、辅助物与时间轴显隐；切换不重置选中、视角或场景数据。 */
export interface StageDef {
    readonly label: string;
    readonly icon: SvgIconComponent;
    /** 数字键直切(1-3) */
    readonly digit: string;
    readonly timeline: boolean;
    readonly helpers: {
        readonly shotMarkers: boolean;
        readonly motionPaths: boolean;
        readonly lightHelpers: boolean;
    };
}

export const STAGE_ORDER: readonly WorkspaceStage[] = [
    WORKSPACE_STAGE.SET,
    WORKSPACE_STAGE.CAMERA,
    WORKSPACE_STAGE.OUTPUT,
];

export const STAGE_DEFS: Record<WorkspaceStage, StageDef> = {
    [WORKSPACE_STAGE.SET]: {
        label: "布景",
        icon: LayoutIcon,
        digit: "1",
        timeline: false,
        helpers: { shotMarkers: false, motionPaths: false, lightHelpers: true },
    },
    [WORKSPACE_STAGE.CAMERA]: {
        label: "运镜",
        icon: CameraIcon,
        digit: "2",
        timeline: true,
        helpers: { shotMarkers: true, motionPaths: true, lightHelpers: false },
    },
    [WORKSPACE_STAGE.OUTPUT]: {
        label: "成片",
        icon: CheckCircleIcon,
        digit: "3",
        timeline: true,
        helpers: { shotMarkers: false, motionPaths: false, lightHelpers: false },
    },
};
