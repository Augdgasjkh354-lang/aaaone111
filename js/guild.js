import { INDUSTRIES } from "./industries.js";
import { getRivalForIndustry } from "./rivals.js";

export const GUILDS = [
  { id: "food_guild", industryId: "cooked_cake", name: "饮食行", elder: { id: "guo_hanglao", name: "郭行老", note: "精明持重的新行老" } },
  { id: "fresh_guild", industryId: "fresh_fish_veg", name: "鲜鱼果子行", elder: { id: "feng_hanglao", name: "冯行老", note: "码头鱼行行头兼行老" } },
  { id: "cloth_guild", industryId: "used_clothes", name: "故衣行", elder: { id: "bai_zhanggui", name: "白掌柜", note: "清河坊故衣行东家兼行老" } },
];

export const GUILD_ENTRY_FEE = 2000;
export const GUILD_MONTHLY_DUE = 100;

export function normalizeGuildState(saved = {}) {
  const memberships = saved.memberships && typeof saved.memberships === "object" ? saved.memberships : {};
  const relations = saved.relations && typeof saved.relations === "object" ? saved.relations : {};
  const expelled = saved.expelled && typeof saved.expelled === "object" ? saved.expelled : {};
  const violations = saved.violations && typeof saved.violations === "object" ? saved.violations : {};
  return {
    memberships: Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, Boolean(memberships[industry.id])])),
    relations: { guo_hanglao: clamp(relations.guo_hanglao ?? 25) },
    expelled: Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, Boolean(expelled[industry.id])])),
    violations: Object.fromEntries(INDUSTRIES.map((industry) => [industry.id, Math.max(0, Math.floor(violations[industry.id] ?? 0))])),
    lastMonthKey: typeof saved.lastMonthKey === "string" ? saved.lastMonthKey : "",
    yearlyDuties: saved.yearlyDuties && typeof saved.yearlyDuties === "object" ? saved.yearlyDuties : {},
    aftersales: Array.isArray(saved.aftersales) ? saved.aftersales.filter((item) => typeof item === "string").slice(-6) : [],
  };
}

export function getGuildActions(state) {
  const guild = ensureGuild(state.player);
  return GUILDS.map((entry) => {
    const gate = canJoinGuild(state, entry.industryId);
    return {
      id: `guild_join:${entry.industryId}`,
      name: `入${entry.name}`,
      description: `入行钱${GUILD_ENTRY_FEE}文 · 行老${entry.elder.name} · 入行后禁压价`,
      available: gate.ok,
      reason: guild.memberships[entry.industryId] ? "已入行" : gate.reason,
    };
  });
}

export function createGuildAction(actionId, state) {
  const [, industryId] = String(actionId).split(":");
  const gate = canJoinGuild(state, industryId);
  if (!gate.ok) return { ok: false, message: gate.reason };
  state.player.coins -= GUILD_ENTRY_FEE;
  const guild = ensureGuild(state.player);
  guild.memberships[industryId] = true;
  guild.violations[industryId] = 0;
  const entry = getGuildByIndustry(industryId);
  return { ok: true, message: `${gate.sponsor}作保，你交入行钱${GUILD_ENTRY_FEE}文，入了${entry.name}；往后禁压价，每月行例钱${GUILD_MONTHLY_DUE}文。` };
}

export function monthlyGuildSettlement(state, dateParts) {
  const guild = ensureGuild(state.player);
  const monthKey = `${dateParts.year}-${dateParts.month}`;
  if (guild.lastMonthKey === monthKey) return [];
  guild.lastMonthKey = monthKey;
  const messages = [];
  GUILDS.forEach((entry) => {
    if (!guild.memberships[entry.industryId]) return;
    if (state.player.coins >= GUILD_MONTHLY_DUE) {
      state.player.coins -= GUILD_MONTHLY_DUE;
      state.player.business.periodProfit -= GUILD_MONTHLY_DUE;
      messages.push(`${entry.name}行例钱${GUILD_MONTHLY_DUE}文已交。`);
    } else {
      expelGuild(state.player, entry.industryId);
      messages.push(`${entry.name}行例钱发不出，被行里逐出，此行永不再入。`);
      return;
    }
    if ((state.player.business.reputation ?? 40) < 25) {
      expelGuild(state.player, entry.industryId);
      messages.push(`商誉崩盘，${entry.name}不再认你，此行永不再入。`);
      return;
    }
    if (shouldRunDuty(guild, entry.industryId, dateParts) && Math.random() < 0.16) {
      const cost = Math.min(state.player.coins, randomInt(80, 260));
      state.player.coins -= cost;
      state.player.business.periodProfit -= cost;
      messages.push(`${entry.name}帮行义务：红白事与官面摊派凑了${cost}文。`);
    }
    maybeAftersales(state, entry, messages);
  });
  return messages;
}

export function isGuildMember(player, industryId) {
  return Boolean(ensureGuild(player).memberships[industryId]);
}

export function getGuildSupplyRelationFloor(player, industryId, currentRelation) {
  return isGuildMember(player, industryId) ? Math.max(currentRelation, 50) : currentRelation;
}

export function isPriceModeAllowed(player, industryId, priceMode) {
  return !(priceMode === "low" && isGuildMember(player, industryId));
}

