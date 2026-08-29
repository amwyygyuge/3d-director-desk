import LightModeIcon from "@mui/icons-material/LightMode";
import TuneIcon from "@mui/icons-material/Tune";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { observer } from "mobx-react-lite";
import type { MouseEvent } from "react";

import { LIGHTING_MODE } from "../store/SceneStore";
import type { LightingMode } from "../store/SceneStore";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const STUDIO_LABEL = "演播室";
const CUSTOM_LABEL = "自定义";
const MODE_SWITCH_LABEL = "场景灯光模式";
const COMMAND_FAILURE_PREFIX = "灯光模式切换失败: ";

/** 灯光模式仅派发场景命令；实际 StudioRig 在 Canvas 内响应并显式补帧。 */
export const LightModeToggle = observer(function LightModeToggle() {
    const stores = useDirectorDeskStores();
    const lightingMode = stores.scene.lightingMode;

    const changeLightingMode = (_event: MouseEvent<HTMLElement>, mode: LightingMode | null) => {
        if (!mode || mode === lightingMode) return;
        const result = stores.dispatcher.dispatch({ type: "scene.set-lighting-mode", payload: { mode } }, stores);
        if (!result.ok)
            stores.ui.setApplicationNotice(`${COMMAND_FAILURE_PREFIX}${result.issues?.join(";") ?? result.error}`);
    };

    return (
        <ToggleButtonGroup
            exclusive
            aria-label={MODE_SWITCH_LABEL}
            size="small"
            value={lightingMode}
            onChange={changeLightingMode}
        >
            <ToggleButton value={LIGHTING_MODE.STUDIO} aria-label={STUDIO_LABEL}>
                <LightModeIcon fontSize="small" />
                {STUDIO_LABEL}
            </ToggleButton>
            <ToggleButton value={LIGHTING_MODE.CUSTOM} aria-label={CUSTOM_LABEL}>
                <TuneIcon fontSize="small" />
                {CUSTOM_LABEL}
            </ToggleButton>
        </ToggleButtonGroup>
    );
});
