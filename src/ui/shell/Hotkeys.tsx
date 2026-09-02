import { useEffect } from "react";
import type { RefObject } from "react";

import { activeShortcutScopes, registerBuiltinShortcuts } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

interface HotkeysProps {
    readonly deskRef: RefObject<HTMLDivElement | null>;
}

/** 最近交互的桌面根节点:无元素聚焦(body)时按键路由给它;进程级「焦点」语义天然全局,故收在模块态 */
const ACTIVE_DESK: { current: HTMLElement | null } = { current: null };

/**
 * 键盘事件接入层:window 监听 + 归属过滤。
 * - 事件目标落在本桌面内 → 处理(多实例隔离、Dialog/宿主输入天然跳过);
 * - 无元素聚焦(activeElement=body)→ 路由给最近交互的桌面(焦点被 blur/抢走后不失效);
 * - 相比"desk.focus()+子树监听":不依赖脆弱的 DOM 焦点副作用。
 */
export function Hotkeys({ deskRef }: HotkeysProps) {
    const stores = useDirectorDeskStores();

    useEffect(() => {
        const desk = deskRef.current;
        if (!desk) return undefined;
        const markActive = () => {
            ACTIVE_DESK.current = desk;
        };
        const unregister = registerBuiltinShortcuts(stores.shortcuts);
        const onKeyDown = (event: KeyboardEvent) => {
            // 速查浮层与 ⌘K 面板打开期间全局快捷键让位(面板内按键由 input 焦点的 isEditingText 天然拦截,此处再兜焦点被夺的边)
            if (stores.ui.helpOpen || stores.ui.paletteOpen) return;
            const inside = event.target instanceof Node && desk.contains(event.target);
            const noFocusFallback =
                (document.activeElement === document.body || document.activeElement === document.documentElement) &&
                ACTIVE_DESK.current === desk;
            if (!inside && !noFocusFallback) return;
            stores.shortcuts.handleKeyDown(event, stores, activeShortcutScopes(stores));
        };
        desk.addEventListener("pointerdown", markActive);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            desk.removeEventListener("pointerdown", markActive);
            window.removeEventListener("keydown", onKeyDown);
            unregister();
        };
    }, [deskRef, stores]);

    return null;
}
