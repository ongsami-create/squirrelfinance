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

// ==================== 核心: 预聚合 (v1.2.1 — PropertiesService) ====================
// ⚠️ v1.2.0 用 Drive 写 summary.json 失败: GAS 部署"任何人"没 drive 写权限
// v1.2.1 改用 PropertiesService (GAS 自带 key-value, 不需要 Drive 权限)
//
// PropertiesService 限制:
//   - 单 property 9KB, 总 500KB per script
//   - 永久保存 (没 TTL)
//   - 不需要额外权限
//
// 60KB 摘要 → 拆 8 quotes/chunk ≈ 8KB, 共 8-10 个 property

const PROP_PREFIX = 'sf_q_';  // squirrel finance quotes chunk
const PROP_USERS = 'sf_users';
const PROP_META = 'sf_meta';
const PROP_CHUNK_SIZE = 8;     // 每 chunk 8 quotes (~8KB)

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

  // 拆 chunks 写 PropertiesService
  const props = PropertiesService.getScriptProperties();
  const totalChunks = Math.ceil(quotes.length / PROP_CHUNK_SIZE);
  const propertiesToSet = {};
  for (let i = 0; i < totalChunks; i++) {
    const chunk = quotes.slice(i * PROP_CHUNK_SIZE, (i + 1) * PROP_CHUNK_SIZE);
    propertiesToSet[PROP_PREFIX + i] = JSON.stringify(chunk);
  }
  propertiesToSet[PROP_USERS] = JSON.stringify(activeUsers);
  propertiesToSet[PROP_META] = JSON.stringify({
    totalCount: quotes.length,
    chunks: totalChunks,
    generatedAt: new Date().toISOString(),
    version: 3
  });
  props.setProperties(propertiesToSet);

  return { success: true, totalCount: quotes.length, generatedAt: propertiesToSet[PROP_META] ? JSON.parse(propertiesToSet[PROP_META]).generatedAt : null };
}

function getSummary() {
  try {
    const props = PropertiesService.getScriptProperties().getProperties();
    const metaStr = props[PROP_META];

    if (!metaStr) {
      // 第一次, 自动重建
      const r = rebuildSummary();
      if (!r.success) return r;
      return getSummary();  // 递归读
    }

    const meta = JSON.parse(metaStr);
    const users = JSON.parse(props[PROP_USERS] || '[]');

    const quotes = [];
    for (let i = 0; i < meta.chunks; i++) {
      const chunkStr = props[PROP_PREFIX + i];
      if (chunkStr) {
        const chunk = JSON.parse(chunkStr);
        for (let j = 0; j < chunk.length; j++) quotes.push(chunk[j]);
      }
    }

    return {
      success: true,
      quotes: quotes,
      users: users,
      totalCount: meta.totalCount,
      generatedAt: meta.generatedAt,
      source: 'properties-service'
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 清理 PropertiesService (调试用)
function clearSummaryProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const toDelete = Object.keys(all).filter(function(k) {
    return k.indexOf('sf_') === 0;
  });
  if (toDelete.length) {
    props.deleteAllProperties();
    return { success: true, cleared: toDelete.length };
  }
  return { success: true, cleared: 0 };
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
    version: '1.2.1'  // PropertiesService 替代 Drive 写文件
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
      case 'clearSummaryProperties':
        result = clearSummaryProperties();
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
