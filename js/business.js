import { getDateParts, getMinuteOfDay, getPeriod } from "./clock.js";
import { addCoins, changeSatiety, changeStamina, spendCoins } from "./player.js";
import { getIndustry, INDUSTRIES, getProficiencyBand } from "./industries.js";
import { changeSupplierRelation, getRelationPriceFactor, getRelationPriceName, getSupplierCard, normalizeSuppliers } from "./suppliers.js";
import { changeRivalRelation, describeRivalContext, getCrowding, getRivalForIndustry, getRivalSellFactor } from "./rivals.js";
import { isNightMarket } from "./festival.js";
import { hasItem } from "./items.js";
import { createShopAction, dailyShopSettlement, getShopActions, getShopContext, getShopLedgerLines, monthlyShopSettlement, normalizeShopState, settleShopAction } from "./shop.js";
import { createGuildAction, getGuildActions, getGuildContext, getGuildLedgerLines, getGuildSupplyRelationFloor, isGuildMember, isPriceModeAllowed, monthlyGuildSettlement, normalizeGuildState, recordPriceViolation } from "./guild.js";
import { createStaffAction, dailyStaffSettlement, getStaffActions, getStaffContext, getStaffLedgerLines, monthlyStaffSettlement, normalizeStaffState } from "./staff.js";

export function normalizeBusinessState(saved = {}) {
  saved = saved && typeof saved === "object" ? saved : {};
  return {
    reputation: clamp(saved.reputation ?? 40),
    activeIndustryId: typeof saved.activeIndustryId === "string" ? saved.activeIndustryId : "",
    proficiency: Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, clamp(saved.proficiency?.[industry.id] ?? 0)])),
    regulars: Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, clamp(saved.regulars?.[industry.id] ?? 0)])),
    stock: Array.isArray(saved.stock) ? saved.stock.map(normalizeStock).filter(Boolean) : [],
    receivables: Array.isArray(saved.receivables) ? saved.receivables.map(normalizeReceivable).filter(Boolean) : [],
    periodProfit: Number.isFinite(saved.periodProfit) ? Math.round(saved.periodProfit) : 0,
    standStreak: Number.isFinite(saved.standStreak) ? Math.max(0, Math.floor(saved.standStreak)) : 0,
    lastStandIndustryId: typeof saved.lastStandIndustryId === "string" ? saved.lastStandIndustryId : "",
    pressureCounts: saved.pressureCounts && typeof saved.pressureCounts === "object" ? saved.pressureCounts : {},
    suppliers: normalizeSuppliers(saved.suppliers),
    pendingScamTag: typeof saved.pendingScamTag === "string" ? saved.pendingScamTag : "",
    shop: normalizeShopState(saved.shop),
    guild: normalizeGuildState(saved.guild),
    staff: normalizeStaffState(saved.staff),
  };
}

export function getBusinessActions(state) {
  ensureBusiness(state.player);
  const actions = [];
  INDUSTRIES.forEach((industry) => {
    const hasTool = hasItem(state.player, industry.tool.name);
    const stockQty = getStockQty(state.player.business, industry.id);
    actions.push(...getPurchaseActionsForIndustry(state, industry, hasTool));
    if (industry.make.enabled) {
      const rawQty = getStockQty(state.player.business, `${industry.id}_raw`);
      actions.push({
        id: `make:${industry.id}`,
        name: `制作${industry.unitName}`,
        description: `${industry.make.minutes / 60}小时 · 体力-${industry.make.stamina} · 原料${rawQty}/${industry.unitsPerBatch}`,
        available: hasTool && rawQty > 0 && state.player.stamina >= industry.make.stamina,
        reason: !hasTool ? `需${industry.tool.name}` : rawQty <= 0 ? "需先进原料" : `体力需${industry.make.stamina}`,
      });
    }
    ["low", "fair", "high"].forEach((priceMode) => {
      const label = priceMode === "low" ? "压价" : priceMode === "high" ? "抬价" : "平价";
      const priceAllowed = isPriceModeAllowed(state.player, industry.id, priceMode);
      actions.push({
        id: `vend:${industry.id}:${priceMode}`,
        name: `出摊·${industry.name}·${label}`,
        description: `3小时 · 体力-18 · 存货${stockQty}`,
        available: hasTool && stockQty > 0 && state.player.stamina >= 18 && priceAllowed,
        reason: !priceAllowed ? "行会禁压价" : !hasTool ? `需${industry.tool.name}` : stockQty <= 0 ? "无可卖存货" : "体力不足",
      });
    });
  });
  actions.push(...getShopActions(state));
  actions.push(...getGuildActions(state));
  actions.push(...getStaffActions(state));
  actions.push({
    id: "collect_debts",
    name: "到期收账",
    description: `${getDueReceivables(state).length}笔到期 · 谈判定，可武收`,
    available: getDueReceivables(state).length > 0,
    reason: "暂无到期赊账",
  });
  return actions;
}

