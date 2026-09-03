import type { ShortcutChord } from "@/shortcuts/ShortcutChord";

/**
 * 作用域:global 常驻;selected 在有主选时激活(删除/聚焦/打点/G 进入变换);
 * gizmo 在变换已激活(G 挂载坐标轴)时激活——X/Y/Z 轴约束与 Esc 退出变换只在该态生效;
 * shot-selected 只在选中未激活机位时激活;shot 在掌镜时激活;
 * lens 在镜头视角(视口跟随时间轴输出、手势写镜头关键帧)时激活;
 * timeline 在指针停在时间线控制台内时激活(播放头步进、入出点、缩放、吸附开关):
 * 它与视口飞行导航共用 Space/S 等物理键,归属只由指针裁决——飞行侧在同一条件下整体让位;
 * timeline-selection 在时间轴上选中片段/关键帧/标记时激活(Esc 清选、Delete 删除),
 * 它必须排在 selected 之前,否则 Delete 会先命中删除场景选中;
 * draft 在走位草绘模式时激活(只有 Esc 退出,排在 gizmo/selected 的 Esc 之前);
 * presentation 在全屏预览时独占(壳层已隐,编辑类键位一律让位)。
 */
export type ShortcutScope =
    | "global"
    | "selected"
    | "gizmo"
    | "shot-selected"
    | "shot"
    | "lens"
    | "timeline"
    | "timeline-selection"
    | "draft"
    | "presentation";

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
