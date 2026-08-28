import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "./DirectorDesk";

const meta: Meta<typeof DirectorDesk> = {
    title: "DirectorDesk/DirectorDesk",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

export const Empty: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk />
        </div>
    ),
};
