import type { ShortcutChord } from "@/shortcuts/ShortcutChord";

/**
 * 作用域:global 常驻;rail 在左栏二级面板展开时激活;gizmo 在有选中时激活;
 * shot-selected 只在选中未激活机位时激活;shot 在掌镜时激活;
 * presentation 在全屏预览时独占(壳层已隐,编辑类键位一律让位)。
 */
export type ShortcutScope = "global" | "rail" | "gizmo" | "shot-selected" | "shot" | "presentation";

/** 快捷键绑定:spec(数据)× action(行为)的合体,注册表持有 */
export interface ShortcutBinding<TEnv> {
    readonly id: string;
    readonly chord: ShortcutChord;
    readonly scope: ShortcutScope;
    readonly run: (env: TEnv) => void;
}

/** 输入焦点在表单控件时,快捷键整体让位文本编辑 */
export function isEditingText(): boolean {
    const active = document.activeElement;
    return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
    );
}

/**
 * 快捷键注册表(管理器):绑定的注册/注销与按键分发。
 * 泛型 TEnv 由宿主注入(DirectorDeskStores),注册表本身不感知领域——机制与策略分离。
 * 每 DirectorDesk 实例一套(实例化纪律);匹配按注册顺序,先注册先命中。
 */
export class ShortcutRegistry<TEnv = unknown> {
    private readonly bindings: ShortcutBinding<TEnv>[] = [];

    /** 返回注销函数(React effect cleanup 用) */
    register(binding: ShortcutBinding<TEnv>): () => void {
        this.bindings.push(binding);
        return () => {
            const index = this.bindings.indexOf(binding);
            if (index >= 0) this.bindings.splice(index, 1);
        };
    }

    /** 命中即执行 + preventDefault,返回是否消费;未命中返回 false 让事件透传 */
    handleKeyDown(event: KeyboardEvent, env: TEnv, activeScopes: ReadonlySet<ShortcutScope>): boolean {
        if (isEditingText()) return false;
        const hit = this.bindings.find((b) => activeScopes.has(b.scope) && b.chord.matches(event));
        if (!hit) return false;
        event.preventDefault();
        hit.run(env);
        return true;
    }
}
