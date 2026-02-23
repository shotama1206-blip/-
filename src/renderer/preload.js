/**
 * preload.js - contextBridge による IPC 通信ブリッジ
 *
 * Renderer Process に window.api オブジェクトとして公開する。
 * Main Process の ipcMain.handle に対応するメソッドを定義。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---- 設定 ----
  saveCredentials: (mailAddress, password) =>
    ipcRenderer.invoke('settings:save-credentials', { mailAddress, password }),

  getCredentials: () =>
    ipcRenderer.invoke('settings:get-credentials'),

  saveGridColumns: (columns) =>
    ipcRenderer.invoke('settings:save-grid-columns', columns),

  getGridColumns: () =>
    ipcRenderer.invoke('settings:get-grid-columns'),

  // ---- スクリーニング ----
  getListed: () =>
    ipcRenderer.invoke('screening:get-listed'),

  getScreeningData: (codes) =>
    ipcRenderer.invoke('screening:get-data', codes),

  // ---- ポートフォリオ ----
  getPortfolioData: () =>
    ipcRenderer.invoke('portfolio:get-data'),

  addHolding: (code, shares, avgCost) =>
    ipcRenderer.invoke('portfolio:add-holding', { code, shares, avgCost }),

  removeHolding: (code) =>
    ipcRenderer.invoke('portfolio:remove-holding', code),

  getHoldings: () =>
    ipcRenderer.invoke('portfolio:get-holdings'),
});
