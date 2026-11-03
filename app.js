import { isConfirmedInactiveRow } from './material-activity.js?v=20261103100339';
import { materialAddedDate, materialCountApplicable } from './material-time.js?v=20261103100339';


let rows = [];
let materialRegistry = [];
let liveRowsLoaded = false;
let loadedPeriod = null;
let loadState = 'idle';
let pageRecheckEvidence = null;
let loadSequence = 0;
let preparedRows = null;

const isNumber = value => typeof value === "number" && Number.isFinite(value);
const formatMoney = value => isNumber(value) ? `¥${value.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}` : (value ?? "—");
const formatNumber = value => isNumber(value) ? value.toLocaleString("zh-CN") : (value ?? "—");
const formatRatio = (numerator, denominator, digits = 2) => isNumber(numerator) && isNumber(denominator) && denominator ? (numerator / denominator).toFixed(digits) : "—";
const formatPercent = (numerator, denominator) => isNumber(numerator) && isNumber(denominator) && denominator ? `${(numerator / denominator * 100).toFixed(2)}%` : "—";
const categoryClass = category => ({ 放量: "green", 观察: "gray", 降预算: "orange", 排查: "red", 数据不足: "gray" }[category] || "gray");
const normalizedRate = value => isNumber(value) ? (value > 1 ? value / 100 : value) : undefined;
const derivedThreeSecondPlayCount = row => {
  if (isNumber(row.threeSecondPlayCount)) return row.threeSecondPlayCount;
  const rate = normalizedRate(row.threeSecondPlayRate);
  if (isNumber(row.videoPlayCount) && isNumber(rate)) return row.videoPlayCount * rate;
  return undefined;
};

const quickRange = document.querySelector("#quickRange");
const dateFrom = document.querySelector("#dateFrom");
const dateTo = document.querySelector("#dateTo");
const storeFilter = document.querySelector("#storeFilter");
const producerFilter = document.querySelector("#producerFilter");
const productFilter = document.querySelector("#productFilter");
const searchFilter = document.querySelector("#searchFilter");
const dataBody = document.querySelector("#dataBody");
const copyStatus = document.querySelector("#copyStatus");
const connectOceanEngineButton = document.querySelector("#connectOceanEngineButton");
const connectionStatus = document.querySelector("#connectionStatus");
const connectionStatusText = document.querySelector("#connectionStatusText");
const dataFreshness = document.querySelector("#dataFreshness");

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const OCEAN_ENGINE_UPGRADE_URL = "";

async function refreshConnectionStatus() {
  try {
    const response = await fetch("/api/oceanengine/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const status = await response.json();
    const connected = status.loggedIn === true;
    connectionStatus.dataset.state = connected ? "connected" : "disconnected";
    connectionStatusText.textContent = connected ? "千川已接入" : "千川需验证";
    connectionStatus.title = connected
      ? "巨量引擎升级版会话有效，当前组织可继续采集"
      : "巨量引擎登录会话已失效，请点击打开升级版并重新验证";
  } catch {
    connectionStatus.dataset.state = "offline";
    connectionStatusText.textContent = "本地采集服务未启动";
    connectionStatus.title = "请先运行 node server.js";
  }
}

function addOptions(select, values, allLabel) {
  select.innerHTML = `<option value="all">${allLabel}</option>` + values.map(value => `<option value="${value}">${value}</option>`).join("");
}

const shanghaiDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};
const shiftIsoDate = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function setDateRange(from, to, preset = "custom") {
  dateFrom.value = from;
  dateTo.value = to;
  quickRange.value = preset;
}

function setDefaultDateRange() {
  const end = shanghaiDate(-1);
  setDateRange(`${end.slice(0, 7)}-01`, end, "month-to-yesterday");
}

function applyQuickRange() {
  const end = shanghaiDate(-1);
  if (quickRange.value === "month-to-yesterday") setDateRange(`${end.slice(0, 7)}-01`, end, "month-to-yesterday");
  if (quickRange.value === "last7") {
    setDateRange(shiftIsoDate(end, -6), end, "last7");
  }
  if (quickRange.value === "yesterday") setDateRange(end, end, "yesterday");
  render();
  loadDashboardRows();
}

