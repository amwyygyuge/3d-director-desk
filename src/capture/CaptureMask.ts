/**
 * 采集期让位物:非 Object3D 的编辑期视觉(材质 uniform 等)。
 *
 * HelperVisibilityTransaction 只认 Object3D.visible,摘不到 uniform;
 * 这类视觉必须自报收起与复原,跟随 hideHelpers 一起生效,否则会烙进照片与成片。
 */
export interface CaptureMask {
    suppress(): void;
    restore(): void;
}