export function createBusinessAction(actionId, state) {
  ensureBusiness(state.player);
  const [kind, industryId, extra] = String(actionId).split(":");
  if (kind === "shop_stall" || kind === "shop_store" || kind === "shop_vend") return createShopAction(actionId, state);
  if (kind === "guild_join") return createGuildAction(actionId, state);
  if (kind === "staff_hire") return createStaffAction(actionId, state);
  if (kind === "buy" && extra === "street_collect") return createStreetCollectAction(state, industryId);
  if (kind === "buy") return buyStock(state, industryId, extra);
  if (kind === "make") return createTimedAction(state, industryId, "make");
  if (kind === "vend") return createTimedAction(state, industryId, "vend", extra);
  if (kind === "collect_debts") return collectDebts(state);
  return { ok: false, message: "没有这门生意。" };
}

export function settleBusinessAction(state, action) {
  ensureBusiness(state.player);
  if (action.businessKind === "shop_vend") return settleShopAction(state, action);
  if (action.businessKind === "make") return finishMake(state, action.industryId);
  if (action.businessKind === "street_collect") return finishStreetCollect(state, action.industryId, action.cost);
  if (action.businessKind === "vend") return finishVend(state, action.industryId, action.priceMode, action.locationId);
  return { message: "生意草草收场。", story: "" };
}

export function dailyBusinessSettlement(player, dateParts) {
  ensureBusiness(player);
  const today = dayOrdinal(dateParts);
  const messages = [];
  player.business.stock.forEach((stock) => {
    const age = today - (stock.acquiredDay ?? today);
    if (stock.industryId === "fresh_fish_veg" && age >= 1 && stock.qty > 0) {
      messages.push(`昨日剩下的鱼鲜果蔬坏尽，折了${stock.qty}挑。`);
      stock.qty = 0;
    }
  });
  player.business.stock = player.business.stock.filter((stock) => stock.qty > 0);
  return messages;
}

export function dailyBusinessExtendedSettlement(state, dateParts) {
  return [
    ...dailyBusinessSettlement(state.player, dateParts),
    ...dailyShopSettlement(state, dateParts),
    ...dailyStaffSettlement(state, dateParts),
  ];
}

export function monthlyBusinessSettlement(state, dateParts) {
  return [
    ...monthlyShopSettlement(state, dateParts),
    ...monthlyGuildSettlement(state, dateParts),
    ...monthlyStaffSettlement(state, dateParts),
  ];
}

