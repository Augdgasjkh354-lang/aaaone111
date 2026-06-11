const FESTIVALS = [
  { id: "new_year", name: "元旦", month: 1, day: 1, duration: 3, rumor: "元旦三日，临安各家换桃符、饮屠苏，富户门前也多几勺热粥。", lonely: true },
  { id: "lantern", name: "元宵", month: 1, day: 15, duration: 5, rumor: "元宵灯市开到御街深处，鳌山灯影照着买卖声，瓦子通宵不歇。" },
  { id: "hanshi", name: "寒食清明", month: 3, day: 3, duration: 3, rumor: "寒食清明相连，城外扫坟人多，冷食担子与纸钱铺都忙起来。" },
  { id: "duanwu", name: "端午", month: 5, day: 5, duration: 3, rumor: "端午临水处竞渡声急，角黍、艾草与雄黄酒味混在街风里。" },
  { id: "zhongyuan", name: "中元", month: 7, day: 15, duration: 3, rumor: "中元夜有人放河灯，水面星火慢慢漂过，桥上看灯的人不肯散。" },
  { id: "mid_autumn", name: "中秋", month: 8, day: 15, duration: 3, rumor: "中秋前后饼铺忙到夜里，酒楼凭栏赏月，贫巷也借一点桂香。" },
  { id: "winter_solstice", name: "冬至", month: 11, day: 22, duration: 3, rumor: "冬至大如年，街上馄饨热气白腾腾，寒人都盼一口热汤。" },
  { id: "new_year_eve", name: "除夕", month: 12, day: 29, duration: 2, rumor: "除夕爆竹从御街响到巷尾，守岁人家灯火不灭，无家者更觉街长。", lonely: true },
];

export function getActiveFestival(dateParts) {
  return FESTIVALS.find((festival) => isInFestival(dateParts, festival)) ?? null;
}

export function getFestivalContext(dateParts) {
  const festival = getActiveFestival(dateParts);
  if (!festival) return { festival: null, text: "" };
  const lonely = festival.lonely ? "年节是写尽底层孤独的时刻，不滥情，只写灯火与无家者之间的冷暖差。" : "";
  return { festival, text: `节庆氛围：${festival.name}期间，临安风俗正盛；施舍增多，夜市与临时帮闲也更活。${lonely}` };
}

export function dailyFestivalTick(world, dateParts) {
  const festival = getActiveFestival(dateParts);
  if (!festival || !isFirstDay(dateParts, festival)) return;
  world.activeEvents = Array.isArray(world.activeEvents) ? world.activeEvents : [];
  const id = `festival_${festival.id}_${dateParts.year}`;
  if (world.activeEvents.some((event) => event.id === id)) return;
  world.activeEvents.push({ id, name: festival.name, text: festival.rumor, remainingDays: festival.duration, hook: { festival: 1 } });
}

export function isFestivalGamblingLegal(dateParts, locationId) {
  return Boolean(getActiveFestival(dateParts)) || locationId === "wazi";
}

export function isNightMarket(locationId, period) {
  return period === "夜" && ["imperial_street", "wazi", "qinghefang"].includes(locationId);
}

export function getNightMarketContext(locationId, period) {
  return isNightMarket(locationId, period) ? "夜市活跃：临安夜市不闭，灯火、食担、酒旗与瓦子声色直到深夜，收益与风险都更高。" : "";
}

function isInFestival(dateParts, festival) {
  const start = dayOfYear(festival.month, festival.day);
  const current = dayOfYear(dateParts.month, dateParts.day);
  return current >= start && current < start + festival.duration;
}

function isFirstDay(dateParts, festival) {
  return dateParts.month === festival.month && dateParts.day === festival.day;
}

function dayOfYear(month, day) {
  return (month - 1) * 30 + day;
}