export function recordPriceViolation(player, industryId) {
  const guild = ensureGuild(player);
  if (!guild.memberships[industryId]) return "";
  guild.violations[industryId] = (guild.violations[industryId] ?? 0) + 1;
  if (guild.violations[industryId] === 1) return " 行里递话警告：入行后不可压价坏规矩。";
  if (guild.violations[industryId] === 2) {
    const fine = Math.min(player.coins, 500);
    player.coins -= fine;
    player.business.periodProfit -= fine;
    return ` 行里罚银${fine}文。`;
  }
  expelGuild(player, industryId);
  return " 连续坏行规，被逐出行会，此行永不再入。";
}

export function getGuildLedgerLines(player) {
  const guild = ensureGuild(player);
  const lines = GUILDS.map((entry) => `${entry.name}：${guild.memberships[entry.industryId] ? "在行" : guild.expelled[entry.industryId] ? "逐出永禁" : "未入"}，违规${guild.violations[entry.industryId] ?? 0}次。`);
  if (guild.aftersales.length) lines.push(`售后/纠纷：${guild.aftersales.join("；")}`);
  return lines;
}

export function getGuildContext(state) {
  const guild = ensureGuild(state.player);
  const joined = GUILDS.filter((entry) => guild.memberships[entry.industryId]).map((entry) => entry.name);
  return joined.length ? `行会：${joined.join("、")}在行；行规禁压价，街司纠纷可调解。` : "行会：未入行。";
}

export function getGuildByIndustry(industryId) {
  return GUILDS.find((entry) => entry.industryId === industryId) ?? null;
}

function canJoinGuild(state, industryId) {
  const entry = getGuildByIndustry(industryId);
  if (!entry) return { ok: false, reason: "无此行会" };
  const guild = ensureGuild(state.player);
  if (guild.memberships[industryId]) return { ok: false, reason: "已入行" };
  if (guild.expelled[industryId]) return { ok: false, reason: "曾被逐出，此行永不再入" };
  if (state.player.identity !== "摊主") return { ok: false, reason: "须先是摊主" };
  if ((state.player.business?.reputation ?? 40) < 55) return { ok: false, reason: "商誉需≥55" };
  if (state.player.begging?.mode === "join") return { ok: false, reason: "带丐籍标签，行老拒收" };
  if ((state.player.officialRisk ?? 0) >= 40) return { ok: false, reason: "官面风险太重，行老观望" };
  if (state.player.coins < GUILD_ENTRY_FEE) return { ok: false, reason: `入行钱需${GUILD_ENTRY_FEE}文` };
  const elderRelation = getElderRelation(state, entry);
  if (elderRelation < 40) return { ok: false, reason: `${entry.elder.name}关系需≥40` };
  const sponsor = getSponsor(state, industryId);
  if (!sponsor) return { ok: false, reason: "需同行默契关系≥50作保" };
  return { ok: true, sponsor };
}

function getElderRelation(state, entry) {
  if (entry.elder.id === "guo_hanglao") return ensureGuild(state.player).relations.guo_hanglao;
  return state.player.business?.suppliers?.[entry.elder.id]?.relation ?? 25;
}

function getSponsor(state, industryId) {
  const rival = getRivalForIndustry(industryId);
  const rel = rival ? state.world?.rivals?.relations?.[rival.id] ?? 30 : 0;
  return rel >= 50 ? rival.name : "";
}

function maybeAftersales(state, entry, messages) {
  if (Math.random() > 0.08) return;
  const grey = state.player.business.pendingScamTag ? 0.08 : 0;
  if (Math.random() > 0.08 + grey + (55 - Math.min(55, state.player.business.reputation ?? 40)) / 300) return;
  const cases = ["退换货上门", "坏货致病索赔", "同行举发用灰货"];
  const text = cases[randomInt(0, cases.length - 1)];
  const guildHelp = isGuildMember(state.player, entry.industryId);
  const loss = guildHelp ? randomInt(40, 100) : randomInt(80, 220);
  state.player.coins = Math.max(0, state.player.coins - Math.min(state.player.coins, loss));
  state.player.business.reputation = Math.max(0, state.player.business.reputation - (guildHelp ? 3 : 8));
  state.player.business.periodProfit -= loss;
  const note = `${entry.name}${text}${guildHelp ? "，行会调解" : ""}，折${loss}文`;
  ensureGuild(state.player).aftersales.push(note);
  ensureGuild(state.player).aftersales = ensureGuild(state.player).aftersales.slice(-6);
  messages.push(note);
}

function shouldRunDuty(guild, industryId, dateParts) {
  const yearKey = `${dateParts.year}:${industryId}`;
  guild.yearlyDuties[yearKey] = guild.yearlyDuties[yearKey] ?? 0;
  if (guild.yearlyDuties[yearKey] >= 2) return false;
  if (guild.yearlyDuties[yearKey] === 0 || Math.random() < 0.4) {
    guild.yearlyDuties[yearKey] += 1;
    return true;
  }
  return false;
}

function expelGuild(player, industryId) {
  const guild = ensureGuild(player);
  guild.memberships[industryId] = false;
  guild.expelled[industryId] = true;
}

function ensureGuild(player) {
  player.business.guild = normalizeGuildState(player.business?.guild);
  return player.business.guild;
}

function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