export function getBusinessLedger(state) {
  ensureBusiness(state.player);
  const lines = [];
  lines.push(`商誉：${describeReputation(state.player.business.reputation)}`);
  INDUSTRIES.forEach((industry) => {
    const p = state.player.business.proficiency[industry.id] ?? 0;
    lines.push(`${industry.name}熟练：${getProficiencyBand(p).text}（${p}/100），回头客${state.player.business.regulars[industry.id] ?? 0}/100，存货${getStockQty(state.player.business, industry.id)}。`);
  });
  const receivables = state.player.business.receivables.filter((debt) => !debt.settled);
  lines.push(`应收：${receivables.length ? receivables.map((debt) => `${debt.amount}文/${debt.dueDay}日/${debt.contract ? "有契" : "口约"}/${debt.desc}`).join("；") : "无"}`);
  lines.push(...getShopLedgerLines(state.player));
  lines.push(...getGuildLedgerLines(state.player));
  lines.push(...getStaffLedgerLines(state.player));
  lines.push(`本期损益：${state.player.business.periodProfit}文。`);
  return lines;
}

export function getBusinessContext(state) {
  ensureBusiness(state.player);
  const industryId = state.player.business.activeIndustryId;
  const industry = getIndustry(industryId);
  const base = !industry
    ? `商路：未入行；商誉${describeReputation(state.player.business.reputation)}。`
    : `商路：${industry.name}；商誉${describeReputation(state.player.business.reputation)}；熟练${getProficiencyBand(state.player.business.proficiency[industryId]).text}；回头客${state.player.business.regulars[industryId]}/100；同行：${describeRivalContext(state.world, industryId)}`;
  return `${base}；${getShopContext(state)}；${getGuildContext(state)}；${getStaffContext(state.player)}`;
}

function getPurchaseActionsForIndustry(state, industry, hasTool) {
  const minute = getMinuteOfDay(state.clock);
  const period = getPeriod(minute);
  const actions = [];
  const loc = state.player.location;
  const business = state.player.business;
  if (industry.id === "cooked_cake") {
    actions.push(channelAction("sun_regular", industry, loc === "rice_market", state, "孙老倌正规原料"));
    actions.push(channelAction("zhou_transfer", industry, loc === "south_homes" && getZhouFavor(state) >= 40, state, "周大娘转批小料"));
    actions.push(channelAction("private_salt", industry, loc === "slum_alley", state, "刘麻子私盐省成本"));
  } else if (industry.id === "fresh_fish_veg") {
    actions.push(channelAction("feng_regular", industry, loc === "dock", state, "冯行老正规鱼行"));
    actions.push(channelAction("morning_market", industry, loc === "morning_gate_market" && minute >= 360, state, minute < 540 ? "晨市直收头水货" : "晨市烂叶残货"));
    actions.push(channelAction("night_boat", industry, loc === "dock" && period === "夜", state, "码头夜船便宜货"));
  } else if (industry.id === "used_clothes") {
    actions.push(channelAction("bai_regular", industry, loc === "qinghefang", state, "白掌柜批货"));
    actions.push({ id: `buy:${industry.id}:street_collect`, name: `进货·${industry.name}·沿街收旧`, description: "2小时 · 算≥35六成好货", available: hasTool, reason: `需${industry.tool.name}`, cost: quoteCost(state, industry, "street_collect") });
    actions.push(channelAction("qian_stolen", industry, getQianFavor(state) >= 30, state, "钱团头赃衣半价"));
  }
  return actions.map((action) => ({ ...action, available: action.available && state.player.coins >= action.cost, reason: state.player.coins < action.cost ? `需${action.cost}文` : action.reason })).map((action) => ({ ...action, description: `${action.description} · ${action.cost}文${business.activeIndustryId && business.activeIndustryId !== industry.id ? " · 换行清回头客" : ""}` }));
}

function channelAction(channelId, industry, available, state, label) {
  const cost = quoteCost(state, industry, channelId);
  return { id: `buy:${industry.id}:${channelId}`, name: `进货·${industry.name}·${label}`, description: "一批", available, reason: "地点/时辰/关系未合", cost };
}

