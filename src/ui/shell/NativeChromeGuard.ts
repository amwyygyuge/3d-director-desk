import { NATIVE_MENU_ATTRIBUTE } from "@/ui/shell/theme";

/**
 * 放行原生右键菜单的元素:输入框与可编辑区必须留着「剪切/复制/粘贴」——
 * macOS 上不少作者只用右键粘贴,一并掐掉是可用性倒退而非工具味。
 */
const NATIVE_MENU_SELECTOR = `input, textarea, [contenteditable='true'], [${NATIVE_MENU_ATTRIBUTE}]`;

/** 浏览器页面缩放手势:触控板捏合在 Chrome/Safari 上就是 ctrl+wheel */
function isPageZoomGesture(event: WheelEvent): boolean {
    return event.ctrlKey;
}

/**
 * 导演台原生浏览器行为的收口处(「去 web 味」的事件半边,CSS 半边在 theme 的 TOOL_CHROME_SX)。
 *
 * 为什么收成一个类:这些拦截彼此无关却同源——都是「浏览器默认帮了倒忙」,
 * 散在各组件的 useEffect 里会重复绑定、漏解绑,且下次要掐哪条原生行为无处可查。
 * 本类是唯一挂点,生命周期与导演台根节点一致,dispose() 保证零残留监听。
 *
 * 拦截清单与理由:
 * - `contextmenu`:视口/侧栏/药丸的右键必须归导演台自己(时间线与镜头 key 已有自定义菜单),
 *   浏览器菜单出现在 3D 工具里既无用又抢走了右键这个交互位。输入区按白名单放行。
 * - `dragstart`:缩略图与人偶画像按住会拖出半透明图片幽灵,导演台没有任何原生拖拽语义。
 * - `dragover` / `drop`:未被业务消费的拖放会被浏览器当成「打开文件」,直接导航离开页面、
 *   丢掉未保存工程。模型导入走的是隐藏 file input,所以此处一律吞掉。
 * - `wheel`(ctrl):React 18 把 wheel 以 passive 挂在容器上,组件里的 preventDefault 静默无效,
 *   捏合会穿透成浏览器页面缩放;必须以非 passive 原生监听拦下。普通滚动不受影响。
 *
 * 时序说明:本类挂在导演台根节点(React 挂载容器的后代),原生监听先于 React 合成事件触发。
 * `preventDefault()` 只压浏览器默认动作,不阻断后续处理器,自定义右键菜单照常弹出。
 */
export class NativeChromeGuard {
    private element: HTMLElement | null = null;

    private readonly onContextMenu = (event: MouseEvent): void => {
        const target = event.target;
        if (target instanceof Element && target.closest(NATIVE_MENU_SELECTOR)) return;
        event.preventDefault();
    };

    private readonly onDragStart = (event: DragEvent): void => {
        event.preventDefault();
    };

    /** dragover 也必须拦:不拦则 drop 不会派发到本节点,浏览器直接接管文件 */
    private readonly onDragOver = (event: DragEvent): void => {
        event.preventDefault();
    };

    private readonly onDrop = (event: DragEvent): void => {
        event.preventDefault();
    };

    private readonly onWheel = (event: WheelEvent): void => {
        if (isPageZoomGesture(event)) event.preventDefault();
    };

    /** 幂等:重复 attach 先解绑旧节点,避免 StrictMode 双调用叠加监听 */
    attach(element: HTMLElement): void {
        this.dispose();
        this.element = element;
        element.addEventListener("contextmenu", this.onContextMenu);
        element.addEventListener("dragstart", this.onDragStart);
        element.addEventListener("dragover", this.onDragOver);
        element.addEventListener("drop", this.onDrop);
        // 非 passive 是 preventDefault 生效的前提
        element.addEventListener("wheel", this.onWheel, { passive: false });
    }

    dispose(): void {
        const element = this.element;
        if (!element) return;
        this.element = null;
        element.removeEventListener("contextmenu", this.onContextMenu);
        element.removeEventListener("dragstart", this.onDragStart);
        element.removeEventListener("dragover", this.onDragOver);
        element.removeEventListener("drop", this.onDrop);
        element.removeEventListener("wheel", this.onWheel);
    }
}
