import { useEffect } from "react";

import { activeShortcutScopes, registerBuiltinShortcuts } from "../shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "./DirectorDeskContext";

/**
 * 键盘事件接入层(薄壳):window keydown → ShortcutRegistry。
 * 一切快捷键语义在 shortcuts/ 的 SPECS/ACTIONS 表;本组件只做挂载与作用域供给。
 * 后续接 Monet 事件系统时,只换本层的事件源。
 */
export function Hotkeys() {
    const stores = useDirectorDeskStores();

    useEffect(() => {
        const unregister = registerBuiltinShortcuts(stores.shortcuts);
        const onKeyDown = (event: KeyboardEvent) => {
            stores.shortcuts.handleKeyDown(event, stores, activeShortcutScopes(stores));
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            unregister();
        };
    }, [stores]);

    return null;
}