function createStreetCollectAction(state, industryId) {
  const industry = getIndustry(industryId);
  if (!industry || industry.id !== "used_clothes") return { ok: false, message: "只有估衣贩可沿街收旧。" };
  if (!hasItem(state.player, industry.tool.name)) return { ok: false, message: `需先置办${industry.tool.name}。` };
  const cost = quoteCost(state, industry, "street_collect");
  if (!spendCoins(state.player, cost)) return { ok: false, message: `收旧需预备${cost}文。` };
  setActiveIndustry(state.player.business, industryId);
  state.player.business.periodProfit -= cost;
  return { ok: true, action: { type: "business", label: "沿街收旧", businessKind: "street_collect", industryId, cost, remainingMinutes: 120 } };
}

function finishStreetCollect(state, industryId, cost) {
  const industry = getIndustry(industryId);
  const quality = getChannelQuality(state, "street_collect");
  addStock(state.player.business, { industryId, name: industry.unitName, qty: industry.unitsPerBatch, quality, costPerUnit: cost / industry.unitsPerBatch, acquiredDay: dayOrdinal(getDateParts(state.clock)) });
  gainProficiency(state.player.business, industryId, 1);
  return { message: `沿街问了两小时旧衣，收得${industry.unitsPerBatch}${industry.unitName}，货色${qualityText(quality)}。`, story: "" };
}

function buyStock(state, industryId, channelId) {
  const industry = getIndustry(industryId);
  if (!industry) return { ok: false, message: "没有这个行当。" };
  const action = getPurchaseActionsForIndustry(state, industry, hasItem(state.player, industry.tool.name)).find((item) => item.id === `buy:${industryId}:${channelId}`);
  if (!action?.available) return { ok: false, message: action?.reason ?? "此刻进不到这批货。" };
  if (!spendCoins(state.player, action.cost)) return { ok: false, message: `进货需${action.cost}文。` };
  setActiveIndustry(state.player.business, industryId);
  const today = dayOrdinal(getDateParts(state.clock));
  const quality = getChannelQuality(state, channelId);
  const targetIndustry = industry.make.enabled ? `${industryId}_raw` : industryId;
  const units = channelId === "morning_market" && getMinuteOfDay(state.clock) >= 540 ? Math.max(1, Math.floor(industry.unitsPerBatch / 2)) : industry.unitsPerBatch;
  addStock(state.player.business, { industryId: targetIndustry, name: industry.make.enabled ? `${industry.unitName}原料` : industry.unitName, qty: units, quality, costPerUnit: action.cost / units, acquiredDay: today });
  gainProficiency(state.player.business, industryId, channelId === "zhou_transfer" ? 2 : 1);
  state.player.business.periodProfit -= action.cost;
  applyChannelSideEffects(state, industry, channelId);
  return { ok: true, message: `进得${industry.name}一批，花${action.cost}文，货色${qualityText(quality)}。` };
}

function createTimedAction(state, industryId, kind, priceMode = "") {
  const industry = getIndustry(industryId);
  if (!industry) return { ok: false, message: "没有这个行当。" };
  const hasTool = hasItem(state.player, industry.tool.name);
  if (!hasTool) return { ok: false, message: `需先置办${industry.tool.name}。` };
  if (kind === "make") {
    if (!industry.make.enabled) return { ok: false, message: "此行当不用制作。" };
    if (getStockQty(state.player.business, `${industryId}_raw`) <= 0) return { ok: false, message: "没有原料可做。" };
    if (state.player.stamina < industry.make.stamina) return { ok: false, message: "体力不足。" };
    changeStamina(state.player, -industry.make.stamina);
    return { ok: true, action: { type: "business", label: `制作${industry.unitName}`, businessKind: "make", industryId, remainingMinutes: industry.make.minutes } };
  }
  if (!isPriceModeAllowed(state.player, industryId, priceMode)) return { ok: false, message: "已入行会，行规禁压价。" };
  if (getStockQty(state.player.business, industryId) <= 0) return { ok: false, message: "无货可卖。" };
  if (state.player.stamina < 18) return { ok: false, message: "体力不足，出摊需18体力。" };
  changeStamina(state.player, -18);
  setActiveIndustry(state.player.business, industryId);
  if (!["行贩", "摊主", "铺主"].includes(state.player.identity)) state.player.identity = "行贩";
  return { ok: true, action: { type: "business", label: `出摊卖${industry.unitName}`, businessKind: "vend", industryId, priceMode, locationId: state.player.location, remainingMinutes: 180 } };
}

