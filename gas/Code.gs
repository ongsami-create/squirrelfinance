// ========================================
// Squirrel Finance - Google Apps Script Backend
// 完全只读 — 财务订单查询系统专用
// 读取 Squirrel Designer Drive 数据，不写任何内容
// ========================================

const CONFIG = {
  MAIN_FOLDER: 'Squirrel Designer',  // Squirrel Designer 主文件夹
  USERS_FILE: 'users.json',          // 在 admin 子文件夹下
  ADMIN_FOLDER: 'admin',
  SYSTEM_RESERVED: ['admin', 'squirrel analysis', 'Commission', 'offline_user']
};

let mainFolder = null;
let adminFolder = null;
let usersCache = null;

// ==================== 初始化 ====================

function initializeFolders() {
  try {
    const rootFolders = DriveApp.getRootFolder().getFoldersByName(CONFIG.MAIN_FOLDER);
    if (!rootFolders.hasNext()) {
      return { success: false, message: 'Squirrel Designer 主文件夹不存在，请先在 Squirrel Designer 报价系统中初始化数据' };
    }
    mainFolder = rootFolders.next();

    const adminFolders = mainFolder.getFoldersByName(CONFIG.ADMIN_FOLDER);
    if (!adminFolders.hasNext()) {
      return { success: false, message: 'admin 子文件夹不存在' };
    }
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

// 从 quote JSON 提取摘要字段（财务列表用, 不含 items 数组, 减少数据传输）
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
    discount: quote.discount || 0,
    depositTotal: (quote.depositRecords || []).reduce(function(sum, d) { return sum + (d.amount || 0); }, 0),
    orderedAt: quote.orderedAt || '',
    status: quote.status || '',
    completedAt: quote.completedAt || '',
    createdBy: folderName,  // Drive folder 名（用于校验, 仅供参考, 判定归属用 salesperson）
    lastSynced: quote.lastSynced || '',
    lastModified: quote.lastModified || '',
    // 标记：是否最终文件（保留 final_ 兼容）
    isFinal: !!(quote.id && quote.id.indexOf('final_') === 0)
  };
}

// ==================== API ====================

// 1. 健康检查
function ping() {
  return {
    success: true,
    message: 'Squirrel Finance API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };
}

// 2. 列所有用户 + 每人的 quote 数量
function getDetailedUsers() {
  try {
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
          if (file.getName().endsWith('.json')) quoteCount++;
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

    // 过滤：只保留活跃用户且 quote 数量 > 0 的（财务关心的）
    const activeUsers = users.filter(function(u) { return u.isActive && u.quoteCount > 0; });

    return { success: true, users: activeUsers, totalCount: activeUsers.length };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 3. 一次拉所有用户的所有 quote 摘要（财务系统主入口, 列表页用）
function getAllQuotesSummary() {
  try {
    const init = initializeFolders();
    if (!init.success) return init;

    const quotes = [];
    const subFolders = mainFolder.getFolders();

    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      if (!isValidUserFolder(folder.getName())) continue;

      const folderName = folder.getName();
      const files = folder.getFiles();

      while (files.hasNext()) {
        const file = files.next();
        if (!file.getName().endsWith('.json')) continue;

        try {
          const quote = JSON.parse(file.getBlob().getDataAsString());
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

    return {
      success: true,
      quotes: quotes,
      totalCount: quotes.length
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// 4. 拉单份完整 quote（预览用, 含 items / fees 等）
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

// ==================== API 入口 ====================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    let result;

    switch (action) {
      case 'ping':
        result = ping();
        break;
      case 'getDetailedUsers':
        result = getDetailedUsers();
        break;
      case 'getAllQuotesSummary':
        result = getAllQuotesSummary();
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
