/**
 * data_manager.js - データ結合・投資指標計算モジュール
 *
 * 責務:
 *   - jquants_client から取得した株価・財務データを結合し、
 *     フロントエンドに渡す「計算済みの完全なデータ配列」を生成する
 *   - PER, PBR, 配当利回り等の投資指標を算出する
 *   - ポートフォリオの損益計算を行う
 *
 * フロントエンドはこのモジュールが返すオブジェクト配列を
 * そのまま ag-Grid に流し込むだけでよい。
 */

const jquants = require('./jquants_client');
const { getPortfolioStore } = require('./store');

// --- スクリーニング用: 銘柄一覧 + 最新株価 + 財務を結合 ---

/**
 * 銘柄コードの配列に対して株価・財務データを取得し、
 * 指標を計算済みの配列として返す。
 *
 * @param {string[]} codes - 銘柄コード一覧
 * @returns {Promise<object[]>} UI表示用のオブジェクト配列
 */
async function buildScreeningData(codes) {
  const results = await Promise.allSettled(
    codes.map((code) => fetchAndMerge(code))
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

/**
 * 単一銘柄の株価＋財務を取得・結合し、指標を付与して返す
 */
async function fetchAndMerge(code) {
  try {
    const [quotes, summary] = await Promise.all([
      jquants.getDailyQuotes(code),
      jquants.getFinancialSummary(code),
    ]);

    if (!quotes.length) return null;

    // 直近の日足データ
    const latest = quotes[quotes.length - 1];
    // 直近の財務サマリー
    const latestFin = summary.length ? summary[summary.length - 1] : {};

    return {
      code: latest.Code,
      date: latest.Date,
      open: safeNum(latest.O),
      high: safeNum(latest.H),
      low: safeNum(latest.L),
      close: safeNum(latest.C),
      volume: safeNum(latest.Vo),
      turnoverValue: safeNum(latest.Va),
      ...calcIndicators(latest, latestFin),
    };
  } catch (err) {
    console.error(`[data_manager] ${code} のデータ取得に失敗: ${err.message}`);
    return null;
  }
}

// --- 投資指標の計算 ---

/**
 * 数値として安全にパースする。空文字・null・undefined・NaN は null を返す。
 */
function safeNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 株価データと財務サマリーから投資指標を算出する。
 * V2 の省略フィールド名を直接使用する。
 * 値が欠落・0 の場合でもゼロ除算を起こさず null を返す安全な実装。
 *
 * @param {object} quote - 直近の日足データ (V2: C, AdjC, O, H, L, Vo, Va)
 * @param {object} fin   - 直近の財務サマリー (V2: EPS, BPS, NetSales, OperatingProfit, Profit, TotalAssets, Equity)
 * @returns {object} 算出された指標群
 */
function calcIndicators(quote, fin) {
  // 指標計算には調整後終値を優先（株式分割補正済み）、なければ終値
  const close = safeNum(quote.AdjC) ?? safeNum(quote.C);
  const eps = safeNum(fin.EPS);
  const bps = safeNum(fin.BPS);
  const dividend = safeNum(fin.DivAnn);

  return {
    eps,
    bps,
    dividendPerShare: dividend,
    netSales: safeNum(fin.NetSales),
    operatingProfit: safeNum(fin.OperatingProfit),
    profit: safeNum(fin.Profit),
    totalAssets: safeNum(fin.TotalAssets),
    equity: safeNum(fin.Equity),
    per: (close != null && eps != null && eps > 0) ? round(close / eps, 2) : null,
    pbr: (close != null && bps != null && bps > 0) ? round(close / bps, 2) : null,
    dividendYield: (close != null && close > 0 && dividend != null && dividend > 0)
      ? round((dividend / close) * 100, 2)
      : null,
  };
}

// --- ポートフォリオ損益計算 ---

/**
 * ポートフォリオの保有銘柄に対して最新株価を取得し、
 * 損益を計算済みの配列を返す。
 *
 * @returns {Promise<object[]>} ポートフォリオ表示用のオブジェクト配列
 */
async function buildPortfolioData() {
  const store = getPortfolioStore();
  const holdings = store.get('holdings', []);

  if (!holdings.length) return [];

  const results = await Promise.allSettled(
    holdings.map((h) => enrichHolding(h))
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

/**
 * 単一保有銘柄に最新株価を付与し、損益を計算する
 *
 * @param {object} holding - { code, shares, avgCost }
 */
async function enrichHolding(holding) {
  try {
    const quotes = await jquants.getDailyQuotes(holding.code);
    if (!quotes.length) return null;

    const latest = quotes[quotes.length - 1];
    const currentPrice = safeNum(latest.AdjC) ?? safeNum(latest.C);
    if (currentPrice == null) return null;

    const totalCost = holding.shares * holding.avgCost;
    const marketValue = holding.shares * currentPrice;
    const profitLoss = marketValue - totalCost;
    const profitLossPercent =
      totalCost > 0 ? round((profitLoss / totalCost) * 100, 2) : 0;

    return {
      code: holding.code,
      shares: holding.shares,
      avgCost: holding.avgCost,
      currentPrice,
      totalCost: round(totalCost, 0),
      marketValue: round(marketValue, 0),
      profitLoss: round(profitLoss, 0),
      profitLossPercent,
      turnoverValue: safeNum(latest.Va),
      date: latest.Date,
    };
  } catch (err) {
    console.error(`[data_manager] ポートフォリオ ${holding.code} の取得に失敗: ${err.message}`);
    return null;
  }
}

// --- ポートフォリオ CRUD ---

function getHoldings() {
  return getPortfolioStore().get('holdings', []);
}

function addHolding(code, shares, avgCost) {
  const store = getPortfolioStore();
  const holdings = store.get('holdings', []);
  const existing = holdings.find((h) => h.code === code);
  if (existing) {
    // 平均取得単価を再計算
    const totalShares = existing.shares + shares;
    existing.avgCost =
      round((existing.avgCost * existing.shares + avgCost * shares) / totalShares, 2);
    existing.shares = totalShares;
  } else {
    holdings.push({ code, shares, avgCost });
  }
  store.set('holdings', holdings);
}

function removeHolding(code) {
  const store = getPortfolioStore();
  const holdings = store.get('holdings', []).filter((h) => h.code !== code);
  store.set('holdings', holdings);
}

// --- ユーティリティ ---

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  buildScreeningData,
  buildPortfolioData,
  getHoldings,
  addHolding,
  removeHolding,
};
