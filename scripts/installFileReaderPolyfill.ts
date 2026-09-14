/**
 * `GLTFExporter` 的二进制分支依赖浏览器的 `FileReader`;Bun/Node 无此全局。
 *
 * 单独成模块而非写在调用方文件里:副作用必须在 exporter 模块被求值**之前**生效,
 * 而 ES module 的 import 提升会让同文件内的语句顺序失去意义。
 * 调用方 `import "./installFileReaderPolyfill"` 排在 exporter 之前即可。
 */
class NodeFileReader {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((buffer) => {
            this.result = buffer;
            this.onloadend?.();
        });
    }

    readAsDataURL(blob: Blob): void {
        void blob.arrayBuffer().then((buffer) => {
            this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
            this.onloadend?.();
        });
    }
}

if (!("FileReader" in globalThis)) {
    Object.assign(globalThis, { FileReader: NodeFileReader });
}
