/**
 * jquants_client.js - J-Quants API V2 通信モジュール
 *
 * 責務:
 *   - x-api-key ヘッダーによる認証
 *   - 全APIリクエストに対する 429 (Rate Limit) リトライ（指数バックオフ）
 *   - インメモリキャッシュによる重複リクエストの抑制
 */

const https = require('https');
const { getSettingsStore } = require('./store');

const BASE_URL = 'https://api.jquants.com/v2';

// --- インメモリキャッシュ ---
const cache = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5分

function getCacheKey(endpoint, params) {
  const sorted = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
  return `${endpoint}::${sorted}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlMs = DEFAULT_CACHE_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** キャッシュを全消去する */
function clearCache() {
  cache.clear();
}

// --- APIキー取得 ---

/**
 * 設定ストアから保存済みの APIキーを取得する。
 * V2 では x-api-key ヘッダーに直接渡す。
 */
function getApiKey() {
  const settings = getSettingsStore();
  const apiKey = settings.get('jquantsApiKey', '');
  if (!apiKey) {
    throw new Error('J-Quants APIキーが設定されていません。設定画面で入力してください。');
  }
  return apiKey;
}

// --- HTTP リクエスト基盤 ---

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

/**
 * Node.js 標準 https モジュールを使った HTTP リクエスト。
 * 429 レスポンス時は指数バックオフでリトライする。
 */
function httpRequest(method, url, body, headers, retryCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers },
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          if (retryCount >= MAX_RETRIES) {
            return reject(new Error('J-Quants API rate limit: リトライ上限に達しました'));
          }
          const delay = BASE_BACKOFF_MS * Math.pow(2, retryCount);
          console.log(`[jquants] 429 Rate Limited. ${delay}ms 後にリトライ (${retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            httpRequest(method, url, body, headers, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, delay);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`J-Quants API error ${res.statusCode}: ${rawData}`));
        }
        try {
          resolve(JSON.parse(rawData));
        } catch {
          reject(new Error(`J-Quants API: JSON parse error - ${rawData.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- 公開 API メソッド ---

/**
 * 認証付き GET リクエスト（キャッシュ・ページネーション対応）
 * V2 は x-api-key ヘッダーで認証し、レスポンスは { data: [...], pagination_key? } 形式。
 *
 * @param {string} endpoint - 例: '/equities/master'
 * @param {object} [params] - クエリパラメータ
 * @param {number} [cacheTtlMs] - キャッシュ有効期間
 */
async function fetchApi(endpoint, params = {}, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
  const cacheKey = getCacheKey(endpoint, params);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const apiKey = getApiKey();
  let allData = [];
  let currentParams = { ...params };

  // ページネーション対応: pagination_key がある限り次ページを取得
  do {
    const query = new URLSearchParams(currentParams).toString();
    const url = `${BASE_URL}${endpoint}${query ? '?' + query : ''}`;
    const res = await httpRequest('GET', url, null, {
      'x-api-key': apiKey,
    });

    const pageData = res.data || [];
    allData = allData.concat(pageData);

    if (res.pagination_key) {
      currentParams.pagination_key = res.pagination_key;
    } else {
      break;
    }
  } while (true);

  setCache(cacheKey, allData, cacheTtlMs);
  return allData;
}

/**
 * 上場銘柄一覧を取得（V2: /equities/master）
 * @param {string} [date] - 基準日 (YYYY-MM-DD)
 */
async function getListedInfo(date) {
  const params = {};
  if (date) params.date = date;
  return await fetchApi('/equities/master', params);
}

/**
 * 株価四本値（日足）を取得（V2: /equities/bars/daily）
 * @param {string} code - 銘柄コード
 * @param {string} [from] - 開始日
 * @param {string} [to]   - 終了日
 */
async function getDailyQuotes(code, from, to) {
  const params = { code };
  if (from) params.from = from;
  if (to) params.to = to;
  return await fetchApi('/equities/bars/daily', params);
}

/**
 * 財務サマリーを取得（V2: /fins/summary）
 * @param {string} code - 銘柄コード
 * @param {string} [date] - 基準日
 */
async function getFinancialSummary(code, date) {
  const params = { code };
  if (date) params.date = date;
  return await fetchApi('/fins/summary', params, 30 * 60 * 1000); // 30分キャッシュ
}

module.exports = {
  fetchApi,
  getListedInfo,
  getDailyQuotes,
  getFinancialSummary,
  clearCache,
};
