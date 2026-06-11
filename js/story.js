import { callDeepSeek } from "./api.js";
import { getDateParts, getMinuteOfDay, getPeriod } from "./clock.js";
import { describeHealth, describeSatiety, describeStamina, getCurrentAge } from "./player.js";
import { getLocation } from "./world.js";
import { auditAndApplyStoryChanges, sanitizeCrimeReport, setAuditFinalApplied } from "./guard.js";
import { getRecentMemories, rememberStory } from "./memory.js";
import { applyDebtUpdates, applyNpcUpdates, getPlayerDebtLines, getPresentNpcs, isNpcKnown } from "./npcs.js";
import { PRICE_ANCHORS } from "./economy.js";
import { describeIllnesses } from "./illness.js";
import { getRumors } from "./worldtick.js";
import { grantNarrativeItem, hasItem, removeNarrativeItem } from "./items.js";
import { gainSkill, getSkillSummary } from "./skills.js";
import { getIdentityContext, getIdentitySystemPromptRule } from "./identity.js";
import { getClimateText } from "./season.js";
import { hasJieCredit } from "./scholar.js";
import { getFestivalContext, getNightMarketContext } from "./festival.js";
import { getLaborContext } from "./labor.js";
import { getBusinessContext } from "./business.js";
import { getRippleText } from "./neighborchain.js";
import { SUPPLIERS, getSupplierCard } from "./suppliers.js";
import { buildFallbackCrimeReport, landCrimeReport, precheckCrimeAction } from "./crime.js";
import { getJusticeContext } from "./justice.js";

const SYSTEM_PROMPT = `你是南宋淳熙年间临安城的世界模拟器，负责根据玩家行动生成接下来真实发生的事。
世界真实运转，不围着玩家转。玩家是普通人，他的身份决定他能触碰什么。
玩家尝试超出身份的事（如乞儿求见知府），不要拒绝，生成符合现实的失败过程。
玩家可以尝试任何世界观内的行为，世界按现实逻辑回应——包括最坏的回应。只有物理不可能、跳出宋代世界观的输入，才返回 {"rejected": true}。
在场人物列表里的人是真实存在的居民，按其性格处境行动，不认识玩家时就当陌生人对待。逝者可以被回忆与谈起，但不得复活、不得出现在现场。
不在列表里的人可以临时虚构（路人、小贩），但他们没有记忆，不要赋予重要戏份。
玩家行动若提到不在场的核心NPC（去找某人但他不在此地此时），如实生成“找不到人”的结果。
物价锚点：粗饭一顿10文，像样一顿30文，力夫日薪约100文，租屋月租450文，租屋押金200文，看病抓药100-500文，一两银=1000文。一切涉及钱的叙事必须符合这些物价。
NPC的钱是有限的：拮据者拿不出几十文，借钱、施舍、payment必须符合其生计状况。
玩家与NPC之间发生借贷时，如实通过debt_updates记录。
人们以衣观人，衣着决定你在体面场所受到的对待。
${getIdentitySystemPromptRule()}
风闻是城中正在发生的背景，可自然织入叙事，但玩家无力改变这些大势。人随日子往前走，旧事塑造人物的态度与处境，但NPC不主动反复提起，除非玩家问起或情境强相关。
除夕/元旦等年节是写尽底层孤独的时刻，不滥情，只写灯火与无家者之间的冷暖差。
AI可让玩家能力小幅成长，用skill_gain；师承达成用mentor_unlock；可发放叙事物品item_grant或移除叙事物品item_remove。
做生意的叙事要有市井烟火气，客人是一个个具体的人，不是数字；供应、行老、雇工与同行轻量NPC只在进货、出摊、行会、雇佣等相关时露面，不进入核心NPC编制。铺主身份的叙事中，玩家已是市井中有头脸的人物，但在士人与官面眼里仍是商贾——门第的天花板换了一层，没有消失。
罪行叙事写实克制，呈现行为与代价，不渲染不美化。若额外上下文给出“高风险行动前置判定”，此结果是代码既定事实，AI只能叙述，不得推翻。玩家可能数月按部就班地生活，叙事再开时应自然衔接时间跨度。
叙事要求：白话文言风格、克制、具体、不抒情堆砌，每次100-250字，写“发生了什么”而非“感受如何”。
严格只输出JSON，格式如下：
{
  "rejected": false,
  "scene": "故事文字",
  "memory": "一句话提炼本次发生的事",
  "duration_minutes": 行动耗时（5-240整数）,
  "state_changes": {
    "copper": 整数, "silver": 整数, "satiety": 整数,
    "stamina": 整数, "health": 整数,
    "injury_add": "伤病名或null", "injury_remove": "伤病名或null"
  },
  "npc_updates": [
    { "id": "npc的id",
      "relation_delta": { "favor": 整数, "trust": 整数, "doubt": 整数 },
      "cash_delta": 整数,
      "memory": "这个NPC会记住的一句话",
      "impression": "更新后的一句话印象（无明显变化则省略）" }
  ],
  "debt_updates": [{ "npc_id": "npc的id", "direction": "player_owes或npc_owes", "amount_delta": 整数, "note": "一句话" }],
  "skill_gain": {"skill":"wen|wu|suan|tan","amount":1},
  "mentor_unlock": "wen|wu|suan",
  "item_grant": {"name":"物品名","desc":"描述"},
  "item_remove": "物品名",
  "crime_report": { "type": "窃盗/抢夺/斗殴伤人/欺诈/杀人/纵火/销赃", "severity": 1-5, "witnesses": ["在场NPC id"], "anonymous_witnesses": 0-3 }
}
state_changes、npc_updates和debt_updates里没变化的字段省略。`;

