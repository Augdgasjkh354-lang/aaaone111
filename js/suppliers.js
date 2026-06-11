export const SUPPLIERS = [
  {
    id: "sun_laoguan",
    name: "孙老倌",
    industryId: "cooked_cake",
    channelType: "米市粮行管事",
    personality: "认量，你常买大宗，他的relation涨得快。",
    location: "rice_market",
  },
  {
    id: "feng_hanglao",
    name: "冯行老",
    industryId: "fresh_fish_veg",
    channelType: "码头鱼行行头",
    personality: "守行规，生人爱答不理，需引荐或日久。",
    location: "dock",
  },
  {
    id: "bai_zhanggui",
    name: "白掌柜",
    industryId: "used_clothes",
    channelType: "清河坊故衣行东家",
    personality: "精明和气，给现钱的都是朋友。",
    location: "qinghefang",
  },
];

export function normalizeSuppliers(saved = {}) {
  const byId = saved && typeof saved === "object" ? saved : {};
  return Object.fromEntries(SUPPLIERS.map((supplier) => {
    const current = byId[supplier.id] ?? {};
    return [supplier.id, {
      relation: clampRelation(current.relation ?? 25),
      memory: Array.isArray(current.memory) ? current.memory.filter((item) => typeof item === "string").slice(-3) : [],
    }];
  }));
}

export function getSupplier(supplierId) {
  return SUPPLIERS.find((supplier) => supplier.id === supplierId) ?? null;
}

export function getSupplierCard(state, supplierId) {
  const supplier = getSupplier(supplierId);
  if (!supplier) return "";
  const saved = state.player.business?.suppliers?.[supplierId] ?? { relation: 25, memory: [] };
  return `${supplier.name}｜${supplier.channelType}｜${supplier.personality}｜关系${saved.relation}/100｜近事：${saved.memory.length ? saved.memory.join("；") : "无"}`;
}

export function getRelationPriceFactor(relation = 0) {
  if (relation < 20) return 1.1;
  if (relation < 50) return 1;
  if (relation < 80) return 0.92;
  return 0.85;
}

export function getRelationPriceName(relation = 0) {
  if (relation < 20) return "生人价";
  if (relation < 50) return "熟客价";
  if (relation < 80) return "老主顾价";
  return "自己人价";
}

export function changeSupplierRelation(player, supplierId, delta, memory = "") {
  player.business.suppliers = normalizeSuppliers(player.business.suppliers);
  const entry = player.business.suppliers[supplierId];
  if (!entry) return;
  entry.relation = clampRelation(entry.relation + delta);
  if (memory) entry.memory = [...entry.memory, memory].slice(-3);
}

function clampRelation(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
