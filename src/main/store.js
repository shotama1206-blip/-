/**
 * store.js - ローカルJSONファイルへのデータ永続化モジュール
 *
 * 責務:
 *   - アプリ設定（APIキー、列設定等）の保存・読み出し
 *   - ポートフォリオデータの保存・読み出し
 *   - すべてのデータは userData ディレクトリ内のJSONファイルに格納
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  /**
   * @param {string} fileName - 保存先JSONファイル名（例: 'settings.json'）
   * @param {object} defaults - ファイルが存在しない場合の初期値
   */
  constructor(fileName, defaults = {}) {
    this._path = path.join(app.getPath('userData'), fileName);
    this._data = this._load(defaults);
  }

  /** ファイルを読み込み、存在しなければ defaults を返す */
  _load(defaults) {
    try {
      const raw = fs.readFileSync(this._path, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { ...defaults };
    }
  }

  /** 現在の _data を丸ごとファイルに書き出す */
  _save() {
    const dir = path.dirname(this._path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  /** キーを指定して値を取得。未定義なら defaultValue を返す */
  get(key, defaultValue = undefined) {
    return key in this._data ? this._data[key] : defaultValue;
  }

  /** キーを指定して値を保存（即時ファイル書き込み） */
  set(key, value) {
    this._data[key] = value;
    this._save();
  }

  /** キーを削除 */
  delete(key) {
    delete this._data[key];
    this._save();
  }

  /** 全データを返す */
  getAll() {
    return { ...this._data };
  }
}

// --- シングルトンインスタンス ---

/** アプリ設定用ストア（APIキー、列設定など） */
let settingsStore = null;
function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = new Store('settings.json', {
      jquantsApiKey: '',
      gridColumns: [],
    });
  }
  return settingsStore;
}

/** ポートフォリオデータ用ストア */
let portfolioStore = null;
function getPortfolioStore() {
  if (!portfolioStore) {
    portfolioStore = new Store('portfolio.json', {
      holdings: [],
    });
  }
  return portfolioStore;
}

module.exports = { Store, getSettingsStore, getPortfolioStore };
