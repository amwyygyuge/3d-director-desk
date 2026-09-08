/** 选中角色(值对象常量):主选是 gizmo 挂载者与检查器目标,次选是多选成员。 */
export const SELECTION_ROLE = {
    PRIMARY: "primary",
    SECONDARY: "secondary",
} as const;
export type SelectionRole = (typeof SELECTION_ROLE)[keyof typeof SELECTION_ROLE];
