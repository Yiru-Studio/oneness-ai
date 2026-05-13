# Oneness-AI — likeai.pro UI 克隆设计文档

## 1. 项目概述

复刻 https://likeai.pro/ 的全部页面 UI，品牌名改为 **Oneness-AI**（替换所有 LIKE AI .pro 的文案和 logo）。使用 Next.js 16 App Router + React 19 + Tailwind CSS v4 + shadcn/ui 技术栈。

**范围**：纯 UI 复刻，使用 mock 数据。所有数据层通过 `lib/api.ts` 中的接口隔离，后续替换为真实 API 时只需修改该文件。

**目标目录**：`/home/liuz747/Jobs/oneness-ai/`

---

## 2. 页面清单

| # | 页面 | 路由 | 登录要求 | 关键内容 |
|---|------|------|---------|---------|
| 1 | 首页 | `/` | 否 | Hero 区 + 粒子背景 + 品牌名 + 登录弹窗触发 |
| 2 | 项目列表 | `/projects` | 是 | 项目卡片网格 + 搜索/筛选 + 新建项目 |
| 3 | 项目详情 | `/projects/[id]` | 是 | 左侧信息面板 + 标签导航 + 右侧内容区 |
| 4 | 知识库 | `/knowledge-base` | 是 | 左侧文档列表 + 右侧内容区 + 工具栏 |
| 5 | 个人主页 | `/profile` | 是 | 头像上传 + 用户信息表单 |

---

## 3. 全局组件

### 3.1 TopBar（顶部栏）
- **位置**：所有登录后页面顶部固定
- **内容**：
  - 左侧：Logo（Oneness-AI .ai）+ 品牌图标
  - 右侧：语言选择器（简体中文/English/繁體中文/日本語/한국어/Español/Français/Deutsch）、充值按钮（显示积分）、用户头像
- **交互**：头像 hover 弹出用户菜单

### 3.2 用户菜单弹窗（UserMenuPopover）
- **触发**：点击头像
- **内容**：头像上传区、用户名、邮箱、积分、账户管理、使用指南、退出登录
- **样式**：白色卡片，带阴影，280px 宽

### 3.3 登录弹窗（LoginModal）
- **触发**：首页点击"登录"或未登录访问受保护路由
- **内容**："欢迎来到 Oneness-AI"、邮箱输入框、获取验证码按钮
- **样式**：白色圆角卡片，居中，半透明黑色遮罩

### 3.4 新建项目弹窗（CreateProjectModal）
- **触发**：项目列表页点击"新建项目"卡片
- **内容**：项目名称输入、画面比例选择（16:9 等）
- **样式**：Element UI 风格对话框

### 3.5 浮动知识库按钮（FloatingKnowledgeButton）
- **位置**：右下角 fixed，z-index: 9999
- **内容**：文档图标 + hover 显示"知识库"tooltip
- **交互**：点击进入知识库页

### 3.6 语言选择下拉（LanguageSelect）
- **触发**：点击 TopBar 语言区
- **选项**：8 种语言
- **样式**：Element UI Select 风格

---

## 4. 页面详细设计

### 4.1 首页 `/`

**布局**：
- 全屏高度，flex 居中
- 背景：动态粒子/光斑效果（CSS animation 或 Canvas）
- 顶部固定：语言选择 + 登录按钮

**内容**：
- 主标题："Oneness-AI" + ".ai" 标签
- 副标题："专业 AI 影视创作"
- 按钮："立即创作"（蓝色圆角按钮，带播放图标）
- 右下角：知识库浮动按钮

**交互动效**：
- 背景粒子缓慢漂浮
- 按钮 hover 有轻微放大效果

### 4.2 项目列表页 `/projects`

**布局**：
- TopBar（固定）
- 主内容区 padding-top: 64px
- 页面标题 + 筛选区（flex 左右分布）
- 下方：CSS Grid 项目卡片

**页面头部**：
- 左侧：`<h1>` "我的项目"
- 右侧：搜索输入框（placeholder: "请输入项目名称（模糊）"）+ 搜索按钮（蓝色）+ 重置按钮（灰色边框）

