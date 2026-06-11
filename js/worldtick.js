import { chance } from "./luck.js";
import { normalizeNeighborState } from "./neighborchain.js";
import { applyCrowdingEvent, monthlyRivalTick, normalizeRivals } from "./rivals.js";

export const RICE_BASE_DOU_PRICE = 80;

const EVENT_POOL = [
  { id: "tax", name: "官府催税", text: "官府催税，坊巷里议论纷纷。", days: [7, 15] },
  { id: "grain_delay", name: "漕粮误期", text: "漕粮误期，米市人心发紧，船行催着赶工。", days: [12, 25], hook: { riceDelta: 10, porterMultiplier: 1.2 } },
  { id: "cold_wave", name: "寒潮", text: "寒潮压城，夜里瓦上都结白霜。", days: [7, 14], seasons: ["冬"], hook: { coldExtra: -2 } },
  { id: "pestilence", name: "疫气起", text: "城中疫气起，茶坊里都压低声音说病。", days: [10, 20], hook: { illnessMultiplier: 2 } },
  { id: "porridge", name: "富户施粥", text: "有富户在街口施粥，穷人都往那边去。", days: [7, 12], hook: { begMultiplier: 2 } },
  { id: "wazi_star", name: "瓦子名角登台", text: "瓦子名角登台，游人挤满半条街。", days: [7, 10], hook: { waziBegMultiplier: 1.5 } },
  { id: "rain", name: "连日阴雨", text: "连日阴雨，河埠湿滑，行路艰难。", days: [7, 16], seasons: ["春", "夏"], hook: { illnessMultiplier: 1.2 } },
  { id: "temple_fair", name: "城隍庙会", text: "城隍庙会将近，香客与摊贩渐多。", days: [7, 12], hook: { begMultiplier: 1.3 } },
  { id: "market_check", name: "米市盘查", text: "米市近日盘查严，牙人都收敛了些。", days: [8, 16], hook: { riceDelta: -3 } },
  { id: "dock_injury", name: "码头伤人", text: "码头有脚夫伤了腿，众人说船行催得太狠。", days: [7, 14], hook: { porterMultiplier: 1.1, illnessMultiplier: 1.1 } },
  { id: "charity_clothes", name: "旧衣散发", text: "清河坊有人散发旧衣，穷人排成一线。", days: [5, 9], seasons: ["冬"] },
  { id: "grain_arrives", name: "粮船入港", text: "几艘粮船入港，米市掌柜脸色松了些。", days: [7, 12], hook: { riceDelta: -8 } },
  { id: "clerk_vacancy", name: "衙门补吏", text: "府衙传出补吏缺额，懂文算又有人引荐者才敢递话。", days: [20, 20], hook: { clerkVacancy: 1 }, rare: true },
];

export function createWorldState(saved = {}) {
  return {
    riceIndex: Number.isFinite(saved.riceIndex) ? saved.riceIndex : 100,
    activeEvents: Array.isArray(saved.activeEvents) ? saved.activeEvents : [],
    lastRiceMonthKey: typeof saved.lastRiceMonthKey === "string" ? saved.lastRiceMonthKey : "",
    lastEventCheckKey: typeof saved.lastEventCheckKey === "string" ? saved.lastEventCheckKey : "",
    neighborChains: normalizeNeighborState(saved.neighborChains),
    dockWageDelayDays: Number.isFinite(saved.dockWageDelayDays) ? saved.dockWageDelayDays : 0,
    rivals: normalizeRivals(saved.rivals),
  };
}

export function dailyWorldTick(world, dateParts, season) {
  world.activeEvents = world.activeEvents.map((event) => ({ ...event, remainingDays: event.remainingDays - 1 })).filter((event) => event.remainingDays > 0);

  const monthKey = `${dateParts.year}-${dateParts.month}`;
  if (dateParts.day === 1 && world.lastRiceMonthKey !== monthKey) {
    world.riceIndex = Math.max(60, Math.min(160, world.riceIndex + randomInt(-8, 8) + getSeasonRiceModifier(dateParts.month) + getHooks(world).riceDelta));
    if (world.riceIndex > 115) applyCrowdingEvent(world, "cooked_cake", 10);
    world.lastRiceMonthKey = monthKey;
  }
  monthlyRivalTick(world, dateParts).forEach((text) => world.activeEvents.push({ id: `rival_${Date.now()}_${Math.random()}`, name: "同行爆雷", text, remainingDays: 7 }));

  const eventKey = `${monthKey}-${dateParts.day}`;
  if ([1, 15].includes(dateParts.day) && world.lastEventCheckKey !== eventKey) {
    world.lastEventCheckKey = eventKey;
    if (world.activeEvents.length < 3 && chance(0.4, "neutral")) addRandomEvent(world, season);
    if (world.activeEvents.length < 3 && chance(0.08, "neutral")) addSpecificEvent(world, season, "clerk_vacancy");
  }
}

export function getHooks(world) {
  return world.activeEvents.reduce((hooks, event) => {
    Object.entries(event.hook ?? {}).forEach(([key, value]) => {
      hooks[key] = (hooks[key] ?? (key.endsWith("Multiplier") ? 1 : 0)) + (key.endsWith("Multiplier") ? value - 1 : value);
    });
    return hooks;
  }, { riceDelta: 0, porterMultiplier: 1, begMultiplier: 1, waziBegMultiplier: 1, illnessMultiplier: 1, coldExtra: 0 });
}

export function getRumors(world) {
  return world.activeEvents.slice(0, 3).map((event) => event.text);
}

export function getRiceDouPrice(world) {
  return Math.round(RICE_BASE_DOU_PRICE * world.riceIndex / 100);
}

export function applyRicePressure(npcs, riceIndex) {
  const targets = new Set(["old_he", "zhou_daniang", "cuier"]);
  npcs.forEach((npc) => {
    if (!npc.assets || !targets.has(npc.id)) return;
    if (riceIndex > 120) npc.assets.status = downgrade(npc.assets.status);
    else if (npc.assets.cash < 200) npc.assets.status = "拮据";
    else if (npc.assets.cash <= 2000) npc.assets.status = "温饱";
    else npc.assets.status = "宽裕";
  });
}

function addRandomEvent(world, season) {
  const activeIds = new Set(world.activeEvents.map((event) => event.id));
  const candidates = EVENT_POOL.filter((event) => !event.rare && !activeIds.has(event.id) && (!event.seasons || event.seasons.includes(season)));
  if (candidates.length === 0) return;
  const event = candidates[randomInt(0, candidates.length - 1)];
  world.activeEvents.push({ ...event, remainingDays: randomInt(event.days[0], event.days[1]) });
}

function addSpecificEvent(world, season, eventId) {
  const activeIds = new Set(world.activeEvents.map((event) => event.id));
  if (activeIds.has(eventId)) return;
  const event = EVENT_POOL.find((item) => item.id === eventId && (!item.seasons || item.seasons.includes(season)));
  if (!event) return;
  world.activeEvents.push({ ...event, remainingDays: randomInt(event.days[0], event.days[1]) });
}

function getSeasonRiceModifier(month) {
  if ([8, 9].includes(month)) return -5;
  if ([3, 4].includes(month)) return 5;
  return 0;
}

function downgrade(status) {
  if (status === "宽裕") return "温饱";
  return "拮据";
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