function periodText() {
  if (!dateFrom.value || !dateTo.value) return "请选择日期范围";
  if (dateFrom.value === dateTo.value) return `${dateFrom.value} · 每日采集前一天数据`;
  return `${dateFrom.value} 至 ${dateTo.value} · 每日采集前一天数据`;
}

function periodDisplay() {
  if (!dateFrom.value || !dateTo.value) return "—";
  const from = new Date(`${dateFrom.value}T00:00:00Z`);
  const to = new Date(`${dateTo.value}T00:00:00Z`);
  const format = date => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return from.getTime() === to.getTime() ? format(from) : `${format(from)}～${format(to)}`;
}

function initFilters() {
  addOptions(storeFilter, [...new Set(rows.map(row => row.store))], "全部店铺");
  addOptions(producerFilter, sortProducers([...new Set(rows.map(row => row.creator))]), "全部制作方");
  producerFilter.insertAdjacentHTML("beforeend", '<option value="__summary__">自产+供+AI（汇总）</option>');
  addOptions(productFilter, [...new Set(rows.map(row => row.product))], "全部主推产品");
  setDefaultDateRange();
}

function refreshDimensionFilters() {
  const selected = { store: storeFilter.value, producer: producerFilter.value, product: productFilter.value };
  const dimensions=[...rows,...materialRegistry,...(preparedRows || [])];
  addOptions(storeFilter, [...new Set(dimensions.map(row => row.store).filter(Boolean))], "全部店铺");
  addOptions(producerFilter, sortProducers([...new Set(dimensions.map(row => row.creator).filter(Boolean))]), "全部制作方");
  producerFilter.insertAdjacentHTML("beforeend", '<option value="__summary__">自产+供+AI（汇总）</option>');
  addOptions(productFilter, [...new Set(dimensions.map(row => row.product).filter(Boolean))], "全部主推产品");
  if ([...storeFilter.options].some(option => option.value === selected.store)) storeFilter.value = selected.store;
  if ([...producerFilter.options].some(option => option.value === selected.producer)) producerFilter.value = selected.producer;
  if ([...productFilter.options].some(option => option.value === selected.product)) productFilter.value = selected.product;
}

function normalizeDashboardRow(row) {
  return {
    ...row,
    date: row.date,
    account: row.account_name || row.account_id || "—",
    plan: row.plan_id || row.material_id || "—",
    room: row.store || "—",
    store: row.store,
    creator: row.producer,
    product: row.product,
    videoType: row.video_type,
    spend: row.spend,
    gmv: row.gmv,
    orders: row.orders,
    impressions: row.impressions,
    clicks: row.clicks,
    videoPlayCount: row.video_play_count,
    threeSecondPlayRate: row.three_second_play_rate,
    threeSecondPlayCount: row.three_second_play_count,
    materialCreateTime: row.material_create_time,
    materialNew: row.materialNew,
    monthlyPublished: row.monthlyPublished,
    monthlyMaterialSpend: row.monthlyMaterialSpend,
    cumulativePublished: row.cumulativePublished,
    cumulativeMaterialSpend: row.cumulativeMaterialSpend
  };
}

function hasCurrentPeriodData() {
  return liveRowsLoaded && loadedPeriod?.start === dateFrom.value && loadedPeriod?.end === dateTo.value;
}