function finishMake(state, industryId) {
  const industry = getIndustry(industryId);
  const raw = takeStock(state.player.business, `${industryId}_raw`, industry.unitsPerBatch);
  if (raw.qty <= 0) return { message: "原料不够，炉火白生。" };
  addStock(state.player.business, { industryId, name: industry.unitName, qty: raw.qty, quality: raw.quality, costPerUnit: raw.costPerUnit, acquiredDay: dayOrdinal(getDateParts(state.clock)) });
  gainProficiency(state.player.business, industryId, 2);
  return { message: `担炉边蒸烤一阵，做成${raw.qty}${industry.unitName}，香气随巷子散开。`, story: "" };
}

function finishVend(state, industryId, priceMode, locationId) {
  const industry = getIndustry(industryId);
  const business = state.player.business;
  const stockQty = getStockQty(business, industryId);
  const crowding = getCrowding(state.world, locationId, industryId);
  const rate = Math.max(0.05, Math.min(1, getFootTraffic(locationId) * getPriceFactor(priceMode) * getReputationFactor(business.reputation) * getProficiencyBand(business.proficiency[industryId]).factor * getRegularFloorFactor(business.regulars[industryId]) * getRivalSellFactor(state.world, state.player, industryId) * getFestivalFactor(state, locationId) * (0.75 + Math.random() * 0.5) / (1 + crowding / 100)));
  const sold = Math.max(1, Math.min(stockQty, Math.floor(stockQty * Math.max(rate, getRegularFloor(business, industryId)))));
  const taken = takeStock(business, industryId, sold);
  const unitPrice = Math.max(1, Math.round(taken.costPerUnit * (1 + industry.baseMargin) * getUnitPriceMarkup(priceMode) * taken.quality));
  let income = sold * unitPrice;
  let extra = "";
  const minute = getMinuteOfDay(state.clock);
  if (["imperial_street", "qinghefang"].includes(locationId) && !isGuildMember(state.player, industryId) && Math.random() < 0.15) {
    income = Math.floor(income / 2);
    business.streetOfficeCooldowns = business.streetOfficeCooldowns ?? {};
    business.streetOfficeCooldowns[locationId] = dayOrdinal(getDateParts(state.clock)) + 2;
    extra += " 街司来驱占道，本场收入折半，下回两日内不宜再来。";
  }
  addCoins(state.player, income);
  business.periodProfit += income;
  gainProficiency(business, industryId, 2);
  updateReputation(business, priceMode === "fair" ? 1 : priceMode === "high" ? -1 : 0);
  updateRegulars(business, industryId, priceMode === "fair" ? 2 : priceMode === "low" ? 1 : -1);
  maybeCreditSale(state, industry, income);
  if (priceMode === "low") extra += recordPriceViolation(state.player, industryId);
  maybeRivalConflict(state, industryId, priceMode, locationId);
  settleUnsoldAfterVend(state, industry);
  const eventText = Math.random() < 0.15 ? randomStandEvent(business, industry) : "";
  return { message: `出摊三小时，卖出${sold}${industry.unitName}，收入${income}文，余货${getStockQty(business, industryId)}。${extra}${eventText}`, story: eventText };
}