export async function runStoryAction(state, actionText, apiKey, mode, extraContext = "") {
  const context = buildStoryContext(state, actionText, extraContext);
  const content = await callDeepSeek(buildMessages(context), mode, apiKey);
  const result = parseStoryResult(content);

  if (result.rejected) {
    return {
      rejected: true,
      scene: result.scene || "这件事不合此世道理，未曾发生。",
      durationMinutes: 0,
      appliedChanges: {},
      npcUpdates: [],
    };
  }

  const scene = String(result.scene || "街巷间无甚波澜，此事草草过去。").trim();
  const durationMinutes = clampInteger(result.duration_minutes, 5, 240, 30);
  const applied = auditAndApplyStoryChanges(
    state,
    result.state_changes ?? {},
    result.npc_updates ?? [],
    result.debt_updates ?? [],
    scene,
    context.presentNpcs.map((npc) => npc.id),
    result.skill_gain ?? null,
    result.mentor_unlock ?? "",
    result.item_grant ?? null,
    result.item_remove ?? "",
  );
  applyDebtUpdates(state.npcs, applied.debtUpdates, formatClockForDebt(state.clock));
  const alreadyHadMentor = applied.mentorUnlock ? Boolean(state.player.mentorUnlocks[applied.mentorUnlock]) : false;
  const mentorUnlocked = Boolean(applied.mentorUnlock);
  if (mentorUnlocked) state.player.mentorUnlocks[applied.mentorUnlock] = true;
  const actualSkillGain = applied.skillGain
    ? gainSkill(state.player, applied.skillGain.skill, applied.skillGain.amount, context.dateKey)
    : 0;
  const alreadyHadItem = applied.itemGrant ? hasItem(state.player, applied.itemGrant.name) : false;
  const grantedItem = applied.itemGrant ? grantNarrativeItem(state.player, applied.itemGrant) : null;
  const removedItem = applied.itemRemove ? removeNarrativeItem(state.player, applied.itemRemove) : false;
  const crimeReport = sanitizeCrimeReport(result.crime_report, context.presentNpcs.map((npc) => npc.id)) || (context.crimePrecheck ? buildFallbackCrimeReport(context.crimePrecheck) : null);
  const landedCrime = landCrimeReport(state, crimeReport, {
    precheck: context.crimePrecheck,
    dateText: `第${context.clockParts.year}年${context.clockParts.month}月${context.clockParts.day}日`,
    ordinal: datePartsToOrdinal(context.clockParts),
    locationId: context.location.id,
  });
  await applyNpcUpdates(state.npcs, applied.npcUpdates, state.clock, apiKey);
  setAuditFinalApplied(state, applied.auditEntry, {
    state_changes: applied.finalStateChanges,
    npc_updates: applied.npcUpdates,
    debt_updates: applied.debtUpdates,
    skill_gain: actualSkillGain > 0 ? { skill: applied.skillGain.skill, amount: actualSkillGain } : null,
    mentor_unlock: mentorUnlocked && !alreadyHadMentor ? applied.mentorUnlock : "",
    item_grant: grantedItem && !alreadyHadItem ? applied.itemGrant : null,
    item_remove: removedItem ? applied.itemRemove : "",
    crime_report: landedCrime ? { id: landedCrime.id, type: landedCrime.type, severity: landedCrime.severity } : null,
  });
  await rememberStory(state.player, state.clock, result.memory || scene.slice(0, 60), apiKey);

  return {
    rejected: false,
    scene,
    durationMinutes,
    appliedChanges: applied.stateChanges,
    npcUpdates: applied.npcUpdates,
    debtUpdates: applied.debtUpdates,
    skillGain: applied.skillGain,
    mentorUnlock: applied.mentorUnlock,
    itemGrant: applied.itemGrant,
    itemRemove: applied.itemRemove,
    crimeReport: landedCrime,
  };
}

