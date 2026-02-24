/**
 * jquants_client.js - J-Quants API 通信モジュール
 *
 * 責務:
 *   - リフレッシュトークン / IDトークンのライフサイクル管理
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

// --- トークン管理 ---
let idToken = null;
let idTokenExpiresAt = 0;

/**
 * 設定ストアから保存済みの APIキー（リフレッシュトークン）を取得する。
 * V2 ではメールアドレス/パスワードによる auth_user は不要。
 */
function getApiKey() {
  const settings = getSettingsStore();
  const apiKey = settings.get('jquantsApiKey', '');
  if (!apiKey) {
    throw new Error('J-Quants APIキーが設定されていません。設定画面で入力してください。');
  }
  return apiKey;
}

/**
 * APIキー（リフレッシュトークン）からIDトークン（アクセストークン）を取得する。
 * 有効期限内ならキャッシュ済みトークンを返す。
 */
async function getIdToken() {
  if (idToken && Date.now() < idTokenExpiresAt) {
    return idToken;
  }
  const refreshToken = getApiKey();
  const data = await httpRequest(
    'POST',
    `${BASE_URL}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`,
    null,
    {}
  );
  idToken = data.idToken;
  // IDトークンは24時間有効だが、安全マージンとして23時間でリフレッシュ
  idTokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
  return idToken;
}

/** IDトークンを強制的に破棄し、次回リクエスト時に再取得させる */
function invalidateToken() {
  idToken = null;
  idTokenExpiresAt = 0;
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
 * 認証付き GET リクエスト（キャッシュ対応）
 * @param {string} endpoint - 例: '/listed/info'
 * @param {object} [params] - クエリパラメータ
 * @param {number} [cacheTtlMs] - キャッシュ有効期間
 */
async function fetchApi(endpoint, params = {}, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
  const cacheKey = getCacheKey(endpoint, params);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const token = await getIdToken();
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}${query ? '?' + query : ''}`;
  const data = await httpRequest('GET', url, null, {
    Authorization: `Bearer ${token}`,
  });

  setCache(cacheKey, data, cacheTtlMs);
  return data;
}

/**
 * 上場銘柄一覧を取得
 * @param {string} [date] - 基準日 (YYYY-MM-DD)
 */
async function getListedInfo(date) {
  const params = {};
  if (date) params.date = date;
  const data = await fetchApi('/listed/info', params);
  return data.info || [];
}

/**
 * 株価四本値（日足）を取得
 * @param {string} code - 銘柄コード
 * @param {string} [from] - 開始日
 * @param {string} [to]   - 終了日
 */
async function getDailyQuotes(code, from, to) {
  const params = { code };
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fetchApi('/prices/daily_quotes', params);
  return data.daily_quotes || [];
}

/**
 * 財務サマリーを取得（V2: /fins/summary）
 * @param {string} code - 銘柄コード
 * @param {string} [date] - 基準日
 */
async function getFinancialSummary(code, date) {
  const params = { code };
  if (date) params.date = date;
  const data = await fetchApi('/fins/summary', params, 30 * 60 * 1000); // 30分キャッシュ
  return data.financialSummary || [];
}

module.exports = {
  fetchApi,
  getListedInfo,
  getDailyQuotes,
  getFinancialSummary,
  clearCache,
  invalidateToken,
};
