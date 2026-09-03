/**
 * 选中角色(值对象常量):主选是 gizmo 挂载者与检查器目标,次选是多选成员。
 * 呈现配方按角色查表,分散在各呈现器内(辉光配方在 SelectionTintBinder,线框配方在 SelectionHighlight)。
 */
export const SELECTION_ROLE = {
    PRIMARY: "primary",
    SECONDARY: "secondary",
} as const;
export type SelectionRole = (typeof SELECTION_ROLE)[keyof typeof SELECTION_ROLE];