function buildMessages(context) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context.userContent },
  ];
}

function buildStoryContext(state, actionText, extraContext = "") {
  const { year, month, day } = getDateParts(state.clock);
  const minuteOfDay = getMinuteOfDay(state.clock);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const period = getPeriod(minuteOfDay);
  const location = getLocation(state.player.location);
  const memories = getRecentMemories(state.player, 5);
  const presentNpcs = getPresentNpcs(state.npcs, location.id, period);
  const debtLines = getPlayerDebtLines(state.npcs);
  const dateKey = `${year}-${month}-${day}`;
  const itemNames = state.player.inventory.length > 0 ? state.player.inventory.map((item) => item.name).join("、") : "无";
  const rumors = getRumors(state.world);
  const injuries = Array.isArray(state.player.injuries) && state.player.injuries.length > 0
    ? state.player.injuries.join("、")
    : "无";
  const festivalContext = getFestivalContext({ year, month, day });
  const nightMarketContext = getNightMarketContext(location.id, period);
  const laborContext = getLaborContext(state.player, festivalContext.text || getClimateText(month));
  const rippleText = getRippleText(state.world, location.id);
  const supplierContext = SUPPLIERS.filter((supplier) => actionText.includes(supplier.name)).map((supplier) => getSupplierCard(state, supplier.id)).join("\n");
  const crimePrecheck = precheckCrimeAction(state, actionText, presentNpcs);

  return {
    presentNpcs,
    crimePrecheck,
    clockParts: { year, month, day },
    location,
    dateKey,
    userContent: `当前时间：第${year}年${month}月${day}日，${period}，${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}，季节：${getSeason(month)}。
当前位置：${location.name}。${location.description}${rippleText ? ` ${rippleText}` : ""}
主角状态：${getIdentityContext(state.player)}；${getBusinessContext(state)}；${getJusticeContext(state)}${laborContext ? `；${laborContext}` : ""}${state.player.officialRisk ? `；官面风险有案底影子（仅叙事）` : ""}；年龄：${Math.floor(getCurrentAge(state.player, state.clock.elapsedMinutes))}岁；身体状况：${describeHealth(state.player.health)}，${describeSatiety(state.player.satiety)}，${describeStamina(state.player.stamina)}；疾病与将养：${describeIllnesses(state.player)}；能力：${getSkillSummary(state.player.skills)}；衣着：${state.player.clothing}；整洁：${getCleanlinessText(state.player.cleanliness)}；随身物品：${itemNames}；钱财：铜钱${Math.floor(state.player.coins)}文，银两${state.player.silver}，会子${state.player.huizi}；住所：${state.player.housing}；欠债/被欠：${debtLines.length > 0 ? debtLines.join("、") : "无"}；当前伤病：${injuries}。
季节气候：${festivalContext.text || getClimateText(month)}。${nightMarketContext ? `\n${nightMarketContext}` : ""}
物价锚点：${Object.entries(PRICE_ANCHORS).map(([name, price]) => `${name}${price}`).join("；")}。
最近记忆：${memories.length > 0 ? memories.map((memory) => `${memory.date}：${memory.text}`).join("；") : "无"}。
近日城中风闻：${rumors.length > 0 ? rumors.join("；") : "无"}
在场人物：${formatPresentNpcs(presentNpcs, state.player, { year, month, day })}
系统补充：骗局叙事要按宋代市井骗术的真实手法写，过程可信，不漫画化。${state.player.begging?.mode === "join" ? "玩家有丐籍之人标签，衙门书吏路线身份观感受损；办附籍打点费更重。" : ""}${state.player.gambling?.redEyeUntil === dateKey ? "玩家昨日关扑输红了眼，今日叙事可带急躁赌性。" : ""}\n${supplierContext ? `供应轻量NPC：${supplierContext}\n` : ""}${crimePrecheck ? `犯罪前置：${crimePrecheck.contextText}\n` : ""}${extraContext ? `额外上下文：${extraContext}\n` : ""}玩家本次行动原文：${actionText}`,
  };
}

