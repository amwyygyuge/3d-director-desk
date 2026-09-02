import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { VIEW_DIRECTION } from "@/camera/FramingService";
import type { ViewDirection } from "@/camera/FramingService";
import { FrameViewCommand, ViewResetCommand } from "@/command/navigationCommands";
import { KIND_LABEL } from "@/core/SceneObject";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME } from "@/ui/shell/theme";

/** 面板宽度:顶中搜索下拉的固定版式,与提示条同轴 */
const PALETTE_WIDTH_PX = 400;
/** 面板上缘与药丸条/提示条的间距(药丸条占位 edgeGap + pillHeight) */
const PALETTE_TOP_GAP_PX = 8;

/** 条目分组:options 按此顺序构造(Autocomplete 的 groupBy 要求同组相邻) */
const OPTION_GROUP = {
    PRESET: "预设视角",
    OBJECT: "场景对象",
    SHOT: "机位",
} as const;
type OptionGroup = (typeof OPTION_GROUP)[keyof typeof OPTION_GROUP];

/** 面板动作(纯数据):预设视角 / 元素正视图 / 进入掌镜;执行统一走命令层 */
type PaletteAction =
    | { readonly type: "preset"; readonly preset: "reset" | ViewDirection }
    | { readonly type: "object"; readonly id: string }
    | { readonly type: "shot"; readonly id: string };

interface PaletteOption {
    readonly key: string;
    readonly group: OptionGroup;
    readonly label: string;
    readonly caption: string;
    readonly action: PaletteAction;
}

const PALETTE_PRESETS: readonly PaletteOption[] = [
    {
        key: "preset:reset",
        group: OPTION_GROUP.PRESET,
        label: "重置视角",
        caption: "回到初始工作室机位",
        action: { type: "preset", preset: "reset" },
    },
    {
        key: "preset:front",
        group: OPTION_GROUP.PRESET,
        label: "前视图",
        caption: "沿 +Z 取景全部对象",
        action: { type: "preset", preset: VIEW_DIRECTION.FRONT },
    },
    {
        key: "preset:top",
        group: OPTION_GROUP.PRESET,
        label: "顶视图",
        caption: "沿 +Y 俯视全部对象",
        action: { type: "preset", preset: VIEW_DIRECTION.TOP },
    },
    {
        key: "preset:right",
        group: OPTION_GROUP.PRESET,
        label: "右视图",
        caption: "沿 +X 取景全部对象",
        action: { type: "preset", preset: VIEW_DIRECTION.RIGHT },
    },
];

/** 条目聚合(读路径):预设 + 场景对象 + 机位;kind="camera" 实体无可见渲染体,不入列 */
function buildPaletteOptions(stores: DirectorDeskStores): PaletteOption[] {
    const objectOptions = stores.scene.manager
        .list()
        .filter((entity) => entity.kind !== "camera")
        .map((entity) => ({
            key: `object:${entity.id}`,
            group: OPTION_GROUP.OBJECT,
            label: entity.name,
            caption: KIND_LABEL[entity.kind],
            action: { type: "object", id: entity.id } as const,
        }));
    const shotOptions = stores.camera.director.listShots().map(([id]) => ({
        key: `shot:${id}`,
        group: OPTION_GROUP.SHOT,
        label: id,
        caption: "机位",
        action: { type: "shot", id } as const,
    }));
    return [...PALETTE_PRESETS, ...objectOptions, ...shotOptions];
}

/** 执行(写路径):一切状态改变经 CommandDispatcher;选中是纯 UI 态,直写 selection(与快捷键动作同一先例) */
function executePaletteOption(stores: DirectorDeskStores, option: PaletteOption): void {
    const { action } = option;
    switch (action.type) {
        case "preset": {
            const result =
                action.preset === "reset"
                    ? stores.dispatcher.dispatch({ type: ViewResetCommand.TYPE, payload: {} }, stores)
                    : stores.dispatcher.dispatch(
                          { type: FrameViewCommand.TYPE, payload: { direction: action.preset } },
                          stores,
                      );
            reportCommandFailure(stores, result);
            return;
        }
        case "object": {
            const result = stores.dispatcher.dispatch(
                { type: FrameViewCommand.TYPE, payload: { ids: [action.id], direction: VIEW_DIRECTION.FRONT } },
                stores,
            );
            reportCommandFailure(stores, result);
            if (result.ok) stores.selection.select(action.id);
            return;
        }
        case "shot": {
            reportCommandFailure(
                stores,
                stores.dispatcher.dispatch({ type: "camera.activate", payload: { id: action.id } }, stores),
            );
        }
    }
}

/**
 * ⌘K 视角/元素导航面板:顶部居中的搜索下拉。
 * 开关态在 UiStore.paletteOpen(瞬时 UI 态);打开经 SHORTCUT_SPECS 的 mod+k 注册行,
 * 键盘交互由 Autocomplete 自持(input 焦点经 isEditingText 让快捷键注册表整体让位),
 * Esc/blur/选中经 onClose/onChange 关闭——不新增快捷键旁路监听。
 */
export const CommandPalette = observer(function CommandPalette() {
    const stores = useDirectorDeskStores();
    const { ui } = stores;
    if (!ui.paletteOpen) return null;
    const options = buildPaletteOptions(stores);

    return (
        <Box
            sx={{
                position: "absolute",
                top: CHROME.edgeGapPx + CHROME.pillHeightPx + PALETTE_TOP_GAP_PX,
                left: "50%",
                transform: "translateX(-50%)",
                width: PALETTE_WIDTH_PX,
                zIndex: CHROME.toastZIndex,
            }}
        >
            <Paper variant="panel" sx={{ p: 1 }}>
                <Autocomplete<PaletteOption>
                    open
                    autoHighlight
                    size="small"
                    options={options}
                    noOptionsText="无匹配"
                    groupBy={(option) => option.group}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(a, b) => a.key === b.key}
                    onChange={(_, option) => {
                        if (option) executePaletteOption(stores, option);
                        ui.setPaletteOpen(false);
                    }}
                    onClose={() => ui.setPaletteOpen(false)}
                    renderInput={(params) => <TextField {...params} autoFocus placeholder="搜索视角、对象或机位…" />}
                    renderOption={(props, option) => (
                        <li {...props}>
                            <Box sx={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
                                <Typography variant="body2">{option.label}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {option.caption}
                                </Typography>
                            </Box>
                        </li>
                    )}
                />
            </Paper>
        </Box>
    );
});
