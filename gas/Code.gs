// ========================================
// Squirrel Finance - Google Apps Script Backend
// 完全只读 — 财务订单查询系统专用
// 优化版 (v1.2): 预聚合 summary.json + CacheService + items 内联 + nocache
// ========================================

const CONFIG = {
  MAIN_FOLDER: 'Squirrel Designer',
  USERS_FILE: 'users.json',
  ADMIN_FOLDER: 'admin',
  SUMMARY_FILE: 'finance_summary.json',   // ⭐ v1.2 新增: 预聚合文件
  SYSTEM_RESERVED: ['admin', 'squirrel analysis', 'Commission', 'offline_user']
};

const CACHE_TTL_SEC = 300;  // 5 分钟

let mainFolder = null;
let adminFolder = null;
let usersCache = null;

// ==================== 初始化 ====================

function initializeFolders() {
  try {
    const rootFolders = DriveApp.getRootFolder().getFoldersByName(CONFIG.MAIN_FOLDER);
    if (!rootFolders.hasNext()) {
      return { success: false, message: 'Squirrel Designer 主文件夹不存在' };
    }
    mainFolder = rootFolders.next();

    const adminFolders = mainFolder.getFoldersByName(CONFIG.ADMIN_FOLDER);
    if (!adminFolders.hasNext()) return { success: false, message: 'admin 子文件夹不存在' };
    adminFolder = adminFolders.next();

    const userFiles = adminFolder.getFilesByName(CONFIG.USERS_FILE);
    if (userFiles.hasNext()) {
      usersCache = JSON.parse(userFiles.next().getBlob().getDataAsString());
    } else {
      return { success: false, message: 'users.json 不存在' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: 'initializeFolders 失败: ' + error.toString() };
  }
}

// ==================== 工具函数 ====================

function isValidUserFolder(folderName) {
  if (!usersCache || !usersCache.users) return false;
  if (CONFIG.SYSTEM_RESERVED.indexOf(folderName) >= 0) return false;
  return usersCache.users.some(function(u) { return u.username === folderName; });
}

// ============ CacheService helpers (跨调用持久化) ============
function cacheGet(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}
function cachePut(key, value, ttl) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttl || CACHE_TTL_SEC);
  } catch (e) {}
}

// 跳过系统/缓存文件
const SKIP_FILES = ['stats_cache.json','users.json','activity_logs.json','admin_logs.json','products.json', CONFIG.SUMMARY_FILE];
function isSkipFile(name) {
  return SKIP_FILES.indexOf(name) >= 0;
}

// 从 quote JSON 提取摘要字段（不含 items 数组, 避免超过 CacheService 100KB 限制）
function extractQuoteSummary(quote, folderName) {
  return {
    id: quote.id || '',
    projNo: quote.projNo || '',
    customerName: quote.customerName || '',
    customerIC: quote.customerIC || '',
    customerContact: quote.customerContact || '',
    customerAddress: quote.customerAddress || '',
    salesperson: quote.salesperson || '',
    salespersonContact: quote.salespersonContact || '',
    designerName: quote.designerName || '',
    subSalesperson: quote.subSalesperson || '',
    measurementEngineer: quote.measurementEngineer || '',
    date: quote.date || '',
    createdAt: quote.createdAt || quote.date || '',
    total: quote.total || 0,
    subtotal: quote.subtotal || 0,
    discount: quote.discount || 0,
    depositTotal: (quote.depositRecords || []).reduce(function(sum, d) { return sum + (d.amount || 0); }, 0),
    fees: quote.fees || {},
    customFees: quote.customFees || [],
    feeRemarks: quote.feeRemarks || '',
    depositRecords: quote.depositRecords || [],
    orderedAt: quote.orderedAt || '',
    status: quote.status || '',
    completedAt: quote.completedAt || '',
    createdBy: folderName,
    lastSynced: quote.lastSynced || '',
    lastModified: quote.lastModified || '',
    isFinal: !!(quote.id && String(quote.id).indexOf('final_') === 0)
  };
}

// ==================== 核心: 预聚合 (v1.2) ====================

