import { FrameViewCommand } from "../command/navigationCommands";
import { WORKSPACE_STAGE } from "../workspace/stages";
import type { DirectorDeskStores } from "../ui/DirectorDeskContext";
import { ShortcutChord } from "./ShortcutChord";
import type { ShortcutRegistry, ShortcutScope } from "./ShortcutRegistry";

/** 快捷键动作 id:AI 工具描述/文档/冲突检测的引用键 */
export const SHORTCUT_ID = {
    AXIS_X: "gizmo.axis.x",
    AXIS_Y: "gizmo.axis.y",
    AXIS_Z: "gizmo.axis.z",
    REMOVE_SELECTION: "selection.remove",
    CLEAR_SELECTION: "selection.clear",
    SHOT_ENTER: "shot.enter",
    SHOT_EXIT: "shot.exit",
    FRAME_SELECTED: "view.frame-selected",
    FRAME_ALL: "view.frame-all",
    EDIT_UNDO: "edit.undo",
    EDIT_REDO: "edit.redo",
    HELP_TOGGLE: "help.toggle",
    STAGE_SET: "stage.set",
    STAGE_CAMERA: "stage.camera",
    STAGE_OUTPUT: "stage.output",
} as const;
export type ShortcutId = (typeof SHORTCUT_ID)[keyof typeof SHORTCUT_ID];

/**
 * 快捷键 SPECS(纯数据表,单一真相源):
 * - 行为在下方 ACTIONS,按 id 对齐(Record 全键约束,漏配编译期报错);
 * - UI 提示经 formatShortcutHint 从本表格式化,按钮提示与真实生效键永不分叉。
 */
export const SHORTCUT_SPECS: readonly {
    id: ShortcutId;
    chords: readonly string[];
    scope: ShortcutScope;
    label: string;
}[] = [
    { id: SHORTCUT_ID.AXIS_X, chords: ["x"], scope: "gizmo", label: "约束/切换 X 轴" },
    { id: SHORTCUT_ID.AXIS_Y, chords: ["y"], scope: "gizmo", label: "约束/切换 Y 轴" },
    { id: SHORTCUT_ID.AXIS_Z, chords: ["z"], scope: "gizmo", label: "约束/切换 Z 轴" },
    { id: SHORTCUT_ID.REMOVE_SELECTION, chords: ["delete", "backspace"], scope: "gizmo", label: "删除选中" },
    { id: SHORTCUT_ID.SHOT_ENTER, chords: ["enter"], scope: "shot-selected", label: "进入掌镜" },
    { id: SHORTCUT_ID.SHOT_EXIT, chords: ["escape"], scope: "shot", label: "退出掌镜" },
    { id: SHORTCUT_ID.CLEAR_SELECTION, chords: ["escape"], scope: "gizmo", label: "取消选中" },
    { id: SHORTCUT_ID.FRAME_SELECTED, chords: ["f"], scope: "gizmo", label: "聚焦选中对象" },
    { id: SHORTCUT_ID.FRAME_ALL, chords: ["home"], scope: "global", label: "取景全部对象" },
    { id: SHORTCUT_ID.EDIT_UNDO, chords: ["mod+z"], scope: "global", label: "撤销" },
    { id: SHORTCUT_ID.EDIT_REDO, chords: ["mod+shift+z"], scope: "global", label: "重做" },
    { id: SHORTCUT_ID.HELP_TOGGLE, chords: ["shift+/"], scope: "global", label: "快捷键速查" },
    { id: SHORTCUT_ID.STAGE_SET, chords: ["1"], scope: "global", label: "布景阶段" },
    { id: SHORTCUT_ID.STAGE_CAMERA, chords: ["2"], scope: "global", label: "运镜阶段" },
    { id: SHORTCUT_ID.STAGE_OUTPUT, chords: ["3"], scope: "global", label: "成片阶段" },
];

function removeSelection(stores: DirectorDeskStores): void {
    for (const id of stores.selection.selectedIds) {
        stores.dispatcher.dispatch({ type: "object.remove", payload: { id } }, stores);
    }
    stores.selection.clear();
}

