import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import type { CommandResult } from "../command/DirectorCommand";
import { useDirectorDeskStores } from "./DirectorDeskContext";

/**
 * 对象面板(右侧):选中模型 → 动作库列表(挂载/卸载)+ 播放控制条。
 * 播放头是高频非 observable 值,经 transport.subscribe 同步进本地 state——
 * 仅播放期产生重渲,暂停即静止(性能纪律)。
 */
export const Inspector = observer(function Inspector() {
    const stores = useDirectorDeskStores();
    const { selection, scene, animations, clock, dispatcher } = stores;
    const [notice, setNotice] = useState<string | null>(null);
    const [playhead, setPlayhead] = useState(clock.time);

    useEffect(() => clock.subscribe((t) => setPlayhead(t)), [clock]);

    // 实体字段(actionId 等)非 observable;锚定 revision,命令提交后驱动本面板重渲
    void scene.revision;
    const primaryId = selection.primaryId;
    const entity = primaryId ? scene.manager.getEntity(primaryId) : undefined;
    if (!entity || entity.kind !== "model") return null;

    const report = (result: CommandResult) => {
        if (!result.ok) setNotice(result.issues?.join(";") ?? result.error);
    };

    const mountedAction = entity.actionId ? animations.actions.find((a) => a.id === entity.actionId) : undefined;
    const duration = mountedAction?.duration ?? 0;

    return (
        <Paper elevation={2} sx={{ position: "absolute", top: 12, right: 12, width: 260, p: 1.5, zIndex: 1 }}>
            <Typography variant="subtitle2" noWrap>
                {entity.id}
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">
                动作库({animations.actions.length})
            </Typography>
            <List dense disablePadding>
                {animations.actions.map((action) => {
                    const mounted = entity.actionId === action.id;
                    return (
                        <ListItem
                            key={action.id}
                            disablePadding
                            secondaryAction={
                                <Button
                                    size="small"
                                    variant={mounted ? "outlined" : "contained"}
                                    onClick={() =>
                                        report(
                                            dispatcher.dispatch(
                                                {
                                                    type: mounted ? "action.unmount" : "action.mount",
                                                    payload: { objectId: entity.id, actionId: action.id },
                                                },
                                                stores,
                                            ),
                                        )
                                    }
                                >
                                    {mounted ? "卸载" : "挂载"}
                                </Button>
                            }
                        >
                            <ListItemText primary={action.name} secondary={`${action.duration.toFixed(1)}s`} />
                        </ListItem>
                    );
                })}
            </List>
            {animations.actions.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                    先经工具条「导入动作」入库
                </Typography>
            )}
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <IconButton
                    size="small"
                    disabled={!mountedAction}
                    onClick={() =>
                        report(dispatcher.dispatch({ type: clock.isPlaying ? "transport.pause" : "transport.play", payload: {} }, stores))
                    }
                >
                    {clock.isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                </IconButton>
                <Box sx={{ flex: 1 }}>
                    <Slider
                        size="small"
                        min={0}
                        max={duration}
                        step={0.01}
                        value={Math.min(playhead, duration)}
                        disabled={!mountedAction}
                        onChange={(_, value) =>
                            report(dispatcher.dispatch({ type: "transport.seek", payload: { time: value as number } }, stores))
                        }
                    />
                </Box>
                <Typography variant="caption" sx={{ minWidth: 64, textAlign: "right" }}>
                    {playhead.toFixed(2)}s
                </Typography>
            </Stack>
            <Snackbar
                open={notice !== null}
                autoHideDuration={4000}
                onClose={() => setNotice(null)}
                message={notice}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            />
        </Paper>
    );
});
