import { useEffect } from "react";
import type { RefObject } from "react";

import { activeShortcutScopes, registerBuiltinShortcuts } from "../shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "./DirectorDeskContext";

interface HotkeysProps {
    readonly deskRef: RefObject<HTMLDivElement | null>;
}

/**
 * 键盘事件接入层:只监听当前桌面根节点的冒泡事件。
 * 这让多个 DirectorDesk 可同时挂载而不互相执行命令，Dialog 打开时亦不会突变场景。
 */
export function Hotkeys({ deskRef }: HotkeysProps) {
    const stores = useDirectorDeskStores();

    useEffect(() => {
        const desk = deskRef.current;
        if (!desk) return undefined;
        const unregister = registerBuiltinShortcuts(stores.shortcuts);
        const onKeyDown = (event: KeyboardEvent) => {
            if (stores.ui.helpOpen) return;
            stores.shortcuts.handleKeyDown(event, stores, activeShortcutScopes(stores));
        };
        desk.addEventListener("keydown", onKeyDown);
        return () => {
            desk.removeEventListener("keydown", onKeyDown);
            unregister();
        };
    }, [deskRef, stores]);

    return null;
}
