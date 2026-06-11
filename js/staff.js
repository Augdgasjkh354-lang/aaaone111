import { isGuildMember } from "./guild.js";
import { hasItem } from "./items.js";

const FAMILY_NAMES = ["赵", "钱", "孙", "李", "周", "吴", "郑", "王", "陈", "林"];
const GIVEN_NAMES = ["阿顺", "二郎", "小满", "来福", "阿青", "春儿", "小桂", "守成", "阿禾", "三喜"];

export function normalizeStaffState(saved = {}) {
  return {
    workers: Array.isArray(saved.workers) ? saved.workers.map(normalizeWorker).filter(Boolean).slice(0, 4) : [],
    lastPayrollMonthKey: typeof saved.lastPayrollMonthKey === "string" ? saved.lastPayrollMonthKey : "",
    unpaidMonths: Number.isFinite(saved.unpaidMonths) ? Math.max(0, Math.floor(saved.unpaidMonths)) : 0,
    lastGrowthMonthKey: typeof saved.lastGrowthMonthKey === "string" ? saved.lastGrowthMonthKey : "",
    notes: Array.isArray(saved.notes) ? saved.notes.filter((item) => typeof item === "string").slice(-8) : [],
  };
}

export function getStaffActions(state) {
  const staff = ensureStaff(state.player);
  const hasPlace = Boolean(state.player.business?.shop?.stall?.active || state.player.business?.shop?.store?.active);
  const canHire = hasPlace && staff.workers.length < 4;
  const cuierFavor = state.npcs.find((npc) => npc.id === "cuier")?.relation?.favor ?? 0;
  const chenTrust = state.npcs.find((npc) => npc.id === "chen_si")?.relation?.trust ?? 0;
  const activeIndustry = state.player.business?.activeIndustryId || state.player.business?.shop?.stall?.industryId || state.player.business?.shop?.store?.industryId || "";
  return [
    { id: "staff_hire:cuier", name: "雇翠儿为伙计", description: "月钱650文管饭 · 忠诚极高", available: canHire && cuierFavor >= 40, reason: canHire ? "需翠儿favor≥40" : "需摊位/铺面且雇工未满" },
    { id: "staff_hire:chen", name: "陈四引荐脚夫子弟", description: "月钱300文管饭 · 学徒", available: canHire && chenTrust >= 30, reason: canHire ? "需陈四trust≥30" : "需摊位/铺面且雇工未满" },
    { id: "staff_hire:guild", name: "行会荐人", description: "月钱650文管饭 · 手艺稳", available: canHire && isGuildMember(state.player, activeIndustry), reason: canHire ? "需本行在行" : "需摊位/铺面且雇工未满" },
    { id: "staff_hire:street", name: "街面自募", description: "月钱300文管饭 · 属性盲盒", available: canHire, reason: "需摊位/铺面且雇工未满" },
  ];
}

export function createStaffAction(actionId, state) {
  const [, channel] = String(actionId).split(":");
  const action = getStaffActions(state).find((item) => item.id === actionId);
  if (!action?.available) return { ok: false, message: action?.reason ?? "雇不到人。" };
  const worker = makeWorker(channel);
  let contractText = "自用笔墨立了雇工契。";
  if (!hasItem(state.player, "笔墨")) {
    if (state.player.coins >= 50) {
      state.player.coins -= 50;
      state.player.business.periodProfit -= 50;
      contractText = "牙人代笔雇工契，花50文。";
    } else {
      worker.contract = false;
      contractText = "钱不够代笔，暂凭口约。";
    }
  }
  ensureStaff(state.player).workers.push(worker);
  return { ok: true, message: `雇下${worker.name}作${worker.type}，月钱${worker.monthlyWage}文管饭，手艺${worker.skill}/100，忠诚${worker.loyalty}/100。${contractText}` };
}

export function dailyStaffSettlement(state, dateParts) {
  const staff = ensureStaff(state.player);
  const messages = [];
  if (staff.workers.length > 0) {
    const meal = staff.workers.length * 15;
    if (state.player.coins >= meal) {
      state.player.coins -= meal;
      state.player.business.periodProfit -= meal;
    } else {
      staff.workers.forEach((worker) => { worker.loyalty = Math.max(0, worker.loyalty - 3); });
      messages.push(`雇工饭钱${meal}文支不出，伙计心里发冷。`);
    }
  }
  return messages;
}

export function monthlyStaffSettlement(state, dateParts) {
  const staff = ensureStaff(state.player);
  const monthKey = `${dateParts.year}-${dateParts.month}`;
  if (staff.lastPayrollMonthKey === monthKey) return [];
  staff.lastPayrollMonthKey = monthKey;
  const messages = [];
  if (staff.workers.length === 0) return messages;
  const payroll = staff.workers.reduce((sum, worker) => sum + worker.monthlyWage, 0);
  if (state.player.coins >= payroll) {
    state.player.coins -= payroll;
    state.player.business.periodProfit -= payroll;
    staff.unpaidMonths = 0;
    messages.push(`雇工月钱发出${payroll}文。`);
  } else {
    staff.unpaidMonths += 1;
    staff.workers.forEach((worker) => { worker.loyalty = Math.max(0, worker.loyalty - 30); });
    messages.push(`雇工月钱${payroll}文发不出，忠诚大跌。`);
    if (staff.unpaidMonths >= 2) {
      const left = staff.workers.splice(0, staff.workers.length);
      state.player.business.reputation = Math.max(0, state.player.business.reputation - 8);
      messages.push(`${left.map((worker) => worker.name).join("、")}离开，还带走些回头客口碑。`);
      return messages;
    }
  }
  staff.workers.forEach((worker) => monthlyWorkerRisk(state, worker, messages));
  staff.workers = staff.workers.filter((worker) => {
    if (worker.loyalty >= 25) return true;
    state.player.business.reputation = Math.max(0, state.player.business.reputation - 4);
    messages.push(`${worker.name}忠诚太低，被同行挖走。`);
    return false;
  });
  if (staff.lastGrowthMonthKey !== monthKey) {
    staff.lastGrowthMonthKey = monthKey;
    staff.workers.forEach((worker) => {
      if (worker.type === "学徒") worker.skill = Math.min(100, worker.skill + randomInt(2, 6));
    });
  }
  return messages;
}

