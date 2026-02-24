/**
 * app.js - Renderer Process UI ロジック
 *
 * 責務:
 *   - ag-Grid の初期化と表示
 *   - タブ切り替え / モーダル操作
 *   - window.api (preload.js) 経由で Main Process から
 *     「計算済みデータ配列」を受け取り、グリッドに流し込む
 *
 * 禁止事項（アーキテクチャ制約）:
 *   - localStorage の使用
 *   - データ結合や財務指標の計算
 */

// ============================================================
//  ag-Grid 列定義
// ============================================================

const screeningColumnDefs = [
  { headerName: '銘柄コード', field: 'code', width: 110, pinned: 'left' },
  { headerName: '日付', field: 'date', width: 110 },
  { headerName: '始値', field: 'open', width: 100, type: 'numericColumn' },
  { headerName: '高値', field: 'high', width: 100, type: 'numericColumn' },
  { headerName: '安値', field: 'low', width: 100, type: 'numericColumn' },
  { headerName: '終値', field: 'close', width: 100, type: 'numericColumn' },
  { headerName: '出来高', field: 'volume', width: 120, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '売買代金', field: 'turnoverValue', width: 140, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: 'EPS', field: 'eps', width: 90, type: 'numericColumn' },
  { headerName: 'BPS', field: 'bps', width: 90, type: 'numericColumn' },
  { headerName: 'PER', field: 'per', width: 90, type: 'numericColumn' },
  { headerName: 'PBR', field: 'pbr', width: 90, type: 'numericColumn' },
  { headerName: '配当利回り(%)', field: 'dividendYield', width: 130, type: 'numericColumn' },
];

const portfolioColumnDefs = [
  { headerName: '銘柄コード', field: 'code', width: 110, pinned: 'left' },
  { headerName: '保有株数', field: 'shares', width: 100, type: 'numericColumn' },
  { headerName: '取得単価', field: 'avgCost', width: 110, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '現在値', field: 'currentPrice', width: 110, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '取得総額', field: 'totalCost', width: 120, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '評価額', field: 'marketValue', width: 120, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '損益', field: 'profitLoss', width: 120, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; },
    cellStyle: function (p) {
      if (p.value > 0) return { color: '#d32f2f' };   // 利益: 赤
      if (p.value < 0) return { color: '#1565c0' };   // 損失: 青
      return null;
    } },
  { headerName: '損益率(%)', field: 'profitLossPercent', width: 110, type: 'numericColumn',
    cellStyle: function (p) {
      if (p.value > 0) return { color: '#d32f2f' };
      if (p.value < 0) return { color: '#1565c0' };
      return null;
    } },
  { headerName: '売買代金', field: 'turnoverValue', width: 140, type: 'numericColumn',
    valueFormatter: function (p) { return p.value != null ? p.value.toLocaleString() : ''; } },
  { headerName: '基準日', field: 'date', width: 110 },
  { headerName: '', field: '_action', width: 80, pinned: 'right', sortable: false,
    filter: false,
    cellRenderer: function (params) {
      var btn = document.createElement('button');
      btn.textContent = '削除';
      btn.style.cssText = 'padding:2px 8px;font-size:12px;cursor:pointer;';
      btn.addEventListener('click', function () { removeHolding(params.data.code); });
      return btn;
    } },
];

// ============================================================
//  ag-Grid インスタンス
// ============================================================

var screeningGrid = null;
var portfolioGrid = null;

function initGrids() {
  var screeningEl = document.getElementById('screening-grid');
  screeningGrid = agGrid.createGrid(screeningEl, {
    columnDefs: screeningColumnDefs,
    rowData: [],
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true,
    },
    animateRows: true,
  });

  var portfolioEl = document.getElementById('portfolio-grid');
  portfolioGrid = agGrid.createGrid(portfolioEl, {
    columnDefs: portfolioColumnDefs,
    rowData: [],
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true,
    },
    animateRows: true,
  });
}

// ============================================================
//  タブ切り替え
// ============================================================

function initTabs() {
  var buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.remove('active');
      });
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ============================================================
//  設定モーダル
// ============================================================

function initSettingsModal() {
  var modal = document.getElementById('modal-settings');
  var inputApiKey = document.getElementById('input-api-key');
  var statusText = document.getElementById('api-key-status');

  document.getElementById('btn-settings').addEventListener('click', async function () {
    var status = await window.api.getApiKeyStatus();
    inputApiKey.value = '';
    statusText.textContent = status.hasApiKey ? 'APIキーは設定済みです' : 'APIキーが未設定です';
    inputApiKey.placeholder = status.hasApiKey ? '(設定済み・変更する場合のみ入力)' : 'APIキーを入力';
    modal.classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', function () {
    modal.classList.add('hidden');
  });

  document.getElementById('form-settings').addEventListener('submit', async function (e) {
    e.preventDefault();
    var apiKey = inputApiKey.value.trim();
    if (!apiKey) return;
    await window.api.saveApiKey(apiKey);
    modal.classList.add('hidden');
  });
}

// ============================================================
//  スクリーニング
// ============================================================

function initScreening() {
  document.getElementById('btn-fetch-screening').addEventListener('click', async function () {
    var status = document.getElementById('screening-status');
    status.textContent = '銘柄一覧を取得中...';

    try {
      var listed = await window.api.getListed();
      status.textContent = listed.length + ' 件取得。株価・財務データを取得中...';

      // 先頭 50 件に制限（全銘柄は時間がかかるため、必要に応じて上限を調整）
      var codes = listed.slice(0, 50).map(function (item) { return item.Code; });
      var data = await window.api.getScreeningData(codes);

      screeningGrid.setGridOption('rowData', data);
      status.textContent = data.length + ' 件のデータを表示中';
    } catch (err) {
      status.textContent = 'エラー: ' + err.message;
    }
  });
}

// ============================================================
//  ポートフォリオ
// ============================================================

async function refreshPortfolio() {
  var status = document.getElementById('portfolio-status');
  status.textContent = '損益を計算中...';
  try {
    var data = await window.api.getPortfolioData();
    portfolioGrid.setGridOption('rowData', data);
    status.textContent = data.length + ' 件の保有銘柄';
  } catch (err) {
    status.textContent = 'エラー: ' + err.message;
  }
}

async function removeHolding(code) {
  if (!confirm(code + ' を保有銘柄から削除しますか？')) return;
  await window.api.removeHolding(code);
  refreshPortfolio();
}

function initPortfolio() {
  document.getElementById('btn-refresh-portfolio').addEventListener('click', refreshPortfolio);

  var modal = document.getElementById('modal-add-holding');
  document.getElementById('btn-add-holding').addEventListener('click', function () {
    document.getElementById('form-add-holding').reset();
    modal.classList.remove('hidden');
  });
  document.getElementById('btn-close-add-holding').addEventListener('click', function () {
    modal.classList.add('hidden');
  });

  document.getElementById('form-add-holding').addEventListener('submit', async function (e) {
    e.preventDefault();
    var code = document.getElementById('input-code').value.trim();
    var shares = parseInt(document.getElementById('input-shares').value, 10);
    var avgCost = parseFloat(document.getElementById('input-avg-cost').value);
    if (!code || !shares || !avgCost) return;

    await window.api.addHolding(code, shares, avgCost);
    modal.classList.add('hidden');
    refreshPortfolio();
  });
}

// ============================================================
//  初期化
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  initGrids();
  initTabs();
  initSettingsModal();
  initScreening();
  initPortfolio();
});
