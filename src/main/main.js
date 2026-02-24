/**
 * main.js - Electron Main Process エントリポイント
 *
 * 責務:
 *   - BrowserWindow の生成
 *   - IPC ハンドラの登録（Renderer ↔ Main の通信窓口）
 *   - 各モジュール（store, jquants_client, data_manager）の統合
 *
 * 設計方針:
 *   Renderer Process には「計算済みの完全なデータ配列」のみを返す。
 *   ビジネスロジックは一切フロントに漏らさない。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getSettingsStore } = require('./store');
const jquants = require('./jquants_client');
const dataManager = require('./data_manager');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// --- IPC ハンドラ登録 ---

function registerIpcHandlers() {
  // ---- 設定 ----

  /** APIキーを保存する */
  ipcMain.handle('settings:save-api-key', async (_event, apiKey) => {
    const store = getSettingsStore();
    store.set('jquantsApiKey', apiKey);
    // 認証情報が変わったのでトークンを無効化
    jquants.invalidateToken();
    jquants.clearCache();
    return { success: true };
  });

  /** APIキーの設定状態を返す（キー自体はフロントに返さない） */
  ipcMain.handle('settings:get-api-key-status', async () => {
    const store = getSettingsStore();
    return {
      hasApiKey: !!store.get('jquantsApiKey', ''),
    };
  });

  /** ag-Grid 列設定の保存 */
  ipcMain.handle('settings:save-grid-columns', async (_event, columns) => {
    getSettingsStore().set('gridColumns', columns);
    return { success: true };
  });

  /** ag-Grid 列設定の読み出し */
  ipcMain.handle('settings:get-grid-columns', async () => {
    return getSettingsStore().get('gridColumns', []);
  });

  // ---- スクリーニング ----

  /** 上場銘柄一覧を取得 */
  ipcMain.handle('screening:get-listed', async () => {
    return await jquants.getListedInfo();
  });

  /** 指定銘柄群のスクリーニングデータ（指標計算済み）を取得 */
  ipcMain.handle('screening:get-data', async (_event, codes) => {
    return await dataManager.buildScreeningData(codes);
  });

  // ---- ポートフォリオ ----

  /** ポートフォリオ一覧（損益計算済み）を取得 */
  ipcMain.handle('portfolio:get-data', async () => {
    return await dataManager.buildPortfolioData();
  });

  /** 保有銘柄の追加 */
  ipcMain.handle('portfolio:add-holding', async (_event, { code, shares, avgCost }) => {
    dataManager.addHolding(code, shares, avgCost);
    return { success: true };
  });

  /** 保有銘柄の削除 */
  ipcMain.handle('portfolio:remove-holding', async (_event, code) => {
    dataManager.removeHolding(code);
    return { success: true };
  });

  /** 保有銘柄の生データ（計算前）を取得 */
  ipcMain.handle('portfolio:get-holdings', async () => {
    return dataManager.getHoldings();
  });
}

// --- アプリケーションライフサイクル ---

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
