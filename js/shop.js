import { getDateParts } from "./clock.js";
import { getIndustry, INDUSTRIES, getProficiencyBand } from "./industries.js";
import { getCrowding } from "./rivals.js";
import { isGuildMember } from "./guild.js";
import { getBestStaffSkill, hasStaffLodging } from "./staff.js";
import { hasItem } from "./items.js";

const STALL_LOCATIONS = new Set(["wazi", "city_god_temple", "qinghefang"]);
const STORE_LOCATIONS = new Set(["qinghefang", "imperial_street"]);
const STALL_TOP_FEE = 800;
const STALL_BROKER_FEE = 100;
const STALL_MONTHLY_DUE = 150;
const STORE_DEPOSIT = 3000;
const STORE_BROKER_FEE = 200;
const STORE_RENT = { qinghefang: 1200, imperial_street: 1800 };

export function normalizeShopState(saved = {}) {
  return {
    stall: normalizePlace(saved.stall, "stall"),
    store: normalizePlace(saved.store, "store"),
    brandRumors: Array.isArray(saved.brandRumors) ? saved.brandRumors.filter((item) => typeof item === "string").slice(-6) : [],
    lastDailyKey: typeof saved.lastDailyKey === "string" ? saved.lastDailyKey : "",
    lastMonthlyKey: typeof saved.lastMonthlyKey === "string" ? saved.lastMonthlyKey : "",
    lossReport: Array.isArray(saved.lossReport) ? saved.lossReport.filter((item) => typeof item === "string").slice(-8) : [],
  };
}

export function getShopActions(state) {
  const shop = ensureShop(state.player);
  const industryId = state.player.business.activeIndustryId || bestIndustry(state.player);
  const industry = getIndustry(industryId);
  const actions = [];
  if (industry) {
    const stallGate = canTopStall(state, industryId);
    actions.push({ id: `shop_stall:${industryId}`, name: `顶固定摊·${industry.name}`, description: `顶费${STALL_TOP_FEE}文+中费${STALL_BROKER_FEE}文 · 限瓦子/城隍庙/清河坊`, available: stallGate.ok, reason: stallGate.reason });
    const storeGate = canLeaseStore(state, industryId);
    actions.push({ id: `shop_store:${industryId}`, name: `赁铺面·${industry.name}`, description: `押金${STORE_DEPOSIT}文+首月租+中费${STORE_BROKER_FEE}文`, available: storeGate.ok, reason: storeGate.reason });
  }
  if (shop.stall.active) {
    actions.push({ id: "shop_vend:stall:player", name: `守固定摊·${shop.stall.brand}`, description: "3小时 · 地盘人流+30% · 回头客翻倍", available: state.player.location === shop.stall.locationId && getStockQty(state.player.business, shop.stall.industryId) > 0, reason: "需在摊位地点且有货" });
    actions.push({ id: "shop_vend:stall:staff", name: `雇工代守摊·${shop.stall.brand}`, description: "3小时 · 不耗玩家体力 · 按雇工手艺", available: state.player.location === shop.stall.locationId && hasStaffLodging(state.player) && getStockQty(state.player.business, shop.stall.industryId) > 0, reason: "需雇工、在摊位地点且有货" });
  }
  if (shop.store.active) {
    actions.push({ id: "shop_vend:store:player", name: `开铺·${shop.store.brand}`, description: "6小时 · 客单价上浮 · 打烊盘账", available: state.player.location === shop.store.locationId && getStockQty(state.player.business, shop.store.industryId) > 0, reason: "需在铺面地点且有货" });
    actions.push({ id: "shop_vend:store:staff", name: `雇工代守铺·${shop.store.brand}`, description: "6小时 · 不耗玩家体力 · 按雇工手艺", available: state.player.location === shop.store.locationId && hasStaffLodging(state.player) && getStockQty(state.player.business, shop.store.industryId) > 0, reason: "需雇工、在铺面地点且有货" });
  }
  return actions;
}

export function createShopAction(actionId, state) {
  const [kind, place, who] = String(actionId).split(":");
  if (kind === "shop_stall") return topStall(state, place);
  if (kind === "shop_store") return leaseStore(state, place);
  if (kind === "shop_vend") return createShopVend(state, place, who);
  return { ok: false, message: "没有这项铺摊生意。" };
}

export function settleShopAction(state, action) {
  if (action.businessKind !== "shop_vend") return { message: "铺摊生意无事发生。" };
  return finishShopVend(state, action.placeType, action.byStaff);
}

