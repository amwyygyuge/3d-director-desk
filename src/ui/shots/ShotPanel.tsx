import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { SHOT_SIZE_LABELS } from "@/ui/shots/shotSizeLabels";
import { OutputFormatSelector } from "@/ui/shots/OutputFormatSelector";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const SAVE_SHOT_STATUS_ID = "director-desk-save-shot-status";
const PANEL_SECTION_GAP = 1;
const STATUS_TEXT_MARGIN_TOP = 0.5;

const SaveCurrentViewControl = observer(function SaveCurrentViewControl() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher } = stores;
    const available = camera.lastDirectorPose !== null;

    const saveCurrentView = () => {
        const pose = camera.lastDirectorPose;
        if (pose === null) return;
        const result = dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: {
                    id: camera.nextShotName(),
                    shot: { position: pose.position, target: pose.target, fov: pose.fov },
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<AddAPhotoIcon />}
                onClick={saveCurrentView}
                disabled={!available}
                aria-describedby={available ? undefined : SAVE_SHOT_STATUS_ID}
                fullWidth
            >
                当前视角存为机位
            </Button>
            {!available && (
                <Typography
                    id={SAVE_SHOT_STATUS_ID}
                    role="status"
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: STATUS_TEXT_MARGIN_TOP }}
                >
                    暂无可保存的自由视角
                </Typography>
            )}
        </>
    );
});
const ShotSizeControl = observer(function ShotSizeControl() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection } = stores;
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);
    const hasPrimaryId = selection.primaryId !== null;

    const applyShotSize = (size: ShotSize) => {
        setShotSize(size);

        const primaryId = selection.primaryId;
        if (primaryId === null) return;
        const result = dispatcher.dispatch(
            {
                type: "camera.frame-subject",
                payload: { shotId: camera.nextShotName(), subjectIds: [primaryId], shotSize: size },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Typography variant="caption" color="text.secondary">
                景别(作用于选中对象)
            </Typography>
            <Select
                size="small"
                fullWidth
                value={shotSize}
                onChange={(event) => applyShotSize(event.target.value as ShotSize)}
                disabled={!hasPrimaryId}
                aria-label="景别"
            >
                {Object.entries(SHOT_SIZE_LABELS).map(([size, label]) => (
                    <MenuItem key={size} value={size}>
                        {label}
                    </MenuItem>
                ))}
            </Select>
        </>
    );
});

/** 左栏 CAMERA 只承担机位存盘与景别生成;运镜预设与机位强相关,住在机位的右栏情境面板。 */
export const ShotPanel = observer(function ShotPanel() {
    return (
        <Box sx={{ p: 1.5 }}>
            <OutputFormatSelector />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <SaveCurrentViewControl />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <ShotSizeControl />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: STATUS_TEXT_MARGIN_TOP }}>
                运镜预设已移入机位面板:在大纲或视口选中机位后于右栏编排。
            </Typography>
        </Box>
    );
});
