import ChairIcon from "@mui/icons-material/Chair";
import DownloadIcon from "@mui/icons-material/Download";
import GestureIcon from "@mui/icons-material/Gesture";
import GrassIcon from "@mui/icons-material/Grass";
import IconButton from "@mui/material/IconButton";
import PersonIcon from "@mui/icons-material/Person";
import PetsIcon from "@mui/icons-material/Pets";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { ASSET_CATEGORY, ASSET_KIND } from "../assets/catalog/AssetEntry";
import type { AssetEntry } from "../assets/catalog/AssetEntry";
import { useDirectorDeskStores } from "./DirectorDeskContext";

/** 分类 → 图标/文案查表(纪律:禁 if 链);动作类与未识别分类走杂项 */
const CATEGORY_PRESENTATION: Record<string, { icon: ReactNode; label: string }> = {
    [ASSET_CATEGORY.HUMAN]: { icon: <PersonIcon fontSize="small" />, label: "人物" },
    [ASSET_CATEGORY.ANIMAL]: { icon: <PetsIcon fontSize="small" />, label: "动物" },
    [ASSET_CATEGORY.PLANT]: { icon: <GrassIcon fontSize="small" />, label: "植物" },
    [ASSET_CATEGORY.FURNITURE]: { icon: <ChairIcon fontSize="small" />, label: "家具" },
    [ASSET_CATEGORY.PROP]: { icon: <GestureIcon fontSize="small" />, label: "道具" },
};
const FALLBACK_PRESENTATION = { icon: <GestureIcon fontSize="small" />, label: "其他" };
const ACTION_PRESENTATION = { icon: <PlayCircleIcon fontSize="small" />, label: "动作" };

function presentationOf(entry: AssetEntry): { icon: ReactNode; label: string } {
    if (entry.kind === ASSET_KIND.ACTION) return ACTION_PRESENTATION;
    return CATEGORY_PRESENTATION[entry.category] ?? FALLBACK_PRESENTATION;
}

/**
 * 资源库面板(布景阶段,左 Dock):目录条目的分组浏览与一键放置/挂载。
 * 写操作全走命令层;挂载目标 = 当前主选模型(无选中或选中非模型则禁用)。
 */
export const AssetLibraryPanel = observer(function AssetLibraryPanel() {
    const stores = useDirectorDeskStores();
    const { catalog, dispatcher, ui } = stores;
    const entries = catalog.list();
    const primaryEntity = stores.selection.primaryId
        ? stores.scene.manager.getEntity(stores.selection.primaryId)
        : undefined;
    const mountTarget = primaryEntity?.kind === "model" ? primaryEntity : undefined;

    const place = (entry: AssetEntry) => {
        const result = dispatcher.dispatch({ type: "assets.place", payload: { assetId: entry.id } }, stores);
        if (!result.ok) ui.setApplicationNotice(`放置被拒:${result.issues?.join(";") ?? result.error}`);
    };
    const mount = (entry: AssetEntry) => {
        if (!mountTarget) return;
        const result = dispatcher.dispatch(
            { type: "assets.mount", payload: { assetId: entry.id, objectId: mountTarget.id } },
            stores,
        );
        if (!result.ok) ui.setApplicationNotice(`挂载被拒:${result.issues?.join(";") ?? result.error}`);
    };

    return (
        <Paper elevation={0} sx={{ p: 1.5 }}>
            <Typography variant="subtitle2">资源库({entries.length})</Typography>
            {entries.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                    目录为空(内置资源加载失败或宿主未注入)
                </Typography>
            ) : (
                <List dense disablePadding aria-label="资源库">
                    {entries.map((entry) => {
                        const presentation = presentationOf(entry);
                        const isModel = entry.kind === ASSET_KIND.MODEL;
                        return (
                            <ListItem
                                key={entry.id}
                                disablePadding
                                secondaryAction={
                                    <Tooltip
                                        title={
                                            isModel
                                                ? `放置 · ${entry.license}`
                                                : mountTarget
                                                  ? `挂载到 ${mountTarget.name} · ${entry.license}`
                                                  : "先选中一个模型再挂载"
                                        }
                                    >
                                        <span>
                                            <IconButton
                                                size="small"
                                                aria-label={isModel ? `放置 ${entry.name}` : `挂载 ${entry.name}`}
                                                disabled={!isModel && !mountTarget}
                                                onClick={() => (isModel ? place(entry) : mount(entry))}
                                            >
                                                {isModel ? (
                                                    <DownloadIcon fontSize="small" />
                                                ) : (
                                                    <PlayCircleIcon fontSize="small" />
                                                )}
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                }
                            >
                                <ListItemButton
                                    className="pr-12"
                                    aria-label={`资源 ${entry.name}`}
                                    onClick={() => (isModel ? place(entry) : mount(entry))}
                                >
                                    <ListItemIcon className="min-w-8">{presentation.icon}</ListItemIcon>
                                    <ListItemText
                                        primary={entry.name}
                                        secondary={presentation.label}
                                        slotProps={{ primary: { noWrap: true, title: entry.name } }}
                                        sx={{ minWidth: 0 }}
                                    />
                                </ListItemButton>
                            </ListItem>
                        );
                    })}
                </List>
            )}
        </Paper>
    );
});