function collectDebts(state) {
  const due = getDueReceivables(state);
  if (due.length === 0) return { ok: false, message: "暂无到期赊账。" };
  let received = 0;
  let bad = 0;
  due.forEach((debt) => {
    const tan = state.player.skills?.tan ?? 0;
    let chance = tan >= 40 ? 0.7 : 0.4;
    if (debt.contract) chance += 0.25;
    if (Math.random() < Math.min(0.95, chance)) {
      const amount = debt.contract ? Math.round(debt.amount * 1.5) : debt.amount;
      received += amount;
      debt.settled = true;
      return;
    }
    const wu = state.player.skills?.wu ?? 0;
    if (wu >= 35 && Math.random() < 0.8) {
      received += debt.amount;
      debt.settled = true;
      updateReputation(state.player.business, -5);
      state.player.officialRisk = (state.player.officialRisk ?? 0) + 3;
    } else {
      bad += debt.amount;
      debt.settled = true;
    }
  });
  addCoins(state.player, received);
  state.player.business.periodProfit += received;
  return { ok: true, message: `收账回来${received}文，坏账核销${bad}文。` };
}

export function getDueReceivables(state) {
  ensureBusiness(state.player);
  const today = dayOrdinal(getDateParts(state.clock));
  return state.player.business.receivables.filter((debt) => !debt.settled && debt.dueOrdinal <= today);
}

function maybeCreditSale(state, industry, income) {
  if (income <= 0 || Math.random() >= 0.18) return;
  const amount = randomInt(10, 60);
  if (getReceivableTotal(state.player.business) + amount > getCreditLimit(state.player)) return;
  const customer = ["挑柴汉说家中小儿发热，明日结钱", "洗衣妇称等主家付工钱便还", "脚夫摸着腰间空绳，说船钱傍晚才到", "小食肆学徒低声央一日宽限"][randomInt(0, 3)];
  const allowed = window.confirm(`赊账请求：${customer}。赊${amount}文？`);
  if (!allowed) return;
  const contract = amount >= 40 && hasItem(state.player, "笔墨");
  state.player.business.receivables.push({ amount, dueOrdinal: dayOrdinal(getDateParts(state.clock)) + randomInt(5, 15), dueDay: `第${getDateParts(state.clock).year}年后约${randomInt(5, 15)}日`, desc: customer, contract, industryId: industry.id, settled: false });
  state.player.business.periodProfit -= amount;
}

function applyChannelSideEffects(state, industry, channelId) {
  if (channelId === "sun_regular") changeSupplierRelation(state.player, "sun_laoguan", 3, "又买一批面油盐。 ");
  if (channelId === "feng_regular") changeSupplierRelation(state.player, "feng_hanglao", 2, "按行规进了一担鱼鲜。 ");
  if (channelId === "bai_regular") changeSupplierRelation(state.player, "bai_zhanggui", 2, "现钱批走一包旧衣。 ");
  if (channelId === "morning_market") state.player.labor = { ...(state.player.labor ?? {}), strain: (state.player.labor?.strain ?? 0) + 1 };
  if (channelId === "private_salt" && Math.random() < 0.08) { state.player.officialRisk = (state.player.officialRisk ?? 0) + 15; state.player.business.pendingScamTag = "private_salt"; state.player.business.stock = state.player.business.stock.filter((stock) => stock.industryId !== `${industry.id}_raw`); }
  if (channelId === "night_boat" && Math.random() < 0.12) { state.player.officialRisk = (state.player.officialRisk ?? 0) + 8; state.player.business.pendingScamTag = "night_boat"; state.player.business.stock = state.player.business.stock.filter((stock) => stock.industryId !== industry.id); }
  if (channelId === "qian_stolen" && Math.random() < 0.06 * industry.unitsPerBatch) { updateReputation(state.player.business, -15); state.player.officialRisk = (state.player.officialRisk ?? 0) + 5; state.player.business.pendingScamTag = "stolen_clothes"; }
}

