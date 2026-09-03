export interface MarkerTemplate {
    readonly id: string;
    readonly label: string;
    readonly colorToken: string;
}

export const MARKER_TEMPLATE = {
    ACTION_START: "action-start",
    COMPOSITION_CHECK: "composition-check",
    CUT_POINT: "cut-point",
    SUBJECT_ENTRY: "subject-entry",
} as const;

/** 导演常用语义锚点：只编译为既有 TimelineMarker，不引入第二种标记模型。 */
export const MARKER_TEMPLATES: readonly MarkerTemplate[] = [
    { id: MARKER_TEMPLATE.SUBJECT_ENTRY, label: "角色入场", colorToken: "success.main" },
    { id: MARKER_TEMPLATE.ACTION_START, label: "动作起点", colorToken: "primary.main" },
    { id: MARKER_TEMPLATE.COMPOSITION_CHECK, label: "构图确认", colorToken: "warning.main" },
    { id: MARKER_TEMPLATE.CUT_POINT, label: "转场点", colorToken: "secondary.main" },
];