function formatPresentNpcs(presentNpcs, player = null, clockParts = null) {
  if (presentNpcs.length === 0) return "无核心NPC在场。";
  const creditRule = player && hasJieCredit(player) ? "｜借贷信用提示：玩家得解或曾得解，NPC若性格不相斥，借钱意愿应较普通贫民上调。" : "";
  return presentNpcs.map((npc) => {
    const ageText = Number.isFinite(npc.age) && clockParts ? `约${npc.age + clockParts.year - 1}岁` : `约${npc.age ?? "?"}岁`;
    const npcMemories = getRecentNpcMemories(npc.memories, clockParts).map((memory) => `${memory.date}：${memory.text}`).join("；");
    const memoryText = isNpcKnown(npc) && npcMemories ? npcMemories : "与玩家素不相识";
    const debtText = npc.debts?.length > 0
      ? npc.debts.map((debt) => `${debt.withPlayer === "player_owes" ? "玩家欠此人" : "此人欠玩家"}${debt.amount}文（${debt.note}）`).join("；")
      : "无债务";
    return `${npc.name}｜${ageText}｜${npc.identity}｜${npc.personality}｜${npc.situation}｜${npc.impression}｜${memoryText}｜生计状况：${npc.assets.status}，${npc.assets.incomeSource}｜与玩家债务：${debtText}${creditRule}`;
  }).join("\n");
}

function parseStoryResult(content) {
  const jsonText = extractJson(content);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error("AI返回不是有效JSON。请重试。");
  }
}

function extractJson(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

function getSeason(month) {
  if (month >= 1 && month <= 3) return "春";
  if (month >= 4 && month <= 6) return "夏";
  if (month >= 7 && month <= 9) return "秋";
  return "冬";
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function datePartsToOrdinal({ year, month, day }) {
  return (year - 1) * 360 + (month - 1) * 30 + day;
}

function formatClockForDebt(clock) {
  const { year, month, day } = getDateParts(clock);
  return `第${year}年${month}月${day}日`;
}

function getCleanlinessText(value) {
  if (value < 25) return "蓬头垢面";
  if (value < 50) return "风尘仆仆";
  if (value <= 80) return "还算干净";
  return "清爽整洁";
}

function getRecentNpcMemories(memories = [], parts = null) {
  if (!parts) return memories.slice(-3);
  const now = (parts.year - 1) * 360 + (parts.month - 1) * 30 + parts.day;
  return memories.filter((memory) => {
    const match = String(memory.date).match(/第(\d+)年(\d+)月(\d+)日/);
    if (!match) return false;
    const then = (Number(match[1]) - 1) * 360 + (Number(match[2]) - 1) * 30 + Number(match[3]);
    return now - then <= 30;
  }).slice(-5);
}
