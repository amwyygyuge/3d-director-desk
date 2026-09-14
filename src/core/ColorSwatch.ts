/**
 * 语义色块:一处颜色入口的内置词表条目。
 *
 * 三个场景(人偶外观、灯光色温、地板影调)各有自己的一张表,但形状必须同一个——
 * 取色面板是通用叶子控件,它只认这个结构;而各表都住在自己的领域里(人偶色不该由灯光模块定义)。
 * `labelZh` 同时是 UI 标签与 AI 可说的词:用户看到什么就能对模型说什么,禁止两处各写一套。
 */
export interface ColorSwatch {
    readonly id: string;
    readonly labelZh: string;
    /** `#rrggbb`,小写 */
    readonly hex: string;
}
