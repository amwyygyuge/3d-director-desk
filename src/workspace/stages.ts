import CameraIcon from "@mui/icons-material/Videocam";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import LayoutIcon from "@mui/icons-material/ViewInAr";
import MotionIcon from "@mui/icons-material/RunCircle";
import type { SvgIconComponent } from "@mui/icons-material";

/** 工作区阶段:布景(含打灯)/ 动作 / 运镜 / 成片——B 方案四段 */
export const WORKSPACE_STAGE = {
    SET: "set",
    ACTION: "action",
    CAMERA: "camera",
    OUTPUT: "output",
} as const;
export type WorkspaceStage = (typeof WORKSPACE_STAGE)[keyof typeof WORKSPACE_STAGE];

/**
 * 阶段定义(声明式注册):阶段 = 聚焦透镜,不是硬模式——
 * 只决定「工具条露哪些组、场景辅助物显隐、时间轴是否出现」,
 * 永不重置选中/视角/场景数据(工序是循环的,切换必须零成本)。
 */
export interface StageDef {
    readonly label: string;
    readonly icon: SvgIconComponent;
    /** 数字键直切(1-4) */
    readonly digit: string;
    /** 底 Dock(时间轴)是否随阶段出现 */
    readonly timeline: boolean;
    /** 场景辅助物显隐 */
    readonly helpers: {
        readonly shotMarkers: boolean;
        readonly motionPaths: boolean;
        readonly lightHelpers: boolean;
    };
}

export const STAGE_ORDER: readonly WorkspaceStage[] = [
    WORKSPACE_STAGE.SET,
    WORKSPACE_STAGE.ACTION,
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
    [WORKSPACE_STAGE.ACTION]: {
        label: "动作",
        icon: MotionIcon,
        digit: "2",
        timeline: true,
        helpers: { shotMarkers: false, motionPaths: false, lightHelpers: false },
    },
    [WORKSPACE_STAGE.CAMERA]: {
        label: "运镜",
        icon: CameraIcon,
        digit: "3",
        timeline: true,
        helpers: { shotMarkers: true, motionPaths: true, lightHelpers: false },
    },
    [WORKSPACE_STAGE.OUTPUT]: {
        label: "成片",
        icon: CheckCircleIcon,
        digit: "4",
        timeline: true,
        helpers: { shotMarkers: false, motionPaths: false, lightHelpers: false },
    },
};
