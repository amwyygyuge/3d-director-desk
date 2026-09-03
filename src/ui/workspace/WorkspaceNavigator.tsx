import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";
import type { ComponentType } from "react";

import { WORKSPACE_SECTION, WORKSPACE_SECTION_DEFS, WORKSPACE_SECTION_ORDER } from "@/workspace/workspaceSections";
import type { WorkspaceSection } from "@/workspace/workspaceSections";
import { AssetLibraryPanel } from "@/ui/assets/AssetLibraryPanel";
import { LightSection } from "@/ui/lighting/LightSection";
import { OutlinerPanel } from "@/ui/outline/OutlinerPanel";
import { ShotPanel } from "@/ui/shots/ShotPanel";
import { ProgramReviewPanel } from "@/ui/review/ProgramReviewPanel";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { SHELL_MODE } from "@/store/WorkbenchLayoutStore";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME, sidePanelBottomOffset } from "@/ui/shell/theme";

const SECTION_PANELS: Record<WorkspaceSection, ComponentType> = {
    [WORKSPACE_SECTION.OUTLINE]: OutlinerPanel,
    [WORKSPACE_SECTION.ASSETS]: AssetLibraryPanel,
    [WORKSPACE_SECTION.CAMERA]: ShotPanel,
    [WORKSPACE_SECTION.LIGHT]: LightSection,
    [WORKSPACE_SECTION.REVIEW]: ProgramReviewPanel,
};

const navigatorTabId = (section: WorkspaceSection): string => `navigator-tab-${section}`;
const navigatorPanelId = (section: WorkspaceSection): string => `navigator-panel-${section}`;
const NAVIGATOR_TOGGLE_HEIGHT_PX = 64;
const NAVIGATOR_TOGGLE_WIDTH_PX = 40;

/** 左栏开合由 WorkbenchLayoutStore 承载；展开态停在右侧中部，收起态落在图标轨水平中心。 */
const NavigatorCollapseToggle = observer(function NavigatorCollapseToggle() {
    const { layout } = useDirectorDeskStores();
    const collapsed = layout.navigatorCollapsed;
    const label = collapsed ? "展开左侧面板" : "收起左侧面板";
    return (
        <Tooltip title={`${label}（${formatShortcutHint(SHORTCUT_ID.NAVIGATOR_TOGGLE)}）`}>
            <IconButton
                aria-label={label}
                className="pointer-events-auto absolute z-10"
                disableRipple
                onClick={() => layout.toggleNavigatorCollapsed()}
                sx={{
                    bgcolor: "transparent",
                    height: NAVIGATOR_TOGGLE_HEIGHT_PX,
                    left: collapsed ? "50%" : "auto",
                    right: collapsed ? "auto" : 0,
                    position: "absolute",
                    top: "50%",
                    transform: collapsed ? "translate(-50%, -50%)" : "translateY(-50%)",
                    width: NAVIGATOR_TOGGLE_WIDTH_PX,
                    "&:hover, &.Mui-focusVisible": { bgcolor: "transparent", color: "primary.main" },
                }}
            >
                {collapsed ? <KeyboardArrowRightIcon fontSize="large" /> : <KeyboardArrowLeftIcon fontSize="large" />}
            </IconButton>
        </Tooltip>
    );
});

/** 分区 tab 条:单级平铺导航,互斥单选;选中态与切换都自取,重渲限在条内。 */
const NavigatorTabBar = observer(function NavigatorTabBar() {
    const { layout } = useDirectorDeskStores();
    return (
        <Tabs
            value={layout.activeSection}
            onChange={(_event, section: WorkspaceSection) => layout.activateWorkspaceSection(section)}
            variant="fullWidth"
            aria-label="工作台导航分区"
            sx={{ flex: "none", minHeight: 0, borderBottom: 1, borderColor: "divider" }}
        >
            {WORKSPACE_SECTION_ORDER.map((section) => {
                const definition = WORKSPACE_SECTION_DEFS[section];
                const SectionIcon = definition.icon;
                return (
                    <Tab
                        key={section}
                        value={section}
                        id={navigatorTabId(section)}
                        aria-controls={navigatorPanelId(section)}
                        aria-label={definition.label}
                        icon={
                            <Tooltip enterDelay={0} title={definition.label}>
                                <span>
                                    <SectionIcon fontSize="small" />
                                </span>
                            </Tooltip>
                        }
                        sx={{ minWidth: 0, px: 0.5 }}
                    />
                );
            })}
        </Tabs>
    );
});

/** 收起态复用 review 图标轨；展开把手由容器中右侧统一承载，避免覆盖分区入口。 */
const NavigatorIconRail = observer(function NavigatorIconRail() {
    const { layout } = useDirectorDeskStores();
    return (
        <Tabs
            orientation="vertical"
            value={layout.activeSection}
            onChange={(_event, section: WorkspaceSection) => layout.activateWorkspaceSection(section)}
            aria-label="工作台导航分区"
            sx={{ width: CHROME.navigatorIconRailWidthPx, minWidth: 0 }}
        >
            {WORKSPACE_SECTION_ORDER.map((section) => {
                const definition = WORKSPACE_SECTION_DEFS[section];
                const SectionIcon = definition.icon;
                return (
                    <Tab
                        key={section}
                        value={section}
                        aria-label={definition.label}
                        icon={<SectionIcon fontSize="small" />}
                        sx={{ minWidth: 0, minHeight: CHROME.navigatorIconRailWidthPx }}
                    />
                );
            })}
        </Tabs>
    );
});

/** 当前分区内容:tab 切换即挂载/卸载,未选中的分区不留树里跟渲染。 */
const ActiveSectionPanel = observer(function ActiveSectionPanel() {
    const { layout } = useDirectorDeskStores();
    const section = layout.activeSection;
    const Panel = SECTION_PANELS[section];
    return (
        <Box
            role="tabpanel"
            id={navigatorPanelId(section)}
            aria-labelledby={navigatorTabId(section)}
            sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}
        >
            <Panel />
        </Box>
    );
});

/**
 * 左侧工作台导航:大纲/资产/机位/灯光四分区的常驻通高容器。
 * 顶部项目菜单已移至右侧工具栏，左栏可直达安全边距；完整面板与图标轨的切换由 layout 聚合根裁决。
 */
export const WorkspaceNavigator = observer(function WorkspaceNavigator() {
    const { layout } = useDirectorDeskStores();
    if (!layout.chromeVisible) return null;
    const collapsed = layout.navigatorCollapsed;

    return (
        <Box
            className="pointer-events-none absolute z-20"
            sx={{
                bottom: sidePanelBottomOffset(),
                left: CHROME.edgeGapPx,
                top: CHROME.edgeGapPx,
                width: collapsed ? CHROME.navigatorIconRailWidthPx : CHROME.sidePanelWidthPx,
            }}
        >
            <Paper
                variant="panel"
                className="pointer-events-auto absolute inset-0 flex flex-col"
                sx={{ overflow: "hidden" }}
            >
                {collapsed ? <NavigatorIconRail /> : <NavigatorTabBar />}
                {collapsed ? null : <ActiveSectionPanel />}
            </Paper>
            {layout.shellMode !== SHELL_MODE.REVIEW ? <NavigatorCollapseToggle /> : null}
        </Box>
    );
});