export function dailyShopSettlement(state, dateParts) {
  const shop = ensureShop(state.player);
  const dateKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  if (shop.lastDailyKey === dateKey) return [];
  shop.lastDailyKey = dateKey;
  const messages = [];
  [shop.stall, shop.store].forEach((place) => {
    if (!place.active) return;
    const risk = hasStaffLodging(state.player) ? 0.01 : hasItem(state.player, "铁锁木柜") ? 0.03 : 0.08;
    if (Math.random() < risk) {
      const loss = stealStock(state.player.business, place.industryId);
      if (loss > 0) messages.push(`${place.brand}夜间失窃，少了${loss}件/挑货。`);
    }
  });
  return messages;
}

export function monthlyShopSettlement(state, dateParts) {
  const shop = ensureShop(state.player);
  const monthKey = `${dateParts.year}-${dateParts.month}`;
  if (shop.lastMonthlyKey === monthKey) return [];
  shop.lastMonthlyKey = monthKey;
  const messages = [];
  if (shop.stall.active) {
    if (state.player.coins >= STALL_MONTHLY_DUE) {
      state.player.coins -= STALL_MONTHLY_DUE;
      state.player.business.periodProfit -= STALL_MONTHLY_DUE;
      messages.push(`${shop.stall.brand}本月例钱${STALL_MONTHLY_DUE}文已交。`);
      shop.stall.arrears = 0;
    } else {
      shop.stall.arrears += 1;
      messages.push(`${shop.stall.brand}例钱拖欠，地面/街司来催。`);
      if (shop.stall.arrears >= 1) {
        messages.push(`${shop.stall.brand}被驱赶，固定摊位丢了。`);
        shop.stall = normalizePlace({}, "stall");
      }
    }
  }
  if (shop.store.active) {
    const rent = STORE_RENT[shop.store.locationId] ?? 1200;
    if (state.player.coins >= rent) {
      state.player.coins -= rent;
      state.player.business.periodProfit -= rent;
      shop.store.arrears = 0;
      messages.push(`${shop.store.brand}月租${rent}文已付。`);
    } else {
      shop.store.arrears += 1;
      messages.push(`${shop.store.brand}月租拖欠，租契违约款压在押金里。`);
      if (shop.store.arrears >= 2) {
        messages.push(`${shop.store.brand}租契毁约，押金不退，铺面收回。`);
        shop.store = normalizePlace({}, "store");
      }
    }
  }
  return messages;
}

export function getShopLedgerLines(player) {
  const shop = ensureShop(player);
  const lines = [];
  lines.push(`固定摊：${shop.stall.active ? `${shop.stall.brand}（${shop.stall.locationId}，月例${STALL_MONTHLY_DUE}文，欠${shop.stall.arrears}月）` : "无"}`);
  lines.push(`铺面：${shop.store.active ? `${shop.store.brand}（${shop.store.locationId}，月租${STORE_RENT[shop.store.locationId] ?? 1200}文，押金${shop.store.deposit}文）` : "无"}`);
  if (shop.lossReport.length) lines.push(`铺摊损耗：${shop.lossReport.join("；")}`);
  return lines;
}

export function getShopContext(state) {
  const shop = ensureShop(state.player);
  const notes = [];
  if (shop.stall.active) notes.push(`固定摊字号${shop.stall.brand}在${shop.stall.locationId}`);
  if (shop.store.active) notes.push(`铺面字号${shop.store.brand}在${shop.store.locationId}，租契有违约款`);
  return notes.length ? `铺摊：${notes.join("；")}。${shop.brandRumors.length ? `风闻：${shop.brandRumors.slice(-2).join("；")}` : ""}` : "铺摊：无固定摊铺。";
}

function topStall(state, industryId) {
  const gate = canTopStall(state, industryId);
  if (!gate.ok) return { ok: false, message: gate.reason };
  const brand = askBrand("给固定摊起个字号", `${getIndustry(industryId).name.replace(/[（(].*?[）)]/g, "")}小摊`);
  state.player.coins -= STALL_TOP_FEE + STALL_BROKER_FEE;
  state.player.business.periodProfit -= STALL_TOP_FEE + STALL_BROKER_FEE;
  const shop = ensureShop(state.player);
  shop.stall = { active: true, kind: "stall", industryId, locationId: state.player.location, brand, arrears: 0, openedDay: dayOrdinal(getDateParts(state.clock)), deposit: 0 };
  shop.brandRumors.push(`${brand}挂幌开张，街坊开始拿字号说你的商誉。`);
  shop.brandRumors = shop.brandRumors.slice(-6);
  state.player.identity = "摊主";
  return { ok: true, message: `经牙人撮合，花顶费${STALL_TOP_FEE}文、中费${STALL_BROKER_FEE}文，盘下${brand}。身份变为摊主。`, transition: { from: "行贩", to: "摊主", reason: `盘下${state.player.location}固定摊${brand}，有字号有月例钱。`, maxChars: 420 } };
}

