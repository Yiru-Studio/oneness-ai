# EntityDetailDrawer 图片点击放大预览设计

## 背景

`EntityDetailDrawer` 组件（位于 `apps/web/src/components/projects/EntityDetailDrawer.tsx`）用于展示物品、场景、造型、角色头像等实体的详情。其中包含一个图片预览区域，当前图片以普通 `<img>` 标签渲染，用户无法放大查看细节。

## 目标

在 `EntityDetailDrawer` 中点击已生成的图片时，弹出全屏遮罩层显示大图，支持点击遮罩或按 ESC 关闭。

## 方案

采用通用组件方案：新建 `ImagePreview` 组件，在 `EntityDetailDrawer` 中引入使用。

### ImagePreview 组件

- **位置**：`apps/web/src/components/ImagePreview.tsx`
- **Props**：
  - `src: string` — 图片 URL
  - `alt?: string` — 可选 alt 文本
  - `open: boolean` — 控制显示/隐藏
  - `onClose: () => void` — 关闭回调
- **行为**：
  - `open === false` 时返回 `null`
  - 固定定位全屏遮罩（`fixed inset-0`），背景 `bg-black/80`
  - z-index 为 `z-[2000]`，高于 Drawer 的 `z-[1900]`
  - 图片居中，`object-contain`，最大宽度 `90vw`，最大高度 `90vh`
  - 右上角显示关闭按钮（`X` 图标，白色）
  - 点击遮罩背景关闭
  - 按 ESC 键关闭（`useEffect` 监听 `keydown`）

### EntityDetailDrawer 改动

- 引入 `ImagePreview` 组件
- 新增 `previewOpen` 状态（`useState(false)`）
- 图片区域添加 `cursor-pointer`，点击设置 `previewOpen = true`
- 在组件底部渲染 `<ImagePreview src={image} alt={name} open={previewOpen} onClose={() => setPreviewOpen(false)} />`

## 样式约定

- 与项目中现有 Modal 模式（`LoginModal`）保持一致：固定定位遮罩 + 内容区 + 点击遮罩关闭
- 关闭按钮使用 `lucide-react` 的 `X` 图标
- 不使用第三方 lightbox 库，保持零依赖
