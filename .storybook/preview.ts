import "@/styles/index.css";

import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
    parameters: {
        layout: "fullscreen",
        options: {
            // 模块钉序:与领域边界一致,新模块追加在「壳层」之前
            storySort: { order: ["场景", "演员", "镜头", "时间轴", "灯光", "输出", "工程", "壳层"] },
        },
    },
};

export default preview;
