export const INDUSTRIES = [
  {
    id: "cooked_cake",
    name: "熟食摊（炊饼）",
    tool: { name: "担炉炊具", price: 280 },
    batchCostRange: [55, 90],
    unitName: "炊饼",
    unitsPerBatch: 12,
    make: { enabled: true, minutes: 120, stamina: 15, text: "每批2小时，体力-15；晨做午卖是正路。" },
    loss: { kind: "same_day_discount", text: "当日未售暮时贱卖半价或自食补饱。" },
    baseMargin: 0.45,
    customers: "赶早脚夫、庙前香客、瓦子听戏人，爱热、爱足秤，也记得住摊主脸面。",
    channels: ["sun_regular", "zhou_transfer", "private_salt"],
  },
  {
    id: "fresh_fish_veg",
    name: "鱼鲜果蔬贩",
    tool: { name: "挑担鱼篓", price: 120 },
    batchCostRange: [70, 130],
    unitName: "鲜货挑",
    unitsPerBatch: 10,
    make: { enabled: false, minutes: 0, stamina: 0, text: "无制作，纯周转。" },
    loss: { kind: "fresh", text: "当日未售折半，次日清零。" },
    baseMargin: 0.35,
    customers: "灶下采买的妇人、食肆小厮、贪早新鲜的街坊。",
    channels: ["feng_regular", "morning_market", "night_boat"],
  },
  {
    id: "used_clothes",
    name: "估衣贩",
    tool: { name: "包袱货架", price: 60 },
    batchCostRange: [80, 180],
    unitName: "旧衣件",
    unitsPerBatch: 6,
    make: { enabled: false, minutes: 0, stamina: 0, text: "无损耗，但压本钱。" },
    loss: { kind: "none", text: "不腐不坏，只占本钱与担子。" },
    baseMargin: 0.5,
    customers: "换季穷户、初来临安的脚夫、要体面又拿不出整钱的人。",
    channels: ["bai_regular", "street_collect", "qian_stolen"],
  },
];

const INDUSTRY_BY_ID = new Map(INDUSTRIES.map((industry) => [industry.id, industry]));

export function getIndustry(industryId) {
  return INDUSTRY_BY_ID.get(industryId) ?? null;
}

export function getIndustryToolNames() {
  return INDUSTRIES.map((industry) => industry.tool.name);
}

export function getProficiencyBand(value = 0) {
  if (value < 30) return { text: "生手", factor: 0.8 };
  if (value >= 70) return { text: "老手", factor: 1.2 };
  return { text: "熟门", factor: 1 };
}
