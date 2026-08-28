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
import { TransformFields } from "./TransformFields";

type ReportCommandResult = (result: CommandResult) => void;

interface ModelActionControlsProps {
    objectId: string;
    report: ReportCommandResult;
}

interface ActionLibraryProps {
    actionId: string | null;
    objectId: string;
    report: ReportCommandResult;
}

interface PlaybackControlsProps {
    actionId: string | null;
    report: ReportCommandResult;
}

const ActionLibrary = observer(function ActionLibrary({ actionId, objectId, report }: ActionLibraryProps) {
    const stores = useDirectorDeskStores();
    const { animations, dispatcher } = stores;

    return (
        <>
            <Typography variant="caption" color="text.secondary">
                动作库({animations.actions.length})
            </Typography>
            <List dense disablePadding>
                {animations.actions.map((action) => {
                    const mounted = actionId === action.id;
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
                                                    payload: { objectId, actionId: action.id },
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
        </>
    );
});

const PlaybackControls = observer(function PlaybackControls({ actionId, report }: PlaybackControlsProps) {
    const stores = useDirectorDeskStores();
    const { animations, clock, dispatcher } = stores;
    const [playhead, setPlayhead] = useState(clock.time);
    const mountedAction = actionId ? animations.actions.find((action) => action.id === actionId) : undefined;
    const duration = mountedAction?.duration ?? 0;

    useEffect(() => clock.subscribe((time) => setPlayhead(time)), [clock]);

    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <IconButton
                size="small"
                disabled={!mountedAction}
                onClick={() =>
                    report(
                        dispatcher.dispatch(
                            { type: clock.isPlaying ? "transport.pause" : "transport.play", payload: {} },
                            stores,
                        ),
                    )
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
                        report(
                            dispatcher.dispatch({ type: "transport.seek", payload: { time: value as number } }, stores),
                        )
                    }
                />
            </Box>
            <Typography variant="caption" sx={{ minWidth: 64, textAlign: "right" }}>
                {playhead.toFixed(2)}s
            </Typography>
        </Stack>
    );
});

const ModelActionControls = observer(function ModelActionControls({ objectId, report }: ModelActionControlsProps) {
    const { scene } = useDirectorDeskStores();
    const entity = scene.manager.getEntity(objectId);
    if (!entity || entity.kind !== "model") return null;

    return (
        <>
            <Divider sx={{ my: 1 }} />
            <ActionLibrary actionId={entity.actionId} objectId={objectId} report={report} />
            <Divider sx={{ my: 1 }} />
            <PlaybackControls actionId={entity.actionId} report={report} />
        </>
    );
});

/** 对象面板(右侧):所有选中对象显示数值变换，模型额外显示动作库与播放控制。 */
export const Inspector = observer(function Inspector() {
    const stores = useDirectorDeskStores();
    const { scene, selection } = stores;
    const [notice, setNotice] = useState<string | null>(null);

    // 实体字段(actionId 等)非 observable;锚定 revision,命令提交后驱动本面板重渲
    void scene.revision;
    const primaryId = selection.primaryId;
    const entity = primaryId ? scene.manager.getEntity(primaryId) : undefined;
    if (!entity) return null;

    const report = (result: CommandResult) => {
        if (!result.ok) setNotice(result.issues?.join(";") ?? result.error);
    };

    return (
        <Paper elevation={2} sx={{ position: "absolute", top: 12, right: 12, width: 260, p: 1.5, zIndex: 1 }}>
            <Typography variant="subtitle2" noWrap>
                {entity.name}
            </Typography>
            <Divider sx={{ my: 1 }} />
            <TransformFields objectId={entity.id} />
            {entity.kind === "model" && <ModelActionControls objectId={entity.id} report={report} />}
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