function quoteCost(state, industry, channelId) {
  const base = randomInt(industry.batchCostRange[0], industry.batchCostRange[1]);
  let factor = 1;
  if (channelId === "sun_regular") factor = getRelationPriceFactor(getGuildSupplyRelationFloor(state.player, industry.id, state.player.business?.suppliers?.sun_laoguan?.relation ?? 25));
  if (channelId === "feng_regular") factor = getRelationPriceFactor(getGuildSupplyRelationFloor(state.player, industry.id, state.player.business?.suppliers?.feng_hanglao?.relation ?? 25));
  if (channelId === "bai_regular") factor = getRelationPriceFactor(getGuildSupplyRelationFloor(state.player, industry.id, state.player.business?.suppliers?.bai_zhanggui?.relation ?? 25));
  if (channelId === "zhou_transfer") factor = 0.88;
  if (channelId === "private_salt") factor = 0.82;
  if (channelId === "morning_market") factor = getMinuteOfDay(state.clock) >= 540 ? 0.85 : 0.7;
  if (channelId === "night_boat") factor = 0.7;
  if (channelId === "street_collect") factor = 0.65;
  if (channelId === "qian_stolen") factor = 0.5;
  return Math.max(1, Math.round(base * factor));
}

function getChannelQuality(state, channelId) {
  if (channelId === "street_collect") return (state.player.skills?.suan ?? 0) >= 35 ? (Math.random() < 0.6 ? 1.15 : 0.85) : (Math.random() < 0.4 ? 1.1 : 0.75);
  if (channelId === "morning_market" && getMinuteOfDay(state.clock) >= 540) return 0.55;
  if (["private_salt", "qian_stolen"].includes(channelId)) return 0.9;
  return 1;
}

function settleUnsoldAfterVend(state, industry) {
  if (industry.id === "cooked_cake" && getPeriod(getMinuteOfDay(state.clock)) === "暮" && getStockQty(state.player.business, industry.id) > 0) {
    const left = takeStock(state.player.business, industry.id, getStockQty(state.player.business, industry.id));
    if (Math.random() < 0.5) {
      const coins = Math.round(left.qty * left.costPerUnit * 0.5);
      addCoins(state.player, coins);
      state.player.business.periodProfit += coins;
    } else {
      changeSatiety(state.player, Math.min(20, left.qty * 2));
    }
  }
}

function maybeRivalConflict(state, industryId, priceMode, locationId) {
  const rival = getRivalForIndustry(industryId);
  if (!rival) return;
  if (priceMode === "low") {
    const counts = state.player.business.pressureCounts;
    counts[industryId] = (counts[industryId] ?? 0) + 1;
    if (counts[industryId] >= 3) {
      changeRivalRelation(state.world, rival.id, -10);
      updateReputation(state.player.business, rival.id === "miu_pozi" ? -8 : -3);
      counts[industryId] = 0;
    }
  }
  if (getCrowding(state.world, locationId, industryId) > 70 && Math.random() < 0.15) changeRivalRelation(state.world, rival.id, -3);
}