export function getBestStaffSkill(player) {
  const workers = ensureStaff(player).workers;
  if (!workers.length) return 0;
  return Math.max(...workers.map((worker) => worker.skill));
}

export function hasStaffLodging(player) {
  return ensureStaff(player).workers.length > 0;
}

export function getStaffLedgerLines(player) {
  const staff = ensureStaff(player);
  const payroll = staff.workers.reduce((sum, worker) => sum + worker.monthlyWage, 0);
  const lines = [`雇工：${staff.workers.length ? staff.workers.map((worker) => `${worker.name}${worker.type}/月${worker.monthlyWage}/手艺${worker.skill}/忠诚${worker.loyalty}`).join("；") : "无"}`];
  lines.push(`雇工月钱合计：${payroll}文；每日饭钱：${staff.workers.length * 15}文。`);
  if (staff.notes.length) lines.push(`雇工线索：${staff.notes.join("；")}`);
  return lines;
}

export function getStaffContext(player) {
  const staff = ensureStaff(player);
  return staff.workers.length ? `雇工：${staff.workers.map((worker) => `${worker.name}${worker.type}，手艺${worker.skill}，忠诚${worker.loyalty}`).join("；")}` : "雇工：无。";
}

function monthlyWorkerRisk(state, worker, messages) {
  if (worker.hands === "不干净" && Math.random() < worker.graftRisk) {
    const loss = randomInt(30, 160);
    state.player.coins = Math.max(0, state.player.coins - Math.min(state.player.coins, loss));
    state.player.business.periodProfit -= loss;
    const found = (state.player.skills?.suan ?? 0) >= 45;
    const note = found ? `${worker.name}账上露出亏空${loss}文` : `损益表多出一笔亏空${loss}文`;
    ensureStaff(state.player).notes.push(note);
    messages.push(found ? `${note}，可辞退、敲打或送官。` : `${note}，暂未抓到人。`);
  }
  if (Math.random() < 0.02) {
    const cost = randomInt(80, 300);
    const pay = typeof window !== "undefined" && window.confirm ? window.confirm(`${worker.name}守摊/铺受伤，东家担${cost}文医药钱？`) : true;
    if (pay && state.player.coins >= cost) {
      state.player.coins -= cost;
      state.player.business.periodProfit -= cost;
      worker.loyalty = Math.min(100, worker.loyalty + 20);
      state.player.business.reputation = Math.min(100, state.player.business.reputation + 3);
      messages.push(`${worker.name}工伤，你担了${cost}文医药钱，行内说你厚道。`);
    } else {
      worker.loyalty = Math.max(0, worker.loyalty - 35);
      state.player.business.reputation = Math.max(0, state.player.business.reputation - 10);
      messages.push(`${worker.name}工伤医药无人担，风闻说那家东家刻薄。`);
    }
  }
}

function makeWorker(channel) {
  if (channel === "cuier") return { name: "翠儿", type: "伙计", monthlyWage: 650, skill: 55, loyalty: 92, hands: "干净", graftRisk: 0, contract: true };
  if (channel === "chen") return randomWorker("学徒", 300, [25, 45], [55, 75], 0.08);
  if (channel === "guild") return randomWorker("伙计", 650, [45, 70], [55, 80], 0.03);
  return randomWorker("学徒", 300, [15, 65], [25, 70], 0.18);
}

function randomWorker(type, wage, skillRange, loyaltyRange, dirtyChance) {
  const name = `${FAMILY_NAMES[randomInt(0, FAMILY_NAMES.length - 1)]}${GIVEN_NAMES[randomInt(0, GIVEN_NAMES.length - 1)]}`;
  const dirty = Math.random() < dirtyChance;
  return { name, type, monthlyWage: wage, skill: randomInt(skillRange[0], skillRange[1]), loyalty: randomInt(loyaltyRange[0], loyaltyRange[1]), hands: dirty ? "不干净" : "干净", graftRisk: dirty ? randomInt(3, 8) / 100 : 0, contract: true };
}

function normalizeWorker(worker) {
  if (!worker || typeof worker.name !== "string") return null;
  return {
    name: worker.name.slice(0, 20),
    type: worker.type === "伙计" ? "伙计" : "学徒",
    monthlyWage: Number.isFinite(worker.monthlyWage) ? Math.max(0, Math.floor(worker.monthlyWage)) : (worker.type === "伙计" ? 650 : 300),
    skill: clamp(worker.skill ?? 30),
    loyalty: clamp(worker.loyalty ?? 50),
    hands: worker.hands === "不干净" ? "不干净" : "干净",
    graftRisk: Number.isFinite(worker.graftRisk) ? Math.max(0, Math.min(0.2, worker.graftRisk)) : 0,
    contract: Boolean(worker.contract),
  };
}

function ensureStaff(player) {
  player.business.staff = normalizeStaffState(player.business?.staff);
  return player.business.staff;
}
function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
