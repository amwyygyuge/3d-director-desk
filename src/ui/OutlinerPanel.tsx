import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import DeleteIcon from "@mui/icons-material/Delete";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { RemoveObjectCommand } from "../command/commands";
import { FrameViewCommand } from "../command/navigationCommands";
import type { SceneObjectKind } from "../core/SceneObject";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const KIND_ICONS: Record<SceneObjectKind, ReactNode> = {
    model: <ViewInArIcon fontSize="small" />,
    camera: <VideocamIcon fontSize="small" />,
    light: <LightbulbIcon fontSize="small" />,
};

const OUTLINER_DENSE_ITEM_PADDING_Y = 0.25;

/** 场景大纲(左侧):实体列表、共享选中态与逐项取景/删除。 */
export const OutlinerPanel = observer(function OutlinerPanel() {
    const stores = useDirectorDeskStores();
    const { dispatcher, scene, selection } = stores;

    const entities = scene.manager.list();

    return (
        <Box sx={{ p: 1.5 }}>
            {entities.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                    场景为空(0),请导入模型
                </Typography>
            ) : (
                <List dense disablePadding aria-label="场景对象">
                    {entities.map((entity) => (
                        <ListItem
                            key={entity.id}
                            disablePadding
                            secondaryAction={
                                <>
                                    <IconButton
                                        size="small"
                                        aria-label={`聚焦 ${entity.name}`}
                                        onClick={() =>
                                            dispatcher.dispatch(
                                                { type: FrameViewCommand.TYPE, payload: { ids: [entity.id] } },
                                                stores,
                                            )
                                        }
                                    >
                                        <CenterFocusStrongIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        aria-label={`删除 ${entity.name}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            dispatcher.dispatch(
                                                { type: RemoveObjectCommand.TYPE, payload: { id: entity.id } },
                                                stores,
                                            );
                                        }}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </>
                            }
                        >
                            <ListItemButton
                                className="pr-16"
                                selected={selection.isSelected(entity.id)}
                                aria-label={`选择 ${entity.name}`}
                                onClick={(event) =>
                                    selection.select(entity.id, { additive: event.metaKey || event.ctrlKey })
                                }
                                sx={{
                                    py: OUTLINER_DENSE_ITEM_PADDING_Y,
                                    "&.Mui-selected": {
                                        bgcolor: "primary.main",
                                        color: "primary.contrastText",
                                        "& .MuiListItemIcon-root": { color: "inherit" },
                                    },
                                }}
                            >
                                <ListItemIcon className="min-w-8">{KIND_ICONS[entity.kind]}</ListItemIcon>
                                <ListItemText
                                    primary={entity.name}
                                    slotProps={{ primary: { noWrap: true, title: entity.name } }}
                                    sx={{ minWidth: 0 }}
                                />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            )}
        </Box>
    );
});
