import { callDeepSeek } from "./api.js";
import { formatClock } from "./clock.js";

const MAX_NPC_MEMORIES = 10;
const COMPRESS_SOURCE_COUNT = 6;

export const INITIAL_NPCS = [
  {
    id: "old_he",
    name: "老何",
    identity: "贫民巷拾荒老人，约60岁。",
    age: 60,
    personality: "话多胆小，记仇也记恩，巷中消息通。",
    situation: "年纪大了捡不动了，怕冬天。",
    schedule: { 晨: "slum_alley", 午: "rice_market", 暮: "slum_alley", 夜: "slum_alley" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 80, incomeSource: "拾荒和巷中零碎接济", status: "拮据" },
    debts: [],
    unknownLabel: "一个拾荒老人",
  },
  {
    id: "zhou_daniang",
    name: "周大娘",
    identity: "巷口炊饼摊主，约45岁。",
    age: 45,
    personality: "面冷心软，账目分明。",
    situation: "丈夫病着，摊子是全家生计。",
    schedule: { 晨: "slum_alley", 午: "qinghefang", 暮: "south_homes", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 500, incomeSource: "巷口炊饼摊收入", status: "温饱" },
    debts: [],
    unknownLabel: "一个炊饼摊主",
  },
  {
    id: "chen_si",
    name: "陈四",
    identity: "码头脚夫小头目，约35岁。",
    age: 35,
    personality: "认力气守信，厌恶油滑。",
    situation: "手下弟兄工钱被船行拖欠，正窝火。",
    schedule: { 晨: "dock", 午: "dock", 暮: "rice_market", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 900, incomeSource: "码头扛包和替脚夫分派活计", status: "温饱" },
    debts: [],
    unknownLabel: "一个码头脚夫头目",
  },
  {
    id: "mr_wu",
    name: "吴先生",
    identity: "落第秀才，城隍庙前代写书信，约40岁。",
    age: 40,
    personality: "清高落魄，惜才。",
    situation: "又一年没中，靠代写勉强糊口。",
    schedule: { 晨: "city_god_temple", 午: "city_god_temple", 暮: "academy", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 150, incomeSource: "城隍庙前代写书信", status: "拮据" },
    debts: [],
    unknownLabel: "一个代写书信的秀才",
  },
  {
    id: "cuier",
    name: "翠儿",
    identity: "瓦子跑腿杂役，13岁。",
    age: 13,
    personality: "机灵嘴严，只信真对她好的人。",
    situation: "想攒钱给娘抓药。",
    schedule: { 晨: "qinghefang", 午: "wazi", 暮: "wazi", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 40, incomeSource: "瓦子跑腿杂役赏钱", status: "拮据" },
    debts: [],
    unknownLabel: "一个跑腿小姑娘",
  },

  {
    id: "an_langzhong",
    name: "安郎中",
    identity: "城南民居坐馆郎中，约50岁。",
    age: 50,
    personality: "话少，手稳，见惯生死，不势利但也不滥善。",
    situation: "医馆生意平平，最厌恶病人拖到重症才来。",
    schedule: { 晨: "south_homes", 午: "qinghefang", 暮: "south_homes", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 1800, incomeSource: "坐馆诊金与药钱", status: "温饱" },
    debts: [],
    unknownLabel: "一个坐馆郎中",
  },
  {
    id: "liu_mazi",
    name: "刘麻子",
    identity: "米市小牙人，约30岁。",
    age: 30,
    personality: "精明油滑，无利不起早，但讲一种自己的规矩。",
    situation: "最近在倒腾一批来路不明的米。",
    schedule: { 晨: "rice_market", 午: "rice_market", 暮: "dock", 夜: "wazi" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 2600, incomeSource: "米市撮合买卖抽头", status: "宽裕" },
    debts: [],
    unknownLabel: "一个米市牙人",
  },
  {
    id: "sun_yasi",
    name: "孙押司",
    identity: "府衙老吏，约55岁，常在御街茶肆。",
    age: 55,
    personality: "圆滑谨慎，无利不动，但守自己的规矩。",
    situation: "在衙门熬了三十年，想退前再捞一笔安稳钱。",
    schedule: { 晨: "imperial_street", 午: "imperial_street", 暮: "qinghefang", 夜: "south_homes" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 4000, incomeSource: "府衙书吏积蓄与茶肆往来打点", status: "宽裕" },
    debts: [],
    unknownLabel: "一个府衙老吏",
  },
  {
    id: "qian_tuantou",
    name: "钱团头",
    identity: "贫民巷丐首，约45岁。",
    age: 45,
    personality: "笑面，记账比牙人还精，讲他自己的规矩：交钱的都罩，坏规矩的往死里整。",
    situation: "地盘西边被另一伙人蚕食，正需要能干的人手。",
    schedule: { 晨: "rice_market", 午: "slum_alley", 暮: "wazi", 夜: "slum_alley" },
    relation: { favor: 0, trust: 0, doubt: 10 },
    memories: [],
    impression: "尚不认识此人",
    assets: { cash: 1500, incomeSource: "贫民巷与热闹处讨饭例钱", status: "温饱" },
    debts: [],
    unknownLabel: "一个笑面的丐首",
  },
];

