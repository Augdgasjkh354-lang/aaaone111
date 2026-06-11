export const RIVALS = [
  {
    id: "hubing_liu",
    name: "胡饼刘",
    industryId: "cooked_cake",
    temperament: "泼辣压价型",
    card: "熟食同行，爱压价抢热闹口，肯赊几块饼给熟客，也敢碰灰盐；一年一骰，发达或爆雷都传得快。",
  },
  {
    id: "ashui",
    name: "阿水",
    industryId: "fresh_fish_veg",
    temperament: "闷头勤快型",
    card: "鱼鲜同行，天天晨市抢头水，赊销少，夜船货也偶尔沾手；命运看船、看天、看巡检。",
  },
  {
    id: "miu_pozi",
    name: "缪婆子",
    industryId: "used_clothes",
    temperament: "嘴碎人脉广",
    card: "估衣同行，消息灵，能收旧也敢试赃衣；若起口水战，会散你坏话，商誉立跌。",
  },
];

const BASE_CROWDING = {
  slum_alley: { cooked_cake: 25, fresh_fish_veg: 20, used_clothes: 15 },
  rice_market: { cooked_cake: 45, fresh_fish_veg: 55, used_clothes: 25 },
  morning_gate_market: { cooked_cake: 55, fresh_fish_veg: 70, used_clothes: 35 },
  qinghefang: { cooked_cake: 55, fresh_fish_veg: 45, used_clothes: 65 },
  imperial_street: { cooked_cake: 70, fresh_fish_veg: 50, used_clothes: 45 },
  wazi: { cooked_cake: 65, fresh_fish_veg: 35, used_clothes: 40 },
  city_god_temple: { cooked_cake: 60, fresh_fish_veg: 40, used_clothes: 50 },
  dock: { cooked_cake: 40, fresh_fish_veg: 65, used_clothes: 25 },
  south_homes: { cooked_cake: 35, fresh_fish_veg: 40, used_clothes: 30 },
  academy: { cooked_cake: 25, fresh_fish_veg: 20, used_clothes: 25 },
};

export function normalizeRivals(saved = {}) {
  const relations = saved.relations && typeof saved.relations === "object" ? saved.relations : {};
  const stances = saved.stances && typeof saved.stances === "object" ? saved.stances : {};
  return {
    crowding: normalizeCrowding(saved.crowding),
    relations: Object.fromEntries(RIVALS.map((rival) => [rival.id, clamp(relations[rival.id] ?? 30)])),
    stances: Object.fromEntries(RIVALS.map((rival) => [rival.id, ["压价", "平价"].includes(stances[rival.id]) ? stances[rival.id] : "平价"])),
    lastMonthKey: typeof saved.lastMonthKey === "string" ? saved.lastMonthKey : "",
    fates: Array.isArray(saved.fates) ? saved.fates.filter((item) => typeof item === "string").slice(-6) : [],
  };
}

export function monthlyRivalTick(world, dateParts) {
  world.rivals = normalizeRivals(world.rivals);
  const monthKey = `${dateParts.year}-${dateParts.month}`;
  if (world.rivals.lastMonthKey === monthKey) return [];
  world.rivals.lastMonthKey = monthKey;
  Object.keys(world.rivals.crowding).forEach((locationId) => {
    Object.keys(world.rivals.crowding[locationId]).forEach((industryId) => {
      world.rivals.crowding[locationId][industryId] = clamp(world.rivals.crowding[locationId][industryId] + randomInt(-5, 5));
    });
  });
  RIVALS.forEach((rival) => { world.rivals.stances[rival.id] = Math.random() < 0.35 ? "压价" : "平价"; });
  if (dateParts.month === 1) return rollRivalFates(world);
  return [];
}

export function applyCrowdingEvent(world, industryId, delta) {
  world.rivals = normalizeRivals(world.rivals);
  Object.values(world.rivals.crowding).forEach((byIndustry) => {
    byIndustry[industryId] = clamp((byIndustry[industryId] ?? 0) + delta);
  });
}

export function getCrowding(world, locationId, industryId) {
  world.rivals = normalizeRivals(world.rivals);
  return world.rivals.crowding[locationId]?.[industryId] ?? 35;
}

export function getRivalForIndustry(industryId) {
  return RIVALS.find((rival) => rival.industryId === industryId) ?? null;
}

export function getRivalSellFactor(world, player, industryId) {
  const rival = getRivalForIndustry(industryId);
  if (!rival) return 1;
  world.rivals = normalizeRivals(world.rivals);
  const relation = world.rivals.relations[rival.id] ?? 30;
  if (relation >= 50) return 1;
  return world.rivals.stances[rival.id] === "压价" ? 0.85 : 1;
}

export function changeRivalRelation(world, rivalId, delta) {
  world.rivals = normalizeRivals(world.rivals);
  world.rivals.relations[rivalId] = clamp((world.rivals.relations[rivalId] ?? 30) + delta);
}

export function describeRivalContext(world, industryId) {
  const rival = getRivalForIndustry(industryId);
  if (!rival) return "";
  world.rivals = normalizeRivals(world.rivals);
  return `${rival.name}｜${rival.temperament}｜关系${world.rivals.relations[rival.id]}/100｜本月姿态：${world.rivals.stances[rival.id]}｜${rival.card}`;
}

function normalizeCrowding(savedCrowding = {}) {
  const result = {};
  Object.entries(BASE_CROWDING).forEach(([locationId, byIndustry]) => {
    result[locationId] = {};
    Object.entries(byIndustry).forEach(([industryId, value]) => {
      result[locationId][industryId] = clamp(savedCrowding?.[locationId]?.[industryId] ?? value);
    });
  });
  return result;
}

function rollRivalFates(world) {
  const notes = RIVALS.map((rival) => {
    const roll = Math.random();
    const fate = roll < 0.18 ? "爆雷" : roll > 0.82 ? "发达" : "维持";
    return `${rival.name}${fate}`;
  });
  world.rivals.fates = [...world.rivals.fates, ...notes].slice(-6);
  return notes.filter((note) => note.endsWith("爆雷")).map((note) => `${note}，街面传作另一种活法的下场。`);
}

function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