**项目卡片（两种类型）**：
1. **新建项目卡片**（card-cta）：
   - 大号 "+" 图标
   - "新建项目" 文字
   - 灰色背景 (#fafafa)，圆角，hover 边框变深

2. **项目卡片**（card-project）：
   - 摄像机图标
   - 项目名称（card-title）
   - 标签行：比例（如 "16:9"）+ 风格（如 "日漫风格"）
   - 删除按钮（右上角，红色图标 btn-red）
   - 灰色背景，圆角

**Grid 布局**：
- `grid-template-columns: repeat(auto-fill, minmax(352px, 1fr))`
- gap: 24px

### 4.3 项目详情页 `/projects/[id]`

**布局**：
- TopBar（固定）
- 主体：左右两栏布局
  - 左侧：固定宽度信息面板（~300px）
  - 右侧：主内容区（flex-1）

**左侧面板**：
- 返回按钮（顶部）
- 项目标题（大号）
- 信息列表（label-value 形式）：
  - 分辨率：16:9
  - 风格：日漫风格
  - 创建时间：2026/5/13 15:50:06
  - 风格提示词（长文本）
  - 分析模型：Gemini 3 Pro
  - 图像模型：Nano banana pro
  - 视频模型：Seedance 2.0
  - 通用分析：已完成（绿色标签）
  - 基础分析：已完成（绿色标签）

**标签导航**（顶部或左侧下方）：
- 信息（默认选中）
- 角色
- 物品
- 场景
- 工作台
- 分镜
- 数据分析
- 样式：水平排列，选中项有下划线或背景高亮

**右侧内容区**：
- 根据选中标签显示不同内容
- "信息"标签：显示剧情/脚本长文本
- 其他标签：展示对应类型的数据列表

### 4.4 知识库页 `/knowledge-base`

**布局**：
- TopBar（固定）
- 主体：左右两栏
  - 左侧：窄侧边栏（~250px）
  - 右侧：主内容区（flex-1）

**左侧边栏**：
- 返回按钮（顶部，圆形图标）
- 标签页切换："我创建的" / "我收藏的" / "与我协作"
- 搜索框（placeholder: "搜索文档标题"）
- 文档列表（当前为空状态）
- 空状态：插图 + "暂无文档"

**左侧工具栏**（垂直图标列表，固定左侧边缘）：
- 返回箭头
- 用户图标
- 收藏星星图标
- 文档图标

**右侧主内容区**：
- 空状态：大插图 + "暂无文档"

### 4.5 个人主页 `/profile`

**布局**：
- TopBar（固定）
- 主内容区居中，max-width: 800px

**内容**：
- 页面标题："个人主页"
- 头像区域：
  - 圆形头像占位（默认灰色用户图标）
  - "点击上传" 提示
  - "支持 JPG/PNG 文件" 说明
- 表单字段：
  - ID：只读文本（6a04202d3befef5ce911208e）
  - 昵称：输入框（默认"黄昱舟"）
  - 电子邮箱：只读（1280165525@qq.com）
  - 积分：只读大号数字（10158）
- 保存按钮（蓝色，圆角）

---

## 5. 数据模型（Mock + 接口预留）

所有数据操作通过 `lib/api.ts` 中的函数进行，当前返回 mock 数据，后续替换为 fetch 调用。

```typescript
// types/index.ts

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  credits: number;
}

interface Project {
  id: string;
  name: string;
  ratio: string;        // e.g. "16:9"
  style: string;        // e.g. "日漫风格"
  createdAt: string;    // ISO date
  stylePrompt: string;  // long text
  analysisModel: string;
  imageModel: string;
  videoModel: string;
  generalAnalysis: 'pending' | 'completed';
  basicAnalysis: 'pending' | 'completed';
}

interface ProjectTabContent {
  tab: 'info' | 'characters' | 'items' | 'scenes' | 'workbench' | 'storyboard' | 'analytics';
  content: string;  // markdown or plain text
}

interface KnowledgeDoc {
  id: string;
  title: string;
  type: 'created' | 'favorited' | 'collaborated';
  content?: string;
  createdAt: string;
}

type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';
```

```typescript
// lib/api.ts — 所有数据操作的统一入口

// 用户
export async function getCurrentUser(): Promise<User | null> { /* mock */ }
export async function login(email: string, code: string): Promise<{ token: string }> { /* mock */ }
export async function logout(): Promise<void> { /* mock */ }
export async function updateProfile(data: Partial<User>): Promise<User> { /* mock */ }

// 项目
export async function getProjects(search?: string): Promise<Project[]> { /* mock */ }
export async function getProject(id: string): Promise<Project | null> { /* mock */ }
export async function createProject(data: Omit<Project, 'id' | 'createdAt'>): Promise<Project> { /* mock */ }
export async function deleteProject(id: string): Promise<void> { /* mock */ }
export async function getProjectTabContent(projectId: string, tab: string): Promise<ProjectTabContent> { /* mock */ }

// 知识库
export async function getKnowledgeDocs(type: string): Promise<KnowledgeDoc[]> { /* mock */ }
```

---

## 6. 状态管理

使用 React Context + hooks，不引入外部状态库（保持简单，后续可替换为 Zustand/Redux）。

```
contexts/
  AuthContext.tsx      — 登录状态、用户信息、token
  LocaleContext.tsx    — 当前语言、切换语言
```

**AuthContext**：
- `isLoggedIn: boolean`
- `user: User | null`
- `login(email, code)`
- `logout()`
- token 持久化到 localStorage（key: `auth_token`）

**LocaleContext**：
- `locale: Language`
- `setLocale(lang)`
- 持久化到 localStorage（key: `locale`）

---

## 7. 样式系统

### 7.1 颜色

```
--color-primary: #3b82f6        // 蓝色按钮、链接
--color-primary-hover: #2563eb
--color-bg: #ffffff             // 页面背景
--color-bg-card: #fafafa        // 卡片背景
--color-bg-sidebar: #f5f5f5     // 侧边栏背景
--color-text: #111827           // 主文字
--color-text-secondary: #6b7280 // 次要文字
--color-border: #e5e7eb         // 边框
--color-success: #22c55e        // 已完成标签
--color-danger: #ef4444         // 删除按钮
--color-dark: #111111           // 充值按钮背景
```

### 7.2 字体

```
font-family: Inter, "Noto Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
```

### 7.3 间距

```
页面边距: 32px
卡片内边距: 24px
卡片圆角: 12px
按钮圆角: 8px
Grid gap: 24px
```

---

## 8. 路由守卫

- `/`：公开访问
- `/projects`、`/projects/*`、`/knowledge-base`、`/profile`：需要登录，未登录重定向到 `/`
- 登录状态通过 `AuthContext` 判断，token 存在即视为登录

---

## 9. 文件结构

```
oneness-ai/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 根布局，注入 Context
│   │   ├── page.tsx                # 首页
│   │   ├── projects/
│   │   │   ├── page.tsx            # 项目列表
│   │   │   └── [id]/
│   │   │       └── page.tsx        # 项目详情
│   │   ├── knowledge-base/
│   │   │   └── page.tsx            # 知识库
│   │   ├── profile/
│   │   │   └── page.tsx            # 个人主页
│   │   └── globals.css             # 全局样式
│   ├── components/
│   │   ├── ui/                     # shadcn/ui 组件
│   │   ├── layout/
│   │   │   ├── TopBar.tsx          # 顶部栏
│   │   │   ├── UserMenuPopover.tsx # 用户菜单
│   │   │   └── FloatingKnowledgeButton.tsx
│   │   ├── modals/
│   │   │   ├── LoginModal.tsx      # 登录弹窗
│   │   │   └── CreateProjectModal.tsx
│   │   ├── projects/
│   │   │   ├── ProjectCard.tsx     # 项目卡片
│   │   │   ├── ProjectGrid.tsx     # 项目网格
│   │   │   ├── ProjectFilters.tsx  # 搜索/筛选
│   │   │   ├── ProjectInfoPanel.tsx # 详情左侧面板
│   │   │   ├── ProjectTabs.tsx     # 标签导航
│   │   │   └── ProjectTabContent.tsx
│   │   ├── knowledge/
│   │   │   ├── DocSidebar.tsx      # 文档侧边栏
│   │   │   ├── DocToolbar.tsx      # 左侧工具栏
│   │   │   └── EmptyState.tsx      # 空状态
│   │   └── profile/
│   │       └── ProfileForm.tsx     # 个人信息表单
│   ├── contexts/
│   │   ├── AuthContext.tsx
│   │   └── LocaleContext.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   └── useLocale.ts
│   ├── lib/
│   │   ├── api.ts                  # 数据接口（mock，后续替换）
│   │   ├── utils.ts                # cn() 等工具
│   │   └── constants.ts            # 常量（语言列表等）
│   ├── types/
│   │   └── index.ts                # TypeScript 类型定义
│   └── data/
│       └── mock.ts                 # mock 数据
├── public/
│   ├── images/
│   │   └── logo.png                # Oneness-AI logo
│   └── ...
├── docs/superpowers/specs/
│   └── 2026-05-13-oneness-ai-clone-design.md
└── package.json
```

---

## 10. 依赖

```json
{
  "dependencies": {
    "next": "^16.2.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "tailwindcss": "^4.0.0",
    "lucide-react": "^1.6.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.5.0"
  }
}
```

---

## 11. 品牌替换清单

全局搜索替换：
- `LIKE AI` → `Oneness AI`
- `.pro` → `.ai`
- `likeai.pro` → `oneness.yirustudio.com（或根据实际域名调整）

---

## 12. 后续扩展预留点

| 位置 | 当前实现 | 后续替换方式 |
|------|---------|------------|
| `lib/api.ts` | 返回 mock 数据 | 替换为 `fetch()` 调用真实 API |
| `AuthContext` | localStorage token | 接入 OAuth / JWT 认证 |
| `LocaleContext` | 前端切换 | 接入 i18n 库（react-i18next） |
| 图片上传 | 前端预览 | 接入对象存储（OSS/S3） |
| 项目创建 | 本地生成 ID | 调用后端创建接口 |
| 实时数据 | 静态 | WebSocket / SSE 推送 |