const NPC_BY_ID = new Map(INITIAL_NPCS.map((npc) => [npc.id, npc]));

export function createNpcs(savedNpcs = []) {
  const savedById = new Map(Array.isArray(savedNpcs) ? savedNpcs.map((npc) => [npc?.id, npc]) : []);
  return INITIAL_NPCS.map((baseNpc) => normalizeNpc(baseNpc, savedById.get(baseNpc.id)));
}

export function getPresentNpcs(npcs, locationId, period) {
  return normalizeNpcList(npcs).filter((npc) => npc.alive !== false && npc.present !== false && npc.schedule?.[period] === locationId);
}

export function isNpcKnown(npc) {
  return normalizeMemories(npc.memories).length > 0 || npc.impression !== "尚不认识此人";
}

export function getNpcDisplayName(npc) {
  return isNpcKnown(npc) ? npc.name : npc.unknownLabel;
}

export async function applyNpcUpdates(npcs, updates, clock, apiKey) {
  if (!Array.isArray(updates) || updates.length === 0) return;

  const { dateText, timeText } = formatClock(clock);
  for (const update of updates) {
    const npc = npcs.find((item) => item.id === update.id);
    if (!npc) continue;

    if (update.relation_delta) {
      npc.relation = normalizeRelation(npc.relation);
      ["favor", "trust", "doubt"].forEach((field) => {
        if (Number.isFinite(update.relation_delta[field])) {
          npc.relation[field] = clamp(npc.relation[field] + update.relation_delta[field], -100, 100);
        }
      });
    }

    if (Number.isFinite(update.cash_delta)) {
      npc.assets = normalizeAssets(npc.assets);
      npc.assets.cash = Math.max(0, npc.assets.cash + update.cash_delta);
      npc.assets.status = getAssetStatus(npc.assets.cash);
    }

    if (update.impression) npc.impression = update.impression;

    if (update.memory) {
      npc.memories = normalizeMemories(npc.memories);
      npc.memories.push({ date: `${dateText} ${timeText}`, text: update.memory });
      if (npc.memories.length > MAX_NPC_MEMORIES) {
        await compressNpcMemories(npc, apiKey);
      }
    }
  }
}

export function applyDebtUpdates(npcs, updates, date) {
  if (!Array.isArray(updates)) return;
  updates.forEach((update) => {
    const npc = npcs.find((item) => item.id === update.npc_id);
    if (!npc) return;
    npc.debts = normalizeDebts(npc.debts);
    const existing = npc.debts.find((debt) => debt.withPlayer === update.direction);
    if (existing) {
      existing.amount += update.amount_delta;
      existing.note = update.note || existing.note;
      existing.date = date || existing.date;
    } else if (update.amount_delta > 0) {
      npc.debts.push({ withPlayer: update.direction, amount: update.amount_delta, note: update.note || "借贷", date });
    }
    npc.debts = npc.debts.filter((debt) => debt.amount > 0);
  });
}

