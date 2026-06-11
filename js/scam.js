import { callDeepSeek } from "./api.js";
import { getDateParts, getMinuteOfDay, getPeriod } from "./clock.js";
import { rememberStory } from "./memory.js";
import { gainSkill } from "./skills.js";
import { chance } from "./luck.js";
import { isNightMarket } from "./festival.js";

const SCAMS = [
  { id: "dropped_bundle", name: "丢包诈", base: 0.05, bait: "有人在脚边落下一只布包，旁人凑上来说可私分。", loss: [40, 160], condition: () => true },
  { id: "fake_rice_broker", name: "假牙人贱卖漕米", base: 0.04, bait: "米市有人称有一批漕米急脱手，价钱低得反常。", loss: [80, 260], condition: (state) => state.player.location === "rice_market" && state.player.coins > 100 },
  { id: "beauty_trap", name: "美人局", base: 0.04, bait: "瓦子里有人殷勤引酒，说有清净处可谈。", loss: [180, 500], condition: (state) => state.player.location === "wazi" && state.player.coins > 500 },
  { id: "fake_yamen", name: "假官差查无籍", base: 0.05, bait: "两名皂衣人拦路查籍，要你拿钱消灾。", loss: [60, 220], condition: (state) => state.player.identity === "无籍少年" },
  { id: "loaded_gamble", name: "关扑设套", base: 0.12, bait: "关扑摊边有老手说替你翻本，骰碗却不肯离手。", loss: [80, 300], condition: (state, context) => context?.tag === "gamble_loss_streak" || state.player.gambling?.lossStreak >= 3 },
  { id: "fortune_shill", name: "卦肆托儿", base: 0.05, bait: "卦肆旁有人说先生能改运，只要另奉香钱。", loss: [120, 400], condition: (state, context) => context?.tag === "divination" || state.player.location === "city_god_temple" },
  { id: "fake_recommendation", name: "代写假荐书", base: 0.04, bait: "有人称可代写荐书，递到先生门下便有进身路。", loss: [120, 360], condition: (state) => (state.player.skills?.wen ?? 0) >= 30 },
];

export function normalizeScamState(saved = {}) {
  return {
    seen: Array.isArray(saved.seen) ? saved.seen.filter((id) => typeof id === "string") : [],
  };
}

export async function maybeTriggerScam(state, apiKey, mode, context = {}) {
  state.player.scams = normalizeScamState(state.player.scams);
  const candidates = SCAMS.filter((scam) => !state.player.scams.seen.includes(scam.id) && scam.condition(state, context));
  if (candidates.length === 0) return null;
  const forced = context?.tag === "gamble_loss_streak";
  const scam = forced ? candidates.find((item) => item.id === "loaded_gamble") ?? candidates[0] : candidates[Math.floor(Math.random() * candidates.length)];
  const nightBonus = isNightMarket(state.player.location, getPeriod(getMinuteOfDay(state.clock))) ? 1.5 : 1;
  if (!forced && !chance(scam.base * nightBonus, "bad_scam_trigger", state.player)) return null;

  state.player.scams.seen.push(scam.id);
  const canRead = (state.player.skills?.tan ?? 0) >= 40;
  const spotted = canRead && chance(0.5, "good_scam_spot", state.player);
  const loss = spotted ? 0 : randomInt(scam.loss[0], scam.loss[1]);
  if (spotted) gainSkill(state.player, "tan", 1, dateKey(getDateParts(state.clock)));
  else state.player.coins = Math.max(0, state.player.coins - Math.min(state.player.coins, loss));

  const scene = await narrateScam(state, scam, spotted, loss, apiKey, mode);
  await rememberStory(state.player, state.clock, spotted ? `识破${scam.name}` : `中了${scam.name}，损失${loss}文`, apiKey);
  return { scene, spotted, loss, scam };
}

async function narrateScam(state, scam, spotted, loss, apiKey, mode) {
  const { year, month, day } = getDateParts(state.clock);
  const content = await callDeepSeek([
    { role: "system", content: "你写南宋临安市井骗局。手法须真实可信，不漫画化；事后才点破是局。只输出一段中文叙事，不要JSON，120-320字。" },
    { role: "user", content: `时间第${year}年${month}月${day}日。骗局：${scam.name}。诱饵：${scam.bait}。结果：${spotted ? "玩家识破，无损失，谈略进。" : `玩家中招，损失${loss}文。`}请写全过程。` },
  ], mode, apiKey);
  return String(content || (spotted ? `你识破了${scam.name}。` : `你中了${scam.name}，损失${loss}文。`)).trim().slice(0, 420);
}

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function dateKey(parts) { return `${parts.year}-${parts.month}-${parts.day}`; }
