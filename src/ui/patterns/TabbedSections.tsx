import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { observer } from "mobx-react-lite";
import type { ComponentType, ReactNode } from "react";

const TAB_BAR_MIN_HEIGHT_PX = 36;
const CONTENT_PADDING = 1.5;
const CONTENT_GAP = 1;

/**
 * 上下文面板(右栏检查器等)的通用分 tab 模式。
 * 一个 tab 描述一个内容分类;content 是组件类型而非元素,
 * 保证未激活 tab 完全不挂载(画布之上的性能红线:收起即卸载)。
 */
export interface TabSpec<C> {
    readonly id: string;
    readonly label: string;
    readonly content: ComponentType<C>;
    /** 纯函数可见性谓词:在 observer 渲染期求值,读 observable 会被追踪。 */
    readonly visible?: (context: C) => boolean;
}

/**
 * tab 注册表:按上下文类型(如检查器选中类型)登记 tab,声明式装配。
 * 扩展新分类时只需 register 一条 TabSpec,宿主组件零改动。
 */
export class TabSectionRegistry<K extends string, C> {
    private readonly tabsByKind = new Map<K, TabSpec<C>[]>();

    register(kind: K, tab: TabSpec<C>): void {
        const tabs = this.tabsByKind.get(kind) ?? [];
        this.tabsByKind.set(kind, [...tabs, tab]);
    }

    tabsFor(kind: K): readonly TabSpec<C>[] {
        return this.tabsByKind.get(kind) ?? [];
    }
}

interface TabbedSectionsProps<C> {
    readonly tabs: readonly TabSpec<C>[];
    /** 调用方记忆的 tab id;不可见或缺失时回退到第一个可见 tab。 */
    readonly activeTabId: string | undefined;
    readonly onSelect: (tabId: string) => void;
    readonly context: C;
}

/**
 * tab 条 + 内容区:单 tab 时不渲染 tab 条(短面板不添噪音),
 * 内容区统一内边距与纵向间距,各分类区块不再自带分隔线。
 */
export const TabbedSections = observer(function TabbedSections<C extends object>({
    tabs,
    activeTabId,
    onSelect,
    context,
}: TabbedSectionsProps<C>) {
    const visibleTabs = tabs.filter((tab) => tab.visible?.(context) ?? true);
    const active = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0];
    if (!active) return null;
    const Content = active.content;

    return (
        <>
            {visibleTabs.length > 1 && (
                <Tabs
                    value={active.id}
                    onChange={(_, tabId: string) => onSelect(tabId)}
                    variant="fullWidth"
                    sx={{ minHeight: TAB_BAR_MIN_HEIGHT_PX, borderBottom: 1, borderColor: "divider" }}
                >
                    {visibleTabs.map((tab) => (
                        <Tab
                            key={tab.id}
                            value={tab.id}
                            label={tab.label}
                            sx={{ minHeight: TAB_BAR_MIN_HEIGHT_PX, minWidth: 0, py: 0 }}
                        />
                    ))}
                </Tabs>
            )}
            <Box sx={{ display: "grid", gap: CONTENT_GAP, p: CONTENT_PADDING }}>
                <Content {...context} />
            </Box>
        </>
    );
}) as <C extends object>(props: TabbedSectionsProps<C>) => ReactNode;