export function getPlayerDebtLines(npcs) {
  return normalizeNpcList(npcs).flatMap((npc) => normalizeDebts(npc.debts).map((debt) => {
    const verb = debt.withPlayer === "player_owes" ? "欠" : "被欠";
    return `${verb}${npc.name}${Math.floor(debt.amount)}文`;
  }));
}

function normalizeNpc(baseNpc, savedNpc = {}) {
  return {
    ...baseNpc,
    relation: normalizeRelation(savedNpc.relation ?? baseNpc.relation),
    memories: normalizeMemories(savedNpc.memories),
    impression: typeof savedNpc.impression === "string" ? savedNpc.impression : baseNpc.impression,
    assets: normalizeAssets(savedNpc.assets ?? baseNpc.assets),
    debts: normalizeDebts(savedNpc.debts),
    alive: savedNpc.alive === false ? false : true,
    present: savedNpc.present === false ? false : true,
    workPausedUntil: Number.isFinite(savedNpc.workPausedUntil) ? Math.max(0, Math.floor(savedNpc.workPausedUntil)) : 0,
    agingSickCount: Number.isFinite(savedNpc.agingSickCount) ? Math.max(0, Math.floor(savedNpc.agingSickCount)) : 0,
  };
}

function normalizeNpcList(npcs) {
  if (!Array.isArray(npcs)) return createNpcs();
  return npcs.map((npc) => normalizeNpc(NPC_BY_ID.get(npc.id) ?? npc, npc));
}

function normalizeRelation(relation = {}) {
  return {
    favor: clampInteger(relation.favor, -100, 100, 0),
    trust: clampInteger(relation.trust, -100, 100, 0),
    doubt: clampInteger(relation.doubt, -100, 100, 10),
  };
}

export function getAssetStatus(cash) {
  if (cash < 200) return "拮据";
  if (cash <= 2000) return "温饱";
  return "宽裕";
}

function normalizeAssets(assets = {}) {
  const cash = Math.max(0, Number.isFinite(assets.cash) ? assets.cash : 0);
  return {
    cash,
    incomeSource: typeof assets.incomeSource === "string" ? assets.incomeSource : "收入不明",
    status: getAssetStatus(cash),
  };
}

function normalizeDebts(debts = []) {
  return Array.isArray(debts)
    ? debts.filter((debt) => debt && ["player_owes", "npc_owes"].includes(debt.withPlayer) && Number.isFinite(debt.amount) && debt.amount > 0)
    : [];
}

function normalizeMemories(memories) {
  return Array.isArray(memories)
    ? memories.filter((memory) => memory && typeof memory.date === "string" && typeof memory.text === "string").map((memory) => ({ ...memory, pivotal: Boolean(memory.pivotal) }))
    : [];
}

async function compressNpcMemories(npc, apiKey) {
  if (!apiKey || npc.memories.length <= MAX_NPC_MEMORIES) return;

  const oldMemories = npc.memories.slice(0, COMPRESS_SOURCE_COUNT);
  const remainingMemories = npc.memories.slice(COMPRESS_SOURCE_COUNT);
  const content = oldMemories.map((memory) => `${memory.date}：${memory.text}`).join("\n");

  try {
    const summary = await callDeepSeek([
      { role: "system", content: `你负责压缩NPC“${npc.name}”关于玩家的记忆。只输出一段不超过60字的中文总结，不要JSON，不要解释。` },
      { role: "user", content },
    ], "disabled", apiKey);
    const text = summary.trim().slice(0, 60);
    if (!text) return;
    const pivotal = npc.memories.filter((memory) => memory.pivotal);
    npc.memories = [...pivotal, { date: "往日记忆", text }, ...remainingMemories.slice(-(MAX_NPC_MEMORIES - 1))].slice(-MAX_NPC_MEMORIES);
  } catch (error) {
    console.warn(`${npc.name}的记忆压缩失败，将留待下次尝试。`, error);
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
