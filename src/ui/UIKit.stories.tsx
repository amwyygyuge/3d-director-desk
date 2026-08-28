import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** UI 套件走查:shadcn 组件在主题契约下的默认观感 */
const meta: Meta = {
    title: "DirectorDesk/UIKit",
};

export default meta;

type Story = StoryObj;

export const Panel: Story = {
    render: function UIKitPanel() {
        const [fov, setFov] = useState([45]);
        const [enabled, setEnabled] = useState(true);
        const handleFovChange = (value: number | readonly number[]) => {
            setFov(Array.isArray(value) ? [...value] : [value]);
        };

        return (
            <TooltipProvider>
                <div className="flex w-80 flex-col gap-4 bg-background p-4 text-foreground">
                    <div className="flex items-center gap-2">
                        <Button size="sm">截图</Button>
                        <Button size="sm" variant="secondary">
                            重置机位
                        </Button>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button size="sm" variant="outline">
                                        机位
                                    </Button>
                                }
                            />
                            <TooltipContent>添加机位</TooltipContent>
                        </Tooltip>
                    </div>
                    <Separator />
                    <label className="flex items-center justify-between text-sm">
                        <span>显示网格</span>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </label>
                    <label className="flex flex-col gap-2 text-sm">
                        <span>FOV: {fov[0]}°</span>
                        <Slider value={fov} onValueChange={handleFovChange} min={10} max={120} />
                    </label>
                    <Input placeholder="机位名称" />
                    <Tabs defaultValue="scene">
                        <TabsList>
                            <TabsTrigger value="scene">场景</TabsTrigger>
                            <TabsTrigger value="camera">机位</TabsTrigger>
                        </TabsList>
                        <TabsContent value="scene">场景对象面板</TabsContent>
                        <TabsContent value="camera">机位面板</TabsContent>
                    </Tabs>
                    <Popover>
                        <PopoverTrigger
                            render={
                                <Button size="sm" variant="ghost">
                                    更多
                                </Button>
                            }
                        />
                        <PopoverContent>浮层内容</PopoverContent>
                    </Popover>
                </div>
            </TooltipProvider>
        );
    },
};
