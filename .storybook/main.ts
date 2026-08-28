import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
    stories: ["../src/**/*.stories.@(ts|tsx)"],
    addons: [],
    // 测试资产(gitignored)经 /test-assets/ 提供给验收 story
    staticDirs: ["../public"],
    framework: {
        name: "@storybook/react-vite",
        options: {},
    },
};

export default config;