function leaseStore(state, industryId) {
  const gate = canLeaseStore(state, industryId);
  if (!gate.ok) return { ok: false, message: gate.reason };
  const rent = STORE_RENT[state.player.location] ?? 1200;
  const total = STORE_DEPOSIT + rent + STORE_BROKER_FEE;
  const brand = askBrand("给铺面起个字号", `${getIndustry(industryId).name.replace(/[（(].*?[）)]/g, "")}铺`);
  state.player.coins -= total;
  state.player.business.periodProfit -= total;
  const shop = ensureShop(state.player);
  shop.store = { active: true, kind: "store", industryId, locationId: state.player.location, brand, arrears: 0, openedDay: dayOrdinal(getDateParts(state.clock)), deposit: STORE_DEPOSIT };
  shop.brandRumors.push(`${brand}立了租契，违约不退押金，清河坊/御街都有人记住这块招牌。`);
  shop.brandRumors = shop.brandRumors.slice(-6);
  state.player.identity = "铺主";
  return { ok: true, message: `牙人代立铺租契，押金${STORE_DEPOSIT}文、首月租${rent}文、中费${STORE_BROKER_FEE}文。${brand}开业，身份变为铺主。`, transition: { from: state.player.identity === "铺主" ? "铺主" : "摊主", to: "铺主", reason: `${brand}立下铺租契，押金与违约条款俱全，成为有铺面的人。`, maxChars: 520 } };
}

function createShopVend(state, placeType, who) {
  const shop = ensureShop(state.player);
  const place = placeType === "store" ? shop.store : shop.stall;
  if (!place.active) return { ok: false, message: "还没有这处摊铺。" };
  if (state.player.location !== place.locationId) return { ok: false, message: "须到自家摊铺所在地点。" };
  if (getStockQty(state.player.business, place.industryId) <= 0) return { ok: false, message: "无货可卖。" };
  const byStaff = who === "staff";
  const minutes = placeType === "store" ? 360 : 180;
  if (!byStaff) state.player.stamina = Math.max(0, state.player.stamina - (placeType === "store" ? 20 : 8));
  return { ok: true, action: { type: "business", label: byStaff ? `雇工代守${placeType === "store" ? "铺" : "摊"}` : `守${place.brand}`, businessKind: "shop_vend", placeType, byStaff, remainingMinutes: minutes } };
}

function finishShopVend(state, placeType, byStaff) {
  const shop = ensureShop(state.player);
  const place = placeType === "store" ? shop.store : shop.stall;
  const industry = getIndustry(place.industryId);
  const qty = getStockQty(state.player.business, place.industryId);
  const skillFactor = byStaff ? 0.8 + (getBestStaffSkill(state.player) * 0.7) / 100 : getProficiencyBand(state.player.business.proficiency[place.industryId]).factor;
  const traffic = getBaseTraffic(place.locationId) * (placeType === "stall" ? 1.3 : 1.45);
  const crowd = 1 + getCrowding(state.world, place.locationId, place.industryId) / 100;
  const rate = Math.max(0.1, Math.min(1, traffic * skillFactor * (0.9 + Math.random() * 0.25) / crowd));
  const sold = Math.max(1, Math.min(qty, Math.floor(qty * rate)));
  const taken = takeStock(state.player.business, place.industryId, sold);
  const unitPrice = Math.max(1, Math.round(taken.costPerUnit * (1 + industry.baseMargin) * taken.quality * (placeType === "store" ? 1.25 : 1.05)));
  const income = sold * unitPrice;
  state.player.coins += income;
  state.player.business.periodProfit += income;
  state.player.business.reputation = Math.min(100, state.player.business.reputation + (placeType === "store" ? 2 : 1));
  state.player.business.regulars[place.industryId] = Math.min(100, (state.player.business.regulars[place.industryId] ?? 0) + (placeType === "store" ? 4 : 3));
  let extra = "";
  if (placeType === "store") {
    if ((state.player.skills?.suan ?? 0) >= 50) extra = " 打烊盘账清楚，杂项损耗省下一笔。";
    else {
      const leak = Math.min(income, randomInt(10, 45));
      state.player.coins -= leak;
      state.player.business.periodProfit -= leak;
      extra = ` 打烊盘账不细，杂项损耗${leak}文。`;
    }
  }
  return { message: `${place.brand}${byStaff ? "由雇工代守" : "开张"}${placeType === "store" ? "六" : "三"}小时，卖出${sold}${industry.unitName}，收入${income}文，余货${getStockQty(state.player.business, place.industryId)}。${extra}`, story: "" };
}