async function loadDashboardRows() {
  const sequence = ++loadSequence;
  const start = dateFrom.value;
  const end = dateTo.value;
  if (!start || !end) return;
  if(start>end){dataFreshness.textContent='开始日期不能晚于结束日期';return;}
  loadState = 'loading';
  if (!hasCurrentPeriodData()) dataFreshness.textContent = '正在加载所选日期的数据';
  render();
  try {
    const response = await fetch(`/api/dashboard/rows?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if(sequence!==loadSequence)return;
    if (payload.status === "collector_not_ready") {
      loadState = 'failed';
      dataFreshness.textContent = "采集器待就绪，所选日期数据未加载";
      render();
      return;
    }
    if (!response.ok) throw new Error("dashboard rows unavailable");
    if (payload.status === "ok" && Array.isArray(payload.rows)) {
      if (payload.preparedRows && (payload.preparedPeriod?.start !== start || payload.preparedPeriod?.end !== end)) {
        throw new Error('Prepared data does not match the selected dates');
      }
      preparedRows = Array.isArray(payload.preparedRows) ? payload.preparedRows : null;
      rows = payload.rows.map(normalizeDashboardRow);
      materialRegistry = (payload.materials || []).map(normalizeDashboardRow);
      pageRecheckEvidence = payload.quality?.pageRecheck || null;
      liveRowsLoaded = true;
      loadedPeriod = {start, end};
      loadState = 'ready';
      refreshDimensionFilters();
      if(sequence!==loadSequence)return;
      const quality = payload.quality || {};
      const available=payload.availablePeriod?.end||quality.end||quality.date;
      const lag=available&&available<shanghaiDate(-1)?` · 待补采至${shanghaiDate(-1)}`:'';
      dataFreshness.textContent = `千川数据已更新至 ${available||'待确认'}${lag} · 北京时间每日18:00采集前一天`;
      try{
        const runResponse=await fetch('/api/dashboard/collection-status',{cache:'no-store'});
        if(runResponse.ok){const state=await runResponse.json();
          if(sequence!==loadSequence)return;
          if(state.run?.state==='running')dataFreshness.textContent+=' · 昨日数据采集中';
          else if(state.run?.state==='failed')dataFreshness.textContent+=' · 采集失败，待重试';
          else if(state.run?.state==='completed_with_warnings'){
            const warnings=(state.run.processed||[]).flatMap(day=>day.coverageWarnings||[]);
            dataFreshness.textContent+=warnings.some(w=>w.startsWith('video_metrics_all_zero:'))
              ?` · ${state.run.targetDate} 播放数及3秒播放率返回全0，待复核`
              :' · 部分采集字段待复核';
          }
          else if(state.missingDates?.length)dataFreshness.textContent+=` · ${state.missingDates.length}天待补采`;
        }
      }catch{}
      render();
      return;
    }
    throw new Error('Invalid dashboard response');
  } catch {
    if(sequence!==loadSequence)return;
    loadState = 'failed';
    dataFreshness.textContent = hasCurrentPeriodData() ? '刷新失败，当前保留同一日期范围的上次数据' : '所选日期加载失败，请刷新重试';
    render();
  }
}

function renderQuality() {}

function filteredRows({ ignoreProducer = false, ignoreSearch = false } = {}) {
  const query = searchFilter.value.trim().toLowerCase();
  const from = dateFrom.value || "0000-01-01";
  const to = dateTo.value || "9999-12-31";
  return rows.filter(row => !isConfirmedInactiveRow(row) && row.date >= from && row.date <= to &&
    (storeFilter.value === "all" || row.store === storeFilter.value) &&
    (ignoreProducer || producerFilter.value === "all" || row.creator === producerFilter.value) &&
    (productFilter.value === "all" || row.product === productFilter.value) &&
    (ignoreSearch || !query || `${row.store} ${row.creator} ${row.product} ${row.plan}`.toLowerCase().includes(query)));
}

function sumNumeric(group, field) {
  const values = group.map(row => row[field]).filter(isNumber);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function sumThreeSecondPlayCount(group) {
  const values = group.map(derivedThreeSecondPlayCount).filter(isNumber);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

const summaryMembers = new Set(["自产视频", "AI视频", "逐光", "美创", "影舞"]);
// Matches the producer row order in the Excel source blocks.
const producerOrder = ["自产视频", "AI视频", "逐光", "美创", "光年", "影舞", "AIGC", "达人视频", "画面直投", "待人工确认"];
const producerRank = new Map(producerOrder.map((producer, index) => [producer, index]));

function compareProducers(left, right) {
  const leftRank = producerRank.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = producerRank.get(right) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.localeCompare(right, "zh-CN");
}

function sortProducers(producers) {
  return [...producers].sort(compareProducers);
}

function materialKey(row) {
  // plan_id is not available in the material dataset and several assets can
  // share the same creation timestamp. Use the account-scoped material ID.
  return [row.account_id || row.account, row.materialId || row.material_id || row.plan].join("\u001f");
}

function createdDate(row) {
  return materialAddedDate(row);
}

function buildAggregateRow(group, creator, summary = false, registryGroup = []) {
  const from = dateFrom.value || "0000-01-01";
  const to = dateTo.value || "9999-12-31";
  const materials = new Map();
  group.forEach(row => {
    const key = materialKey(row);
    if (!materials.has(key)) materials.set(key, row);
  });
  registryGroup.forEach(row => materials.set(materialKey(row),row));
  const materialRows = [...materials.values()];
  const seed = group[0] || registryGroup[0];
  const countableMaterials=materialRows.filter(materialCountApplicable);
  const completeTimes = countableMaterials.length>0&&countableMaterials.every(row => Boolean(createdDate(row)));
  const monthStart = `${to.slice(0, 7)}-01`;
  const monthMaterials = new Set(materialRows.filter(row => {
    const created = createdDate(row);
    return created && created >= monthStart && created <= to;
  }).map(materialKey));
  const selectedMaterials = new Set(materialRows.filter(row => {
    const created = createdDate(row);
    return created && created >= from && created <= to;
  }).map(materialKey));
  const cumulativeMaterials = new Set(materialRows.filter(row => {
    const created = createdDate(row);
    return created && created <= to;
  }).map(materialKey));
  const metricFor = keys => group.filter(row => keys.has(materialKey(row)));
  const selectedRows = group.filter(row => selectedMaterials.has(materialKey(row)));
  const monthRows = group.filter(row => monthMaterials.has(materialKey(row)));
  const cumulativeRows = group.filter(row => cumulativeMaterials.has(materialKey(row)));
  return {
    summary,
    date: seed.date,
    account: "汇总",
    plan: summary ? "自产+供+AI" : "制作方汇总",
    room: seed.room,
    store: seed.store,
    creator,
    product: seed.product,
    videoType: seed.videoType,
    spend: sumNumeric(group, "spend"),
    gmv: sumNumeric(group, "gmv"),
    orders: sumNumeric(group, "orders"),
    materialNew: completeTimes ? selectedMaterials.size : undefined,
    monthlyPublished: completeTimes ? monthMaterials.size : undefined,
    monthlyMaterialSpend: completeTimes ? sumNumeric(monthRows, "spend") ?? 0 : undefined,
    cumulativePublished: completeTimes ? cumulativeMaterials.size : undefined,
    cumulativeMaterialSpend: sumNumeric(group, "spend"),
    impressions: sumNumeric(group, "impressions"),
    clicks: sumNumeric(group, "clicks"),
    videoPlayCount: sumNumeric(group, "videoPlayCount"),
    threeSecondPlayCount: sumThreeSecondPlayCount(group)
  };
}

function aggregateRows(baseRows) {
  const groups = new Map();
  const registryGroups = new Map();
  const registryContexts = new Map();
  for(const row of materialRegistry){
    if((storeFilter.value!=='all'&&row.store!==storeFilter.value)||(productFilter.value!=='all'&&row.product!==productFilter.value))continue;
    if(createdDate(row)&&createdDate(row)>(dateTo.value||'9999-12-31'))continue;
    const key=[row.store,row.videoType,row.product,row.creator].join('\u001f');
    if(!registryGroups.has(key))registryGroups.set(key,[]);
    registryGroups.get(key).push(row);
    const context=[row.store,row.videoType,row.product].join('\u001f');
    if(!registryContexts.has(context))registryContexts.set(context,[]);
    registryContexts.get(context).push(row);
  }
  baseRows.forEach(row => {
    const key = [row.store, row.videoType, row.product, row.creator].join("\u001f");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  for(const key of registryGroups.keys())if(!groups.has(key))groups.set(key,[]);
  const producerRows = [...groups.entries()].map(([key,group]) => buildAggregateRow(group, (group[0]||registryGroups.get(key)[0]).creator,false,registryGroups.get(key)||[]));
  const contextGroups = new Map();
  baseRows.forEach(row => {
    const key = [row.store, row.videoType, row.product].join("\u001f");
    if (!contextGroups.has(key)) contextGroups.set(key, []);
    contextGroups.get(key).push(row);
  });
  const summaryRows = [...new Set([...contextGroups.keys(),...registryContexts.keys()])].flatMap(key=>{
    const group=(contextGroups.get(key)||[]).filter(row=>summaryMembers.has(row.creator));
    const registry=(registryContexts.get(key)||[]).filter(row=>summaryMembers.has(row.creator));
    return group.length||registry.length?[buildAggregateRow(group,'自产+供+AI',true,registry)]:[];
  });
  const monthStart = `${(dateTo.value || "0000-01-01").slice(0, 7)}-01`;
  const denominators = new Map([...contextGroups.entries()].map(([key, group]) => [key, {
    monthly: group.filter(materialCountApplicable).every(row => Boolean(createdDate(row))) ? sumNumeric(group.filter(row => {
      const created = createdDate(row);
      return created && created >= monthStart && created <= (dateTo.value || "9999-12-31");
    }), "spend") ?? 0 : undefined,
    cumulative: sumNumeric(group, "spend")
  }]));
  const withShares = row => {
    const key = [row.store, row.videoType, row.product].join("\u001f");
    const denominator = denominators.get(key) || {};
    return {
      ...row,
      monthlySpendShare: isNumber(row.monthlyMaterialSpend) && isNumber(denominator.monthly) && denominator.monthly ? row.monthlyMaterialSpend / denominator.monthly : undefined,
      cumulativeSpendShare: isNumber(row.cumulativeMaterialSpend) && isNumber(denominator.cumulative) && denominator.cumulative ? row.cumulativeMaterialSpend / denominator.cumulative : undefined
    };
  };
  return [...summaryRows, ...producerRows].map(withShares).sort((a, b) => {
    const contextA = `${a.store}\u001f${a.product}\u001f${a.videoType}`;
    const contextB = `${b.store}\u001f${b.product}\u001f${b.videoType}`;
    if (contextA !== contextB) return contextA.localeCompare(contextB, "zh-CN");
    if (a.summary !== b.summary) return a.summary ? -1 : 1;
    return compareProducers(a.creator, b.creator);
  });
}

function displayRows() {
  if (!hasCurrentPeriodData()) return [];
  const summaryOnly = producerFilter.value === "__summary__";
  // Ratios and shares keep their full denominator while a producer/search
  // filter only changes which already-aggregated rows are shown.
  const baseRows = filteredRows({ ignoreProducer: true, ignoreSearch: true });
  const aggregated = preparedRows ? preparedRows.filter(row =>
    (storeFilter.value === 'all' || row.store === storeFilter.value) &&
    (productFilter.value === 'all' || row.product === productFilter.value)) : aggregateRows(baseRows);
  let visible = summaryOnly ? aggregated.filter(row => row.summary) :
    producerFilter.value === "all" ? aggregated : aggregated.filter(row => row.creator === producerFilter.value);
  const query = searchFilter.value.trim().toLowerCase();
  if (query) visible = visible.filter(row => `${row.store} ${row.creator} ${row.product} ${row.plan}`.toLowerCase().includes(query));
  return visible;
}

function excelRow(row) {
  const threeSecondPlayRate = isNumber(row.videoPlayCount) && isNumber(derivedThreeSecondPlayCount(row))
    ? derivedThreeSecondPlayCount(row) / row.videoPlayCount
    : normalizedRate(row.threeSecondPlayRate);
  return [
    periodDisplay(),
    "抖音",
    row.videoType ?? "短视频",
    row.store,
    row.creator,
    row.product,
    row.materialNew,
    row.monthlyPublished,
    row.monthlyMaterialSpend,
    row.monthlySpendShare,
    row.cumulativePublished,
    row.cumulativeMaterialSpend,
    row.cumulativeSpendShare,
    row.gmv,
    row.gmv === undefined ? undefined : formatRatio(row.gmv, row.cumulativeMaterialSpend),
    row.impressions,
    row.clicks,
    row.impressions === undefined || row.clicks === undefined ? undefined : formatPercent(row.clicks, row.impressions),
    row.orders,
    row.clicks === undefined ? undefined : formatPercent(row.orders ?? 0, row.clicks),
    threeSecondPlayRate,
  ];
}

function displayExcelValue(value, index) {
  if (value === undefined || value === null || value === "") return "—";
  if ([8, 11, 13].includes(index)) return formatMoney(value);
  if ([9, 12, 17, 19, 20].includes(index)) return isNumber(value) ? `${(value * 100).toFixed(2)}%` : value;
  if ([6, 7, 10, 15, 16, 18].includes(index)) return formatNumber(value);
  return value;
}

function render() {
  const visible = displayRows();
  dataBody.innerHTML = visible.length ? visible.map(row => {
    const values = excelRow(row);
    return `<tr class="${row.summary ? "summary-row" : ""}">${values.map((value, index) => `<td class="${[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].includes(index) ? "number" : ""} copyable" data-copy="${escapeHtml(value ?? "—")}">${escapeHtml(displayExcelValue(value, index))}</td>`).join("")}</tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="21">${hasCurrentPeriodData() ? '没有符合条件的数据' : loadState === 'failed' ? '所选日期数据加载失败，请点击刷新重试' : '正在加载所选日期的数据'}</td></tr>`;
  document.querySelector("#resultCount").textContent = `显示 ${visible.length} 条`;
  document.querySelector("#periodLabel").textContent = periodText();
  renderQuality();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const helper = document.createElement("textarea"); helper.value = text; document.body.appendChild(helper); helper.select(); document.execCommand("copy"); helper.remove(); }
  copyStatus.textContent = "已复制";
  window.setTimeout(() => { copyStatus.textContent = ""; }, 1600);
}

function asTsv(data) {
  const headers = ["时间维度", "渠道", "视频类型", "店铺", "制作方", "主推产品", "制作条数（新）", "当月发布素材条数", "当月发布素材消耗", "当月消耗占比", "累计发布素材条数", "累计发布素材消耗", "累计消耗占比", "成交金额", "ROI", "展示次数", "点击次数", "点击率", "成交订单数", "转化率", "3秒播放率"];
  const values=data.map(row=>excelRow(row).map((value,index)=>{
    if(value===undefined||value===null)return '';
    if([9,12,20].includes(index))return displayExcelValue(value,index);
    if([8,11,13].includes(index)&&isNumber(value))return value.toFixed(2);
    return value;
  }));
  return [headers, ...values].map(line => line.join("\t")).join("\n");
}

function exportCsv() {
  const lines = asTsv(displayRows()).split("\n").map(line => line.split("\t"));
  const csv = lines.map(line => line.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = "qianchuan-material-creator-statistics.csv";
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

quickRange.addEventListener("change", applyQuickRange);
[dateFrom, dateTo, storeFilter, producerFilter, productFilter].forEach(element => element.addEventListener("change", () => {
  if (element === dateFrom || element === dateTo) quickRange.value = "custom";
  render();
  if (element === dateFrom || element === dateTo) loadDashboardRows();
}));
searchFilter.addEventListener("input", render);
document.querySelector("#clearButton").addEventListener("click", () => { setDefaultDateRange(); storeFilter.value = "all"; producerFilter.value = "all"; productFilter.value = "all"; searchFilter.value = ""; render(); loadDashboardRows(); });
document.querySelector("#copyButton").addEventListener("click", () => copyText(asTsv(displayRows())));
document.querySelector("#exportButton").addEventListener("click", exportCsv);
document.querySelector("#reloadButton").addEventListener("click", () => {loadDashboardRows();refreshConnectionStatus();});
connectOceanEngineButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/oceanengine/open");
    if (!response.ok) throw new Error("local launcher unavailable");
    copyStatus.textContent = "已打开独立浏览器";
  } catch {
    window.open(OCEAN_ENGINE_UPGRADE_URL, "oceanengine-upgrade");
    copyStatus.textContent = "已打开升级版链接";
  }
  window.setTimeout(refreshConnectionStatus, 1200);
  window.setTimeout(() => { copyStatus.textContent = ""; }, 2200);
});
dataBody.addEventListener("click", event => { const cell = event.target.closest("[data-copy]"); if (cell) copyText(cell.dataset.copy); });

initFilters();
render();
refreshConnectionStatus();
loadDashboardRows();
window.setInterval(refreshConnectionStatus, 30000);
