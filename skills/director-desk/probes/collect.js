/**
 * 采集探针:在页面里跑一次,把导演台当前状态导出为分析层认识的 JSON 契约。
 *
 * 用法:
 *   await tab.evaluate(await Bun.file("skills/director-desk/probes/collect.js").text());
 *   const raw = await tab.evaluate(`window.__collect()`);
 *   // raw 即 analyze.py 期望的输入
 *
 * 边界:这里只读、只导出,不做任何判定。所有数学在 Python 侧。
 */
(() => {
    const desk = window.__directorDesk;
    if (!desk) throw new Error("__directorDesk 不存在:页面未就绪或不是 playground");

    const collect = () => {
        const doc = desk.dispatcher.query({ type: "desk.export-document", payload: {} }, desk);
        const document = doc && doc.ok ? doc.value : null;
        if (!document) throw new Error("desk.export-document 失败");
        return JSON.stringify(document);
    };

    window.__collect = collect;
    return "collect installed: window.__collect()";
})();
