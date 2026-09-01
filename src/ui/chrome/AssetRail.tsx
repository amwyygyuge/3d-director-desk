import CloseIcon from "@mui/icons-material/Close";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import type { ComponentType } from "react";

import { createDefaultLightParams } from "../../core/LightParams";
import { LIGHT_TYPES } from "../../core/LightParams";
import type { LightType } from "../../core/LightParams";
import type { RailSection } from "../../workspace/railSections";
import { RAIL_SECTION, RAIL_SECTION_DEFS, RAIL_SECTION_ORDER } from "../../workspace/railSections";
import { AssetLibraryPanel } from "../AssetLibraryPanel";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { LightModeToggle } from "../LightModeToggle";
import { OutlinerPanel } from "../OutlinerPanel";
import { ShotPanel } from "../ShotPanel";
import { placementFor } from "../importFiles";
import { CHROME } from "../theme";

const RAIL_COLLAPSED_WIDTH = `${CHROME.railCollapsedPx}px`;
const RAIL_EXPANDED_WIDTH = `${CHROME.railExpandedPx}px`;
const RAIL_MAX_HEIGHT = "70vh";
const RAIL_PADDING_PX = 4;
/** 图标列宽 = 收起态细条减去玻璃内边距;两者绑死,细条改宽图标不会跑偏 */
const RAIL_ICON_COLUMN_PX = CHROME.railCollapsedPx - RAIL_PADDING_PX * 2;
const RAIL_LABEL_PADDING_RIGHT = 1.5;
const RAIL_FLYOUT_MARGIN_LEFT = 1;
const PANEL_CONTENT_PADDING = 1.5;
const RAIL_HEADER_PADDING_TOP = 1;
const LIGHT_MENU_ID = "director-desk-light-creation-menu";
const LIGHT_CREATION_COMMAND = "object.place";
const LIGHT_OBJECT_KIND = "light";
const LIGHT_ID_PREFIX = "light-";
const LIGHT_NAME_SUFFIX_LENGTH = 4;
const LIGHT_ELEVATION = 3;
const LIGHT_ROTATION: [number, number, number] = [0, 0, 0];
const LIGHT_SCALE: [number, number, number] = [1, 1, 1];
const LIGHT_TYPE_LABELS: Record<LightType, string> = {
    directional: "平行光",
    point: "点光",
    spot: "聚光",
};


/** 灯光入口只组装可序列化命令,场景实体始终由命令层创建。 */
const LightSection = observer(function LightSection() {
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
        <Box sx={{ display: "flex", flexDirection: "column", gap: PANEL_CONTENT_PADDING, p: PANEL_CONTENT_PADDING }}>
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

const RAIL_SECTION_PANELS: Record<RailSection, ComponentType> = {
    [RAIL_SECTION.OUTLINE]: OutlinerPanel,
    [RAIL_SECTION.ASSETS]: AssetLibraryPanel,
    [RAIL_SECTION.CAMERA]: ShotPanel,
    [RAIL_SECTION.LIGHT]: LightSection,
};

/** 分区身份也自取:父组件不再因 railSection 变化而重渲整条图标栏。 */
const RailFlyout = observer(function RailFlyout() {
    const { layout } = useDirectorDeskStores();
    const section = layout.railSection;
    if (section === null) return null;
    const Panel = RAIL_SECTION_PANELS[section];
    const definition = RAIL_SECTION_DEFS[section];

    return (
        <Paper
            variant="panel"
            className="pointer-events-auto"
            sx={{
                display: "flex",
                flexDirection: "column",
                width: CHROME.flyoutWidthPx,
                ml: RAIL_FLYOUT_MARGIN_LEFT,
                maxHeight: RAIL_MAX_HEIGHT,
            }}
        >
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: PANEL_CONTENT_PADDING,
                    pt: RAIL_HEADER_PADDING_TOP,
                }}
            >
                <Typography variant="overline">{definition.label}</Typography>
                <IconButton
                    size="small"
                    aria-label={`关闭${definition.label}`}
                    onClick={() => layout.toggleRailSection(section)}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <Panel />
            </Box>
        </Paper>
    );
});

/**
 * 分区按钮:选中态与开合动作都自取,props 只收分区身份。
 * 这样切换分区不会重渲整条图标栏,只有涉及的两个按钮重画。
 */
const RailSectionButton = observer(function RailSectionButton({ section }: { readonly section: RailSection }) {
    const { layout } = useDirectorDeskStores();
    const definition = RAIL_SECTION_DEFS[section];
    const SectionIcon = definition.icon;
    // 不挂 Tooltip:鼠标停在图标上必然已触发 hover 展开,文字标签就在旁边,
    // 再浮一层提示只会盖住刚展开的抽屉;无障碍名由 aria-label 承担
    return (
        <ListItemButton
            selected={layout.railSection === section}
            aria-label={definition.label}
            onClick={() => layout.toggleRailSection(section)}
            sx={{ width: RAIL_EXPANDED_WIDTH, px: 0, pr: RAIL_LABEL_PADDING_RIGHT }}
        >
            {/* 图标列宽 = 收起态可见宽度,图标才会落在细条正中而非被右侧裁掉 */}
            <ListItemIcon sx={{ minWidth: RAIL_ICON_COLUMN_PX, justifyContent: "center" }}>
                <SectionIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={definition.label} />
        </ListItemButton>
    );
});

/** 左侧资产中枢:CSS hover 仅展开标签,钉住的二级内容由 layout 聚合统一编排。 */
export const AssetRail = observer(function AssetRail() {
    const { layout } = useDirectorDeskStores();
    if (layout.authoringVisible === false) return null;

    return (
        <Box
            className="absolute top-1/2 -translate-y-1/2 z-20 pointer-events-auto flex"
            sx={{ left: CHROME.edgeGapPx }}
        >
            <Paper
                variant="panel"
                className="pointer-events-auto"
                sx={{
                    width: RAIL_COLLAPSED_WIDTH,
                    overflow: "hidden",
                    transition: `width ${CHROME.transition}`,
                    whiteSpace: "nowrap",
                    maxHeight: RAIL_MAX_HEIGHT,
                    p: `${RAIL_PADDING_PX}px`,
                    "&:hover": { width: RAIL_EXPANDED_WIDTH },
                }}
            >
                <List disablePadding>
                    {RAIL_SECTION_ORDER.map((section) => (
                        <RailSectionButton key={section} section={section} />
                    ))}
                </List>
            </Paper>
            <RailFlyout />
        </Box>
    );
});
