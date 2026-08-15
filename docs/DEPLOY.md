# Squirrel Finance 部署手把手指南

> **预计总耗时**: 30-45 分钟
> **前提条件**: 你的 Google 账号是 `squirreldesigner9068@gmail.com`（跟 Squirrel Designer 共用 Drive 数据）

---

## 步骤 1: 创建 GitHub 仓库 (5 分钟)

### 1.1 打开 GitHub 仓库创建页

在浏览器打开：https://github.com/new

### 1.2 填写仓库信息

| 字段 | 填什么 |
|---|---|
| **Repository name** | `squirrelfinance` |
| **Description** | `Squirrel Finance - 财务订单查询系统` |
| **Public / Private** | **Public**（GitHub Pages 免费版要 Public 才能访问）|
| **Add a README file** | ✅ 勾选 |
| **Add .gitignore** | 不用勾选（单文件 SPA 不需要） |
| **Choose a license** | 不用选 |

### 1.3 点 "Create repository"

### 1.4 验证

你应该看到地址是：`https://github.com/ongsami-create/squirrelfinance`

✅ 完成后告诉我"GitHub 仓库好了"，我继续步骤 2。

---

## 步骤 2: 创建 GAS 项目 (10 分钟)

### 2.1 打开 GAS 新建页

在浏览器打开：https://script.google.com/home/projects/create

### 2.2 改项目名

左上角点 "Untitled project" → 改成 **`SquirrelFinance`**

### 2.3 粘贴代码

1. 把默认的 `Code.gs` 内容全删掉
2. 打开本地文件 `C:\Users\sami_\.minimax-agent-cn\projects\32\squirrelfinance\gas\Code.gs`
3. **Ctrl+A** 全选，**Ctrl+C** 复制
4. 回到 GAS 编辑器，**Ctrl+A** 全选，**Ctrl+V** 粘贴
5. 点右上角 **💾 保存**（或 Ctrl+S）

### 2.4 验证

左侧 Files 面板应该只有 1 个文件 `Code.gs`，代码行数约 230 行。

---

## 步骤 3: 部署 GAS Web App (5 分钟)

### 3.1 点右上角 "部署" → "新建部署"

### 3.2 选类型

- 点齿轮图标 ⚙️ → 选 **"Web 应用"**

### 3.3 填写部署配置

| 字段 | 填什么 |
|---|---|
| **说明** | `v1.0 初始部署` |
| **执行身份** | **我 (squirreldesigner9068@gmail.com)** |
| **具有访问权限的用户** | **任何人 (Anyone)** |

### 3.4 点 "部署"

### 3.5 第一次会弹授权窗口

1. 点 "允许访问"
2. 选你的 Google 账号
3. 可能看到 "Google hasn't verified this app" → 点 "Advanced" → "Go to SquirrelFinance (unsafe)"
4. 点 "Allow"

### 3.6 复制 Web App URL

部署成功后你会看到：
```
https://script.google.com/macros/s/AKfycbx.../exec
```

**复制整个 URL** 发给我。

✅ 完成后告诉我"GAS URL 是 xxx"，我继续步骤 4（联调 + 部署前端）。

---

## 步骤 4: 联调测试 (我会做)

我会：
1. 调 GAS 的 `ping` API 验证通
2. 调 `getDetailedUsers` 验证能列出 9 个用户
3. 调 `getAllQuotesSummary` 验证能列出报价
4. 调 `getQuoteDetail` 验证能拉单份

如果有错，我会贴 GAS 的 `执行记录` 报错给你看，咱们一起调。

---

## 步骤 5: 部署前端到 GitHub Pages (10 分钟)

### 5.1 准备 dist/index.html

我会把 `C:\Users\sami_\.minimax-agent-cn\projects\32\squirrelfinance\dist\index.html` 准备好（你不用做）。

### 5.2 push 到 GitHub

我会用 PAT 帮你 push 到仓库（基于现有 backadmin 的部署模式）。

### 5.3 启用 GitHub Pages

1. 打开 https://github.com/ongsami-create/squirrelfinance/settings/pages
2. **Source**: 选 "Deploy from a branch"
3. **Branch**: 选 `main` / `(root)`
4. 点 Save

### 5.4 等待 5-10 分钟

GitHub Pages 部署需要时间。我会定时检查，部署完告诉你 URL：
`https://ongsami-create.github.io/squirrelfinance/`

---

## 步骤 6: 联调 + 第一次访问 (我会做 + 你试)

1. 我会打开财务系统 URL 验证
2. 你打开同一个 URL，作为"财务"角色试试
3. 反馈问题我们一起调

---

## 常见问题

### Q: GAS 部署后接口报错 401 / 403？

A: 检查"具有访问权限的用户"是不是选了"任何人"。Web App URL 必须在浏览器里匿名可访问。

### Q: `getAllQuotesSummary` 报 "Squirrel Designer 主文件夹不存在"？

A: 你的 Squirrel Designer 报价系统还没在 Drive 里建过文件夹。先去报价系统（https://ongsami-create.github.io/squirreldesigner/）登录一下，触发初始化。

### Q: GitHub Pages 显示 404？

A: 等 5-10 分钟（Pages 部署延迟），或者清浏览器缓存（Ctrl+F5）。