function canTopStall(state, industryId) {
  if (!STALL_LOCATIONS.has(state.player.location)) return { ok: false, reason: "地点限瓦子/城隍庙/清河坊" };
  if (state.player.identity !== "行贩") return { ok: false, reason: "需行贩身份" };
  if ((state.player.business.proficiency?.[industryId] ?? 0) < 40) return { ok: false, reason: "本行熟练需≥40" };
  if (state.player.coins < STALL_TOP_FEE + STALL_BROKER_FEE) return { ok: false, reason: `需${STALL_TOP_FEE + STALL_BROKER_FEE}文` };
  return { ok: true };
}

function canLeaseStore(state, industryId) {
  if (!STORE_LOCATIONS.has(state.player.location)) return { ok: false, reason: "铺面限清河坊/御街" };
  if (!isGuildMember(state.player, industryId)) return { ok: false, reason: "需本行行会成员" };
  const total = STORE_DEPOSIT + (STORE_RENT[state.player.location] ?? 1200) + STORE_BROKER_FEE;
  if (state.player.coins < total) return { ok: false, reason: `需${total}文` };
  return { ok: true };
}

function ensureShop(player) {
  player.business.shop = normalizeShopState(player.business?.shop);
  return player.business.shop;
}

function normalizePlace(place = {}, kind) {
  return {
    active: Boolean(place.active),
    kind,
    industryId: typeof place.industryId === "string" ? place.industryId : "",
    locationId: typeof place.locationId === "string" ? place.locationId : "",
    brand: typeof place.brand === "string" && place.brand.trim() ? place.brand.slice(0, 20) : (kind === "store" ? "无名铺" : "无名摊"),
    arrears: Number.isFinite(place.arrears) ? Math.max(0, Math.floor(place.arrears)) : 0,
    openedDay: Number.isFinite(place.openedDay) ? Math.max(0, Math.floor(place.openedDay)) : 0,
    deposit: Number.isFinite(place.deposit) ? Math.max(0, Math.floor(place.deposit)) : 0,
  };
}

function bestIndustry(player) {
  const active = player.business?.activeIndustryId;
  if (active) return active;
  return INDUSTRIES.slice().sort((a, b) => (player.business?.proficiency?.[b.id] ?? 0) - (player.business?.proficiency?.[a.id] ?? 0))[0]?.id ?? "";
}
function askBrand(prompt, fallback) { return (((typeof window !== "undefined" && window.prompt ? window.prompt(prompt, fallback)?.trim() : "") || fallback)).slice(0, 20); }
function getBaseTraffic(locationId) { return ({ city_god_temple: 0.85, wazi: 0.9, qinghefang: 1.05, imperial_street: 1.15 }[locationId] ?? 0.65); }
function stealStock(business, industryId) { const qty = getStockQty(business, industryId); const loss = Math.min(qty, Math.max(1, Math.floor(qty * 0.2))); takeStock(business, industryId, loss); return loss; }
function getStockQty(business, industryId) { return (business.stock ?? []).filter((stock) => stock.industryId === industryId).reduce((sum, stock) => sum + stock.qty, 0); }
function takeStock(business, industryId, qty) {
  let remaining = qty; let takenQty = 0; let totalCost = 0; let totalQuality = 0;
  business.stock.forEach((stock) => {
    if (stock.industryId !== industryId || remaining <= 0) return;
    const n = Math.min(stock.qty, remaining); stock.qty -= n; remaining -= n; takenQty += n; totalCost += n * stock.costPerUnit; totalQuality += n * stock.quality;
  });
  business.stock = business.stock.filter((stock) => stock.qty > 0);
  return { qty: takenQty, costPerUnit: takenQty ? totalCost / takenQty : 0, quality: takenQty ? totalQuality / takenQty : 1 };
}
function dayOrdinal(parts) { return (parts.year - 1) * 360 + (parts.month - 1) * 30 + parts.day; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
