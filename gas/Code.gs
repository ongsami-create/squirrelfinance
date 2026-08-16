// ========================================
// Squirrel Finance - Google Apps Script Backend
// 完全只读 — 财务订单查询系统专用
// 读取 Squirrel Designer Drive 数据，不写任何内容
// 优化版 (v1.1): CacheService 缓存 + items 内联 + nocache 参数
// ========================================

const CONFIG = {
  MAIN_FOLDER: 'Squirrel Designer',
  USERS_FILE: 'users.json',
  ADMIN_FOLDER: 'admin',
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
// GAS Web App 每次 HTTP 请求都是新执行上下文, 模块级 let 变量会被重置
// 必须用 CacheService 才能跨调用复用
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
const SKIP_FILES = ['stats_cache.json','users.json','activity_logs.json','admin_logs.json','products.json'];
function isSkipFile(name) {
  return SKIP_FILES.indexOf(name) >= 0;
}

// 从 quote JSON 提取摘要字段（含 items 关键字段, 供预览用, 省一次 getQuoteDetail 调用）
function extractQuoteSummary(quote, folderName) {
  // items 轻量化: 只保留预览需要的字段
  const slimItems = (quote.items || []).map(function(it) {
    return {
      id: it.id,
      area: it.area,
      itemB: it.itemB,
      name: it.name,
      productName: it.productName,
      description: it.description,
      spec: it.spec,
      specification: it.specification,
      remarks: it.remarks,
      noteA: it.noteA,
      noteB: it.noteB,
      w: it.w || 0,
      h: it.h || 0,
      d: it.d || 0,
      value: it.value || 0,
      qty: it.qty || it.quantity || 1,
      quantity: it.quantity,
      unitPrice: it.unitPrice || it.price || 0,
      price: it.price,
      total: it.total || it.subtotal || 0,
      subtotal: it.subtotal,
      algorithm: it.algorithm
    };
  });

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
    items: slimItems,  // ✅ 含 items 供预览用, 省一次 getQuoteDetail 调用
    isFinal: !!(quote.id && String(quote.id).indexOf('final_') === 0)
  };
}

// ==================== API ====================

// 1. 健康检查
function ping() {
  return {
    success: true,
    message: 'Squirrel Finance API is running',
    timestamp: new Date().toISOString(),
    version: '1.1.0'  // 优化版
  };
}

// 2. 列所有用户 + 每人的 quote 数量 (用 cache 5min)
function getDetailedUsers() {
  try {
    const cached = cacheGet('detailed_users_v1');
    if (cached) return { success: true, users: cached, totalCount: cached.length, cached: true };

    const init = initializeFolders();
    if (!init.success) return init;

    const users = usersCache.users.map(function(u) {
      const userFolders = mainFolder.getFoldersByName(u.username);
      let quoteCount = 0;
      if (userFolders.hasNext()) {
        const folder = userFolders.next();
        const files = folder.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const name = file.getName();
          if (!name.endsWith('.json') || isSkipFile(name)) continue;
          try {
            const data = JSON.parse(file.getBlob().getDataAsString());
            if (data.projNo || data.id) quoteCount++;
          } catch (e) {}
        }
      }
      return {
        username: u.username,
        displayName: u.displayName || u.username,
        isActive: u.isActive !== false,
        isAdmin: u.isAdmin || false,
        quoteCount: quoteCount
      };
    });

    const activeUsers = users.filter(function(u) { return u.isActive && u.quoteCount > 0; });
    cachePut('detailed_users_v1', activeUsers, CACHE_TTL_SEC);

    return { success: true, users: activeUsers, totalCount: activeUsers.length, cached: false };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 3. 一次拉所有用户的所有 quote 摘要（财务系统主入口, 列表页用, 带 items + cache 5min）
function getAllQuotesSummary(nocache) {
  try {
    // 缓存命中
    if (!nocache) {
      const cached = cacheGet('all_quotes_summary_v1');
      if (cached) return { success: true, quotes: cached.quotes, totalCount: cached.quotes.length, cached: true, cacheTime: cached.ts };
    }

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
        } catch (parseErr) {
          // 跳过损坏文件
        }
      }
    }

    // 按日期倒序
    quotes.sort(function(a, b) {
      const da = new Date(a.date || a.createdAt || a.lastModified || 0);
      const db = new Date(b.date || b.createdAt || b.lastModified || 0);
      return db - da;
    });

    // 写缓存 (timestamp 用于显示给用户)
    cachePut('all_quotes_summary_v1', { quotes: quotes, ts: new Date().toISOString() }, CACHE_TTL_SEC);

    return {
      success: true,
      quotes: quotes,
      totalCount: quotes.length,
      cached: false
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 4. 拉单份完整 quote（备用, 现在 list API 已经返回 items, 一般不用）
function getQuoteDetail(username, projNo) {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    if (!username || !projNo) {
      return { success: false, message: 'username 和 projNo 必填' };
    }

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

    return { success: true, quote: quote };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// ==================== 调试用 API (备用) ====================

function debugFiles() {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    const result = { folders: [] };
    const subFolders = mainFolder.getFolders();
    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      if (!isValidUserFolder(folder.getName())) continue;

      const folderName = folder.getName();
      const folderInfo = { folder: folderName, files: [], count: 0, errors: [] };

      const files = folder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        if (!file.getName().endsWith('.json')) continue;
        folderInfo.count++;

        try {
          const content = file.getBlob().getDataAsString();
          let parsed = null, parseOk = false;
          try { parsed = JSON.parse(content); parseOk = true; }
          catch (e) { folderInfo.errors.push({ file: file.getName(), error: 'JSON parse failed: ' + e.message }); }
          if (folderInfo.files.length < 2) {
            const sample = { name: file.getName(), size: content.length, parseOk };
            if (parseOk && parsed) {
              sample.keys = Object.keys(parsed);
              sample.projNo = parsed.projNo || '';
              sample.customerName = parsed.customerName || '';
              sample.total = parsed.total;
              sample.date = parsed.date || '';
              sample.id = parsed.id || '';
            }
            folderInfo.files.push(sample);
          }
        } catch (e) { folderInfo.errors.push({ file: file.getName(), error: e.toString() }); }
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
    let result;

    switch (action) {
      case 'ping':
        result = ping();
        break;
      case 'debugFiles':
        result = debugFiles();
        break;
      case 'getDetailedUsers':
        result = getDetailedUsers();
        break;
      case 'getAllQuotesSummary':
        result = getAllQuotesSummary(nocache);
        break;
      case 'getQuoteDetail':
        result = getQuoteDetail(e.parameter.username, e.parameter.projNo);
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