// ⭐ 重建 summary: 遍历 80 个 quote, 写一个 summary.json (~60KB)
function rebuildSummary() {
  const init = initializeFolders();
  if (!init.success) return init;

  const quotes = [];
  const userMap = {};

  // 遍历用户
  usersCache.users.forEach(function(u) {
    userMap[u.username] = {
      username: u.username,
      displayName: u.displayName || u.username,
      isActive: u.isActive !== false,
      isAdmin: u.isAdmin || false,
      quoteCount: 0
    };
  });

  const subFolders = mainFolder.getFolders();
  while (subFolders.hasNext()) {
    const folder = subFolders.next();
    const folderName = folder.getName();
    if (!isValidUserFolder(folderName)) continue;

    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (!name.endsWith('.json') || isSkipFile(name)) continue;

      try {
        const quote = JSON.parse(file.getBlob().getDataAsString());
        if (!quote.projNo && !quote.id) continue;
        const summary = extractQuoteSummary(quote, folderName);
        quotes.push(summary);
        if (userMap[folderName]) userMap[folderName].quoteCount++;
      } catch (parseErr) {}
    }
  }

  // 按日期倒序
  quotes.sort(function(a, b) {
    const da = new Date(a.date || a.createdAt || a.lastModified || 0);
    const db = new Date(b.date || b.createdAt || b.lastModified || 0);
    return db - da;
  });

  // 过滤: 只保留有 quote 的活跃用户
  const activeUsers = Object.values(userMap).filter(function(u) {
    return u.isActive && u.quoteCount > 0;
  });

  const summaryData = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalCount: quotes.length,
    quotes: quotes,
    users: activeUsers
  };

  // 写 summary.json (覆盖旧文件)
  const oldFiles = adminFolder.getFilesByName(CONFIG.SUMMARY_FILE);
  while (oldFiles.hasNext()) oldFiles.next().setTrashed(true);
  adminFolder.createFile(CONFIG.SUMMARY_FILE, JSON.stringify(summaryData), false);

  return { success: true, totalCount: quotes.length, generatedAt: summaryData.generatedAt };
}

