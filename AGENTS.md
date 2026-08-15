# Squirrel Finance (财务订单查询系统)

> 给公司财务用的报价单查询/下载门户 — 只读 Squirrel Designer 云端数据

## 项目目标

财务（不需要懂技术、不需要登录报价系统）能在一个页面上：

1. **按业务员 tab 切换**（PSD / JSD / FSD / TSD / VSD / TESD / SSD / ASD / admin），看每位销售的所有客户报价
2. **Excel 风格列表** + 每列独立 Filter（点列头下拉箭头） + 顶部搜索栏
3. **预览报价单**：点击行 → 弹出 Squirrel Designer 风格的报价单 → 可导出 PDF / Excel
4. **总金额汇总**：底部实时合计当前筛选后的总金额

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│ Finance Frontend (GitHub Pages)                              │
│   https://ongsami-create.github.io/squirrelfinance/          │
│   - 单文件 SPA, 全部内联在 index.html                         │
│   - tab 切换 / Excel Filter / 搜索 / 预览 / 导出              │
└──────────────────────┬──────────────────────────────────────┘
                       │ GET (JSONP-style, CORS 友好)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Finance GAS (独立 Google Apps Script)                         │
│   部署: GAS Web App URL                                       │
│   - 只读 Squirrel Designer Drive 文件夹                       │
│   - 不写任何数据                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ DriveApp.getFoldersByName('Squirrel Designer')
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Squirrel Designer Drive 数据 (现有)                           │
│   /Squirrel Designer/{admin,SSD,PSD,FSD,JSD,TSD,VSD,TESD,ASD,test}/*.json │
└─────────────────────────────────────────────────────────────┘
```

## 数据源（从 Squirrel Designer Drive 读）

**Drive 路径**：`My Drive / Squirrel Designer / <username> / <projNo>.json`

**每个 quote JSON 字段**（来自 backadmin GAS v3.21 `getQuoteList`）：
- `id, projNo` - 工程单号
- `customerName` - 客户名字
- `customerIC` - 客户身份证
- `customerContact` - 客户联系号码
- `customerAddress` - 客户地址
- `salesperson, salespersonContact` - 业务员信息
- `designerName, subSalesperson, measurementEngineer` - 设计师/助手/量尺
- `date, total, discount` - 日期/金额/折扣
- `items[]` - 报价项目
- `fees, customFees, depositRecords, feeRemarks` - 附加费用
- `orderedAt, status, completedAt` - 下单/状态/完成
- `lastSynced, lastModified` - 同步时间

## API（GAS 只读）

| Action | 参数 | 返回 | 说明 |
|---|---|---|---|
| `ping` | - | `{success, message, timestamp}` | 健康检查 |
| `getDetailedUsers` | - | `{users: [{username, displayName, isActive, quoteCount}]}` | 列所有用户 + quote 数量 |
| `getAllQuotesSummary` | - | `{quotes: [{projNo, customerName, ...}], totalCount}` | 一次拉所有用户 quote 摘要（轻量, 不含 items） |
| `getQuoteDetail` | `username, projNo` | `{quote: {完整 quote JSON}}` | 拉单份完整 quote, 给预览用 |

> 财务系统只读 — GAS 里**没有任何写操作**。即使 API 被恶意调用也无法改数据。

## 部署信息

| 项 | 值 |
|---|---|
| **GitHub 仓库** | https://github.com/ongsami-create/squirrelfinance |
| **GitHub Pages** | https://ongsami-create.github.io/squirrelfinance/ |
| **GAS 项目** | `SquirrelFinance` (待用户新建) |
| **GAS URL** | (待部署后填入) |

## 关键设计决策

1. **完全独立 GAS** — 不复用 backadmin GAS，财务系统改动不影响 Squirrel Designer/后端
2. **完全只读** — GAS 没有 saveQuote/deleteQuote/writeFile 等写操作
3. **多 tab 切换（不分开后端）** — 前端单页 tab 切换，1 次 API 拉所有数据，本地切换
4. **Drive 根用 `Squirrel Designer` 复用** — 不另存一份数据
5. **数据校验**：用 `salesperson` 字段判定归属（**不**用 createdBy — 那个可以伪造）

## 文件结构

```
projects/32/squirrelfinance/
├── AGENTS.md              # 本文件
├── README.md              # 用户/财务看的使用说明
├── docs/
│   └── DEPLOY.md          # 部署手把手指南
├── gas/
│   └── Code.gs            # GAS 源代码（只读 API）
└── dist/
    └── index.html         # 前端单文件 SPA
```

## 历史

- 2026-08-15 立项 — 财务订单查询系统 v1.0