function activateSelectedShot(stores: DirectorDeskStores): void {
    const shotId = stores.selection.primaryId;
    if (!shotId || stores.camera.director.getShot(shotId) === undefined) return;
    stores.dispatcher.dispatch({ type: "camera.activate", payload: { id: shotId } }, stores);
}

const SHORTCUT_ACTIONS: Record<ShortcutId, (stores: DirectorDeskStores) => void> = {
    [SHORTCUT_ID.AXIS_X]: (s) => s.ui.toggleGizmoAxis("x"),
    [SHORTCUT_ID.AXIS_Y]: (s) => s.ui.toggleGizmoAxis("y"),
    [SHORTCUT_ID.AXIS_Z]: (s) => s.ui.toggleGizmoAxis("z"),
    [SHORTCUT_ID.REMOVE_SELECTION]: removeSelection,
    [SHORTCUT_ID.SHOT_ENTER]: activateSelectedShot,
    [SHORTCUT_ID.SHOT_EXIT]: (s) => s.dispatcher.dispatch({ type: "camera.deactivate", payload: {} }, s),
    [SHORTCUT_ID.CLEAR_SELECTION]: (s) => s.selection.clear(),
    [SHORTCUT_ID.FRAME_SELECTED]: (s) =>
        s.dispatcher.dispatch({ type: FrameViewCommand.TYPE, payload: { ids: [...s.selection.selectedIds] } }, s),
    [SHORTCUT_ID.FRAME_ALL]: (s) => s.dispatcher.dispatch({ type: FrameViewCommand.TYPE, payload: {} }, s),
    [SHORTCUT_ID.EDIT_UNDO]: (s) => s.history.undo(s),
    [SHORTCUT_ID.EDIT_REDO]: (s) => s.history.redo(s),
    [SHORTCUT_ID.HELP_TOGGLE]: (s) => s.ui.toggleHelp(),
    [SHORTCUT_ID.STAGE_SET]: (s) => s.ui.setStage(WORKSPACE_STAGE.SET),
    [SHORTCUT_ID.STAGE_CAMERA]: (s) => s.ui.setStage(WORKSPACE_STAGE.CAMERA),
    [SHORTCUT_ID.STAGE_OUTPUT]: (s) => s.ui.setStage(WORKSPACE_STAGE.OUTPUT),
};

/** 内置快捷键注册:Hotkeys 挂载时调一次,返回整体注销 */
export function registerBuiltinShortcuts(registry: ShortcutRegistry<DirectorDeskStores>): () => void {
    const unregisters = SHORTCUT_SPECS.flatMap((spec) =>
        spec.chords.map((chord) =>
            registry.register({
                id: spec.id,
                chord: ShortcutChord.parse(chord),
                scope: spec.scope,
                run: SHORTCUT_ACTIONS[spec.id],
            }),
        ),
    );
    return () => {
        for (const unregister of unregisters) unregister();
    };
}

/** 当前激活作用域:global 常驻;机位选择与掌镜分别有精确 scope,避免 Enter 作用于普通对象 */
export function activeShortcutScopes(stores: DirectorDeskStores): ReadonlySet<ShortcutScope> {
    const primaryId = stores.selection.primaryId;
    const hasSelectedInactiveShot =
        primaryId !== null &&
        stores.camera.activeShotId === null &&
        stores.camera.director.getShot(primaryId) !== undefined;
    return new Set<ShortcutScope>([
        "global",
        ...(primaryId ? ["gizmo" as const] : []),
        ...(hasSelectedInactiveShot ? ["shot-selected" as const] : []),
        ...(stores.camera.activeShotId ? ["shot" as const] : []),
    ]);
}
/** UI 提示:同 id 多 chord 用 / 连接;平台格式化后同形的去重(Mac 上 Delete 与 Backspace 都是 ⌫) */
export function formatShortcutHint(id: ShortcutId): string {
    const spec = SHORTCUT_SPECS.find((s) => s.id === id);
    if (!spec) return "";
    const formatted = spec.chords.map((chord) => ShortcutChord.parse(chord).format());
    return [...new Set(formatted)].join("/");
}
