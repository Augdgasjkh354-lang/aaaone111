const SKILL_KEYS = ["wen", "wu", "suan", "tan"];
const SELF_STUDY_CAPS = { wen: 30, wu: 30, suan: 25, tan: 0 };

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
  const mentorCap = player.mentorUnlocks?.[skill] ? { wen: 70, wu: 70, suan: 60 }[skill] : null;
  return mentorCap ?? SELF_STUDY_CAPS[skill] ?? 30;
}

export function canUnlockMentor(skill, npcs) {
  if (skill === "wen") return (npcs.find((npc) => npc.id === "mr_wu")?.relation?.trust ?? 0) >= 25;
  if (skill === "wu") return (npcs.find((npc) => npc.id === "chen_si")?.relation?.trust ?? 0) >= 30;
  if (skill === "suan") return (npcs.find((npc) => npc.id === "liu_mazi")?.relation?.favor ?? 0) >= 20;
  return false;
}

export function gainSkill(player, skill, amount, dateKey) {
  if (!SKILL_KEYS.includes(skill)) return false;
  player.dailySkillGains = normalizeDailySkillGains(player.dailySkillGains);
  if (player.dailySkillGains.dateKey !== dateKey) {
    player.dailySkillGains = { dateKey, wen: 0, wu: 0, suan: 0, tan: 0 };
  }
  const cappedAmount = Math.min(1, Math.max(0, Number.parseInt(amount, 10) || 0));
  if (cappedAmount <= 0 || player.dailySkillGains[skill] >= 3) return false;

  const roomToday = 3 - player.dailySkillGains[skill];
  const gain = Math.min(cappedAmount, roomToday);
  const cap = getSkillCap(skill, player);
  const before = player.skills[skill];
  player.skills[skill] = Math.min(cap, before + gain);
  const actual = player.skills[skill] - before;
  player.dailySkillGains[skill] += actual;
  return actual > 0;
}

export function getStudyOptions(state) {
  return [
    {
      id: "study_wen",
      name: "认字自习",
      skill: "wen",
      durationMinutes: 120,
      staminaCost: 8,
      available: state.player.inventory.some((item) => item.name === "旧书"),
      reason: "需要旧书",
      cap: 30,
    },
    { id: "study_wu", name: "练拳", skill: "wu", durationMinutes: 120, staminaCost: 20, available: true, reason: "", cap: 30 },
    { id: "study_suan", name: "学着记账", skill: "suan", durationMinutes: 120, staminaCost: 10, available: true, reason: "", cap: 25 },
  ].map((option) => ({
    ...option,
    available: option.available && state.player.skills[option.skill] < option.cap,
    reason: option.available ? (state.player.skills[option.skill] >= option.cap ? "自习已到上限" : "") : option.reason,
  }));
}

export function clampSkill(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}
