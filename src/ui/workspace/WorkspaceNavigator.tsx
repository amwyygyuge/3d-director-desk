import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { observer } from "mobx-react-lite";
import type { ComponentType } from "react";

import { WORKSPACE_SECTION, WORKSPACE_SECTION_DEFS, WORKSPACE_SECTION_ORDER } from "@/workspace/workspaceSections";
import type { WorkspaceSection } from "@/workspace/workspaceSections";
import { AssetLibraryPanel } from "@/ui/assets/AssetLibraryPanel";
import { LightSection } from "@/ui/lighting/LightSection";
import { OutlinerPanel } from "@/ui/outline/OutlinerPanel";
import { ShotPanel } from "@/ui/shots/ShotPanel";
import { SHELL_MODE } from "@/store/WorkbenchLayoutStore";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME, sidePanelBottomOffsetPx } from "@/ui/shell/theme";

const SECTION_PANELS: Record<WorkspaceSection, ComponentType> = {
    [WORKSPACE_SECTION.OUTLINE]: OutlinerPanel,
    [WORKSPACE_SECTION.ASSETS]: AssetLibraryPanel,
    [WORKSPACE_SECTION.CAMERA]: ShotPanel,
    [WORKSPACE_SECTION.LIGHT]: LightSection,
};

const navigatorTabId = (section: WorkspaceSection): string => `navigator-tab-${section}`;
const navigatorPanelId = (section: WorkspaceSection): string => `navigator-panel-${section}`;

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
                        icon={<SectionIcon fontSize="small" />}
                        iconPosition="start"
                        label={definition.shortLabel}
                    />
                );
            })}
        </Tabs>
    );
});

/** review 只保留分区直达:内容面板卸载，避免运镜播放期后台跟随 observable 重渲。 */
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
 * 几何与右侧检查器镜像(同宽、同上缘、同骑时间线联动);分区经顶部 tab 单级直达,
 * 切换瞬时完成——indicator 的尺寸过渡已在主题禁用(left/width 过渡无法合成器化)。
 */
export const WorkspaceNavigator = observer(function WorkspaceNavigator() {
    const { layout } = useDirectorDeskStores();
    if (!layout.chromeVisible) return null;
    const review = layout.shellMode === SHELL_MODE.REVIEW;

    return (
        <Paper
            variant="panel"
            className="pointer-events-auto absolute z-20 flex flex-col"
            sx={{
                left: CHROME.edgeGapPx,
                top: CHROME.sidePanelTopPx,
                bottom: sidePanelBottomOffsetPx(layout.timelineExpanded),
                width: review ? CHROME.navigatorIconRailWidthPx : CHROME.sidePanelWidthPx,
                overflow: "hidden",
            }}
        >
            {review ? <NavigatorIconRail /> : <NavigatorTabBar />}
            {review ? null : <ActiveSectionPanel />}
        </Paper>
    );
});
