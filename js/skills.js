const SKILL_KEYS = ["wen", "wu", "suan", "tan"];
const SELF_STUDY_CAPS = { wen: 30, wu: 30, suan: 25, tan: 0 };
const WEN_PROGRESS_REQUIREMENTS = [
  { min: 71, points: 8 },
  { min: 51, points: 5 },
  { min: 31, points: 3 },
  { min: 0, points: 1 },
];

export function normalizeSkills(savedSkills = {}) {
  return {
    wen: clampSkill(savedSkills.wen ?? savedSkills.literacy ?? 0),
    wu: clampSkill(savedSkills.wu ?? 0),
    suan: clampSkill(savedSkills.suan ?? 0),
    tan: clampSkill(savedSkills.tan ?? 0),
  };
}

export function normalizeMentors(savedMentors = {}) {
  return {
    wen: Boolean(savedMentors.wen),
    wu: Boolean(savedMentors.wu),
    suan: Boolean(savedMentors.suan),
  };
}

export function normalizeDailySkillGains(saved = {}) {
  return {
    dateKey: typeof saved.dateKey === "string" ? saved.dateKey : "",
    wen: Number.isFinite(saved.wen) ? saved.wen : 0,
    wu: Number.isFinite(saved.wu) ? saved.wu : 0,
    suan: Number.isFinite(saved.suan) ? saved.suan : 0,
    tan: Number.isFinite(saved.tan) ? saved.tan : 0,
  };
}

export function normalizeSkillProgress(saved = {}) {
  return {
    wen: Number.isFinite(saved.wen) ? Math.max(0, saved.wen) : 0,
  };
}

export function getSkillLabel(skill, value) {
  const v = clampSkill(value);
  if (skill === "wen") {
    if (v < 25) return "目不识丁";
    if (v < 50) return "粗通文墨";
    if (v < 75) return "能读会写";
    return "通晓文章";
  }
  if (skill === "wu") {
    if (v < 25) return "手脚虚浮";
    if (v < 50) return "粗有力气";
    if (v < 75) return "拳脚扎实";
    return "身手老练";
  }
  if (skill === "suan") {
    if (v < 25) return "不谙账目";
    if (v < 50) return "会算小账";
    if (v < 75) return "账目清楚";
    return "精于盘算";
  }
  if (v < 25) return "拙于言辞";
  if (v < 50) return "能应场面";
  if (v < 75) return "善于周旋";
  return "言辞老到";
}

export function getSkillSummary(skills) {
  return `文：${getSkillLabel("wen", skills.wen)}；武：${getSkillLabel("wu", skills.wu)}；算：${getSkillLabel("suan", skills.suan)}；谈：${getSkillLabel("tan", skills.tan)}`;
}

export function getSkillCap(skill, player) {
  if (skill === "tan") return 100;
  if (skill === "wen" && player.scholar?.academyStudent) return 90;
  const mentorCap = player.mentorUnlocks?.[skill] ? { wen: 70, wu: 70, suan: 60 }[skill] : null;
  return mentorCap ?? SELF_STUDY_CAPS[skill] ?? 30;
}

export function canUnlockMentor(skill, npcs) {
  if (skill === "wen") return false;
  if (skill === "wu") return (npcs.find((npc) => npc.id === "chen_si")?.relation?.trust ?? 0) >= 30;
  if (skill === "suan") return (npcs.find((npc) => npc.id === "liu_mazi")?.relation?.favor ?? 0) >= 20;
  return false;
}

export function gainSkill(player, skill, amount, dateKey, options = {}) {
  if (!SKILL_KEYS.includes(skill)) return 0;
  player.dailySkillGains = normalizeDailySkillGains(player.dailySkillGains);
  player.skillProgress = normalizeSkillProgress(player.skillProgress);
  if (player.dailySkillGains.dateKey !== dateKey) {
    player.dailySkillGains = { dateKey, wen: 0, wu: 0, suan: 0, tan: 0 };
  }
  const cappedAmount = Math.min(1, Math.max(0, Number.parseInt(amount, 10) || 0));
  if (cappedAmount <= 0 || player.dailySkillGains[skill] >= 3) return 0;

  const roomToday = 3 - player.dailySkillGains[skill];
  const rawPoints = Math.min(cappedAmount, roomToday) * (Number.isFinite(options.multiplier) ? options.multiplier : 1);
  const cap = getSkillCap(skill, player);
  if (player.skills[skill] >= cap) return 0;

  if (skill !== "wen") {
    const before = player.skills[skill];
    player.skills[skill] = Math.min(cap, before + Math.floor(rawPoints));
    const actual = player.skills[skill] - before;
    player.dailySkillGains[skill] += actual;
    return actual;
  }

  player.skillProgress.wen += rawPoints;
  let gained = 0;
  while (player.skills.wen < cap && player.skillProgress.wen >= getWenPointsRequired(player.skills.wen + 1)) {
    player.skillProgress.wen -= getWenPointsRequired(player.skills.wen + 1);
    player.skills.wen += 1;
    gained += 1;
    if (gained >= roomToday) break;
  }
  player.dailySkillGains.wen += 1;
  return gained;
}

export function getWenPointsRequired(nextValue) {
  return WEN_PROGRESS_REQUIREMENTS.find((rule) => nextValue >= rule.min)?.points ?? 1;
}

export function getStudyOptions(state) {
  const hasOldBook = state.player.inventory.some((item) => item.name === "旧书");
  const hasClassic = state.player.inventory.some((item) => item.name === "经书");
  const inAcademy = state.player.location === "academy";
  const academyAccess = Boolean(state.player.scholar?.auditing || state.player.scholar?.academyStudent);
  const wenCap = getSkillCap("wen", state.player);
  const wenValue = state.player.skills.wen;
  const highWenNeedsAcademy = wenValue >= 50;
  const wenAvailable = hasOldBook && (!highWenNeedsAcademy || (inAcademy && academyAccess && hasClassic));
  const wenReason = !hasOldBook ? "需要旧书" : highWenNeedsAcademy && !inAcademy ? "文51以上须在书院修习" : highWenNeedsAcademy && !academyAccess ? "需书院旁听或正学资格" : highWenNeedsAcademy && !hasClassic ? "文51以上须持经书" : "";
  return [
    { id: "study_wen", name: inAcademy ? "书院修文" : "认字自习", skill: "wen", durationMinutes: 120, staminaCost: 8, available: wenAvailable, reason: wenReason, cap: wenCap },
    { id: "study_wu", name: "练拳", skill: "wu", durationMinutes: 120, staminaCost: 20, available: true, reason: "", cap: getSkillCap("wu", state.player) },
    { id: "study_suan", name: "学着记账", skill: "suan", durationMinutes: 120, staminaCost: 10, available: true, reason: "", cap: getSkillCap("suan", state.player) },
  ].map((option) => ({
    ...option,
    available: option.available && state.player.skills[option.skill] < option.cap,
    reason: option.available ? (state.player.skills[option.skill] >= option.cap ? "修习已到上限" : "") : option.reason,
  }));
}

export function clampSkill(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}