// ⭐ 读 summary (1 个 Drive read, <100ms)
function getSummary() {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    const files = adminFolder.getFilesByName(CONFIG.SUMMARY_FILE);
    if (!files.hasNext()) {
      // summary 不存在, 自动重建一次
      const rebuild = rebuildSummary();
      if (!rebuild.success) return rebuild;
      // 再读
      const files2 = adminFolder.getFilesByName(CONFIG.SUMMARY_FILE);
      if (!files2.hasNext()) {
        return { success: false, message: 'rebuild 后仍找不到 summary.json' };
      }
      const data = JSON.parse(files2.next().getBlob().getDataAsString());
      return {
        success: true,
        quotes: data.quotes,
        users: data.users,
        totalCount: data.totalCount,
        generatedAt: data.generatedAt,
        source: 'rebuild-fresh'
      };
    }

    const data = JSON.parse(files.next().getBlob().getDataAsString());
    return {
      success: true,
      quotes: data.quotes,
      users: data.users,
      totalCount: data.totalCount,
      generatedAt: data.generatedAt,
      source: 'summary-json'
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// ⭐ 自动定时 rebuild (5 分钟一次, 装在 GAS trigger 里)
function scheduledRebuildSummary() {
  const r = rebuildSummary();
  Logger.log('scheduledRebuildSummary: ' + JSON.stringify(r));
  return r;
}

// ==================== API ====================

// 1. 健康检查
function ping() {
  return {
    success: true,
    message: 'Squirrel Finance API is running',
    timestamp: new Date().toISOString(),
    version: '1.2.0'
  };
}

// 2. 拉摘要 (前端主入口, 走预聚合 + CacheService)
// ⚠️ v1.2 改: 优先读 summary.json (1 个 Drive read), 不是遍历 80 个文件
function getAllQuotesSummary(nocache) {
  try {
    // 1. 优先用 CacheService (5min 内秒开)
    if (!nocache) {
      const cached = cacheGet('all_quotes_summary_v2');
      if (cached) return { success: true, quotes: cached.quotes, users: cached.users, totalCount: cached.quotes.length, generatedAt: cached.generatedAt, source: 'cache' };
    }

    // 2. 读 summary.json (1 个 Drive read, ~60KB, <100ms)
    const summary = getSummary();
    if (!summary.success) {
      // 3. summary 也没, fallback 到旧逻辑 (遍历 80 个文件)
      return getAllQuotesSummaryLegacy(nocache);
    }

    // 写缓存
    cachePut('all_quotes_summary_v2', { quotes: summary.quotes, users: summary.users, generatedAt: summary.generatedAt }, CACHE_TTL_SEC);

    return {
      success: true,
      quotes: summary.quotes,
      users: summary.users,
      totalCount: summary.totalCount,
      generatedAt: summary.generatedAt,
      source: summary.source
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 旧逻辑 (fallback, 保留兼容)
function getAllQuotesSummaryLegacy(nocache) {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    const quotes = [];
    const subFolders = mainFolder.getFolders();

    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      const folderName = folder.getName();
      if (!isValidUserFolder(folderName)) continue;

      const files = folder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const name = file.getName();
        if (!name.endsWith('.json') || isSkipFile(name)) continue;

        try {
          const quote = JSON.parse(file.getBlob().getDataAsString());
          if (!quote.projNo && !quote.id) continue;
          quotes.push(extractQuoteSummary(quote, folderName));
        } catch (parseErr) {}
      }
    }

    quotes.sort(function(a, b) {
      const da = new Date(a.date || a.createdAt || a.lastModified || 0);
      const db = new Date(b.date || b.createdAt || b.lastModified || 0);
      return db - da;
    });

    return { success: true, quotes: quotes, totalCount: quotes.length, source: 'legacy-fallback' };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 3. 拉单份完整 quote (预览用, 带 cache 5min)
function getQuoteDetail(username, projNo, nocache) {
  try {
    if (!username || !projNo) {
      return { success: false, message: 'username 和 projNo 必填' };
    }

    const cacheKey = 'quote_detail_' + username + '_' + projNo + '_v2';
    if (!nocache) {
      const cached = cacheGet(cacheKey);
      if (cached) return { success: true, quote: cached, cached: true };
    }

    const init = initializeFolders();
    if (!init.success) return init;

    const userFolders = mainFolder.getFoldersByName(username);
    if (!userFolders.hasNext()) {
      return { success: false, message: '用户文件夹不存在: ' + username };
    }
    const userFolder = userFolders.next();

    const files = userFolder.getFilesByName(projNo + '.json');
    if (!files.hasNext()) {
      return { success: false, message: '报价不存在: ' + projNo };
    }

    const file = files.next();
    const quote = JSON.parse(file.getBlob().getDataAsString());
    quote.createdBy = username;
    quote._lastModified = file.getLastUpdated().toISOString();

    cachePut(cacheKey, quote, CACHE_TTL_SEC);

    return { success: true, quote: quote, cached: false };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// ==================== 调试用 API ====================

function debugFiles() {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    const result = { folders: [], summaryFile: null };
    const sumFiles = adminFolder.getFilesByName(CONFIG.SUMMARY_FILE);
    if (sumFiles.hasNext()) {
      const f = sumFiles.next();
      result.summaryFile = { name: f.getName(), size: f.getSize(), updated: f.getLastUpdated().toISOString() };
    }

    const subFolders = mainFolder.getFolders();
    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      if (!isValidUserFolder(folder.getName())) continue;

      const folderName = folder.getName();
      const folderInfo = { folder: folderName, count: 0 };
      const files = folder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        if (file.getName().endsWith('.json')) folderInfo.count++;
      }
      result.folders.push(folderInfo);
    }
    return result;
  } catch (error) { return { success: false, message: error.toString() }; }
}

// ==================== API 入口 ====================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    const nocache = e && e.parameter && e.parameter.nocache === '1';
    const refresh = e && e.parameter && e.parameter.refresh === '1';
    let result;

    switch (action) {
      case 'ping':
        result = ping();
        break;
      case 'getAllQuotesSummary':
        // ?refresh=1 强制重建 summary + 返回
        if (refresh) {
          const r = rebuildSummary();
          if (!r.success) { result = r; break; }
        }
        result = getAllQuotesSummary(nocache);
        break;
      case 'getQuoteDetail':
        result = getQuoteDetail(e.parameter.username, e.parameter.projNo, nocache);
        break;
      case 'rebuildSummary':
        result = rebuildSummary();
        break;
      case 'getSummary':
        result = getSummary();
        break;
      case 'debugFiles':
        result = debugFiles();
        break;
      default:
        result = { success: false, message: '未知 action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  return doGet(e);
}
