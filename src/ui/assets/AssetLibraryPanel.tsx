import ChairIcon from "@mui/icons-material/Chair";
import DownloadIcon from "@mui/icons-material/Download";
import GestureIcon from "@mui/icons-material/Gesture";
import GrassIcon from "@mui/icons-material/Grass";
import PersonIcon from "@mui/icons-material/Person";
import PetsIcon from "@mui/icons-material/Pets";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { ASSET_CATEGORY, ASSET_KIND } from "@/assets/catalog/AssetEntry";
import type { AssetEntry } from "@/assets/catalog/AssetEntry";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 分类 → 图标/文案查表；资源库只展示可直接放置的模型。 */
const CATEGORY_PRESENTATION: Record<string, { icon: ReactNode; label: string }> = {
    [ASSET_CATEGORY.HUMAN]: { icon: <PersonIcon fontSize="small" />, label: "人物" },
    [ASSET_CATEGORY.ANIMAL]: { icon: <PetsIcon fontSize="small" />, label: "动物" },
    [ASSET_CATEGORY.PLANT]: { icon: <GrassIcon fontSize="small" />, label: "植物" },
    [ASSET_CATEGORY.FURNITURE]: { icon: <ChairIcon fontSize="small" />, label: "家具" },
    [ASSET_CATEGORY.PROP]: { icon: <GestureIcon fontSize="small" />, label: "道具" },
};
const FALLBACK_PRESENTATION = { icon: <GestureIcon fontSize="small" />, label: "其他" };

function presentationOf(entry: AssetEntry): { icon: ReactNode; label: string } {
    return CATEGORY_PRESENTATION[entry.category] ?? FALLBACK_PRESENTATION;
}

/** 资源库只放模型；动作随模型的内嵌 clip 在 Inspector 的预设区直接应用。 */
export const AssetLibraryPanel = observer(function AssetLibraryPanel() {
    const stores = useDirectorDeskStores();
    const { catalog, dispatcher, ui } = stores;
    const entries = catalog.list({ kind: ASSET_KIND.MODEL });

    const place = (entry: AssetEntry) => {
        const result = dispatcher.dispatch({ type: "assets.place", payload: { assetId: entry.id } }, stores);
        if (!result.ok) ui.setApplicationNotice(`放置被拒:${result.issues?.join(";") ?? result.error}`);
    };

    return (
        <Box sx={{ p: 1.5 }}>
            {entries.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                    目录为空(内置资源加载失败或宿主未注入)
                </Typography>
            ) : (
                <List dense disablePadding aria-label="资源库">
                    {entries.map((entry) => {
                        const presentation = presentationOf(entry);
                        return (
                            <ListItem
                                key={entry.id}
                                disablePadding
                                secondaryAction={
                                    <Tooltip title={`放置 · ${entry.license}`}>
                                        <IconButton
                                            size="small"
                                            aria-label={`放置 ${entry.name}`}
                                            onClick={() => place(entry)}
                                        >
                                            <DownloadIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                }
                            >
                                <ListItemButton
                                    className="pr-12"
                                    aria-label={`资源 ${entry.name}`}
                                    onClick={() => place(entry)}
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
        </Box>
    );
});