function setActiveIndustry(business, industryId) {
  if (business.activeIndustryId && business.activeIndustryId !== industryId) business.regulars[business.activeIndustryId] = 0;
  business.activeIndustryId = industryId;
}
function ensureBusiness(player) { player.business = normalizeBusinessState(player.business); }
function gainProficiency(business, industryId, amount) { business.proficiency[industryId] = clamp((business.proficiency[industryId] ?? 0) + amount); }
function updateReputation(business, amount) { business.reputation = clamp((business.reputation ?? 40) + amount); }
function updateRegulars(business, industryId, amount) { business.regulars[industryId] = clamp((business.regulars[industryId] ?? 0) + amount); }
function getStockQty(business, industryId) { return business.stock.filter((stock) => stock.industryId === industryId).reduce((sum, stock) => sum + stock.qty, 0); }
function addStock(business, stock) { business.stock.push(normalizeStock(stock)); }
function takeStock(business, industryId, qty) {
  let remaining = qty; let takenQty = 0; let totalCost = 0; let totalQuality = 0;
  business.stock.forEach((stock) => {
    if (stock.industryId !== industryId || remaining <= 0) return;
    const n = Math.min(stock.qty, remaining); stock.qty -= n; remaining -= n; takenQty += n; totalCost += n * stock.costPerUnit; totalQuality += n * stock.quality;
  });
  business.stock = business.stock.filter((stock) => stock.qty > 0);
  return { qty: takenQty, costPerUnit: takenQty ? totalCost / takenQty : 0, quality: takenQty ? totalQuality / takenQty : 1 };
}
function normalizeStock(stock) {
  if (!stock || typeof stock.industryId !== "string") return null;
  return { industryId: stock.industryId, name: String(stock.name || "货物").slice(0, 20), qty: Math.max(0, Math.floor(stock.qty ?? 0)), quality: Math.max(0.4, Math.min(1.4, Number(stock.quality) || 1)), costPerUnit: Math.max(0, Number(stock.costPerUnit) || 0), acquiredDay: Number.isFinite(stock.acquiredDay) ? stock.acquiredDay : 1 };
}
function normalizeReceivable(debt) {
  if (!debt || !Number.isFinite(debt.amount)) return null;
  return { amount: Math.max(1, Math.round(debt.amount)), dueOrdinal: Number.isFinite(debt.dueOrdinal) ? debt.dueOrdinal : 1, dueDay: String(debt.dueDay || "到期").slice(0, 30), desc: String(debt.desc || "赊账客").slice(0, 60), contract: Boolean(debt.contract), industryId: String(debt.industryId || ""), settled: Boolean(debt.settled) };
}
function getFootTraffic(locationId) { return ({ slum_alley: 0.35, city_god_temple: 0.85, wazi: 0.9, imperial_street: 1.1, qinghefang: 1.05, morning_gate_market: 0.95, dock: 0.7, rice_market: 0.75, south_homes: 0.55, academy: 0.45 }[locationId] ?? 0.5); }
function getPriceFactor(mode) { return mode === "low" ? 1.25 : mode === "high" ? 0.75 : 1; }
function getUnitPriceMarkup(mode) { return mode === "low" ? 0.85 : mode === "high" ? 1.25 : 1; }
function getReputationFactor(rep) { return 0.75 + (rep / 100) * 0.5; }
function getRegularFloor(business, industryId) { return business.reputation > 55 && (business.standStreak ?? 0) >= 2 ? 0.2 : 0; }
function getRegularFloorFactor(value) { return 1 + (value ?? 0) / 250; }
function getFestivalFactor(state, locationId) { return isNightMarket(locationId, getPeriod(getMinuteOfDay(state.clock))) ? 1.35 : 1; }
function describeReputation(value) { if (value < 30) return "坏名在外"; if (value < 55) return "寻常口碑"; if (value < 80) return "公道可信"; return "街坊认脸"; }
function qualityText(value) { if (value < 0.8) return "吃亏"; if (value > 1.05) return "上好"; return "平稳"; }
function randomStandEvent(business, industry) { updateReputation(business, 1); return ` 有个熟客认出你担子，说${industry.unitName}还算公道。`; }
function getReceivableTotal(business) { return business.receivables.filter((d) => !d.settled).reduce((sum, d) => sum + d.amount, 0); }
function getCreditLimit(player) { return Math.floor((player.coins + player.business.stock.reduce((sum, stock) => sum + stock.qty * stock.costPerUnit, 0)) * 0.5); }
function getZhouFavor(state) { return state.npcs.find((npc) => npc.id === "zhou_daniang")?.relation?.favor ?? 0; }
function getQianFavor(state) { return state.npcs.find((npc) => npc.id === "qian_tuantou")?.relation?.favor ?? 0; }
function dayOrdinal(parts) { return (parts.year - 1) * 360 + (parts.month - 1) * 30 + parts.day; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
