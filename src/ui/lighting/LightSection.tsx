import LightbulbIcon from "@mui/icons-material/Lightbulb";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { createDefaultLightParams } from "@/core/LightParams";
import { LIGHT_TYPES } from "@/core/LightParams";
import type { LightType } from "@/core/LightParams";
import { placementFor } from "@/ui/assets/importFiles";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { LightModeToggle } from "@/ui/workspace/LightModeToggle";

const LIGHT_MENU_ID = "director-desk-light-creation-menu";
const LIGHT_CREATION_COMMAND = "object.place";
const LIGHT_OBJECT_KIND = "light";
const LIGHT_ID_PREFIX = "light-";
const LIGHT_NAME_SUFFIX_LENGTH = 4;
const LIGHT_ELEVATION = 3;
const LIGHT_ROTATION: [number, number, number] = [0, 0, 0];
const LIGHT_SCALE: [number, number, number] = [1, 1, 1];
const SECTION_CONTENT_PADDING = 1.5;
const LIGHT_TYPE_LABELS: Record<LightType, string> = {
    directional: "平行光",
    point: "点光",
    spot: "聚光",
};

/** 灯光入口只组装可序列化命令,场景实体始终由命令层创建。 */
export const LightSection = observer(function LightSection() {
    const stores = useDirectorDeskStores();
    const { dispatcher, scene } = stores;
    const [lightMenuAnchor, setLightMenuAnchor] = useState<HTMLElement | null>(null);

    const placeLight = (type: LightType) => {
        const [x, , z] = placementFor(scene.objectCount);
        const id = `${LIGHT_ID_PREFIX}${crypto.randomUUID()}`;
        const label = LIGHT_TYPE_LABELS[type];
        const result = dispatcher.dispatch(
            {
                type: LIGHT_CREATION_COMMAND,
                payload: {
                    id,
                    kind: LIGHT_OBJECT_KIND,
                    name: `${label} ${id.slice(-LIGHT_NAME_SUFFIX_LENGTH)}`,
                    light: createDefaultLightParams(type),
                    transform: {
                        position: [x, LIGHT_ELEVATION, z],
                        rotation: LIGHT_ROTATION,
                        scale: LIGHT_SCALE,
                    },
                },
            },
            stores,
        );
        setLightMenuAnchor(null);
        if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };

    return (
        <Box
            sx={{ display: "flex", flexDirection: "column", gap: SECTION_CONTENT_PADDING, p: SECTION_CONTENT_PADDING }}
        >
            <Button
                variant="outlined"
                startIcon={<LightbulbIcon />}
                aria-controls={lightMenuAnchor ? LIGHT_MENU_ID : undefined}
                aria-haspopup="menu"
                onClick={(event) => setLightMenuAnchor(event.currentTarget)}
            >
                添加灯光
            </Button>
            <LightModeToggle />
            <Menu
                id={LIGHT_MENU_ID}
                anchorEl={lightMenuAnchor}
                open={lightMenuAnchor !== null}
                onClose={() => setLightMenuAnchor(null)}
            >
                {LIGHT_TYPES.map((type) => (
                    <MenuItem key={type} onClick={() => placeLight(type)}>
                        添加{LIGHT_TYPE_LABELS[type]}
                    </MenuItem>
                ))}
            </Menu>
        </Box>
    );
});
