import { treatWithPatentMedicine } from "./illness.js";

export const CATALOG_ITEMS = [
  { id: "rough_clothes", name: "粗布旧衣", location: "qinghefang", vendor: "估衣铺", price: 150, type: "clothing", clothing: "粗布" },
  { id: "decent_clothes", name: "体面旧衣", location: "qinghefang", vendor: "估衣铺", price: 800, type: "clothing", clothing: "体面" },
  { id: "winter_clothes", name: "冬衣", location: "qinghefang", vendor: "估衣铺", price: 300, type: "catalog", desc: "御寒衣物" },
  { id: "old_book", name: "旧书", location: "qinghefang", vendor: "估衣铺", price: 100, type: "catalog", desc: "破旧书册" },
  { id: "classic_book", name: "经书", location: "academy", vendor: "书院斋舍", price: 800, type: "catalog", desc: "书院购得的经义课本" },
  { id: "raincoat", name: "蓑衣", location: "rice_market", vendor: "杂货", price: 50, type: "catalog", desc: "挡雨蓑衣" },
  { id: "pole_rope", name: "扁担麻绳", location: "rice_market", vendor: "杂货", price: 30, type: "catalog", desc: "扛包省力，码头工钱略增" },
  { id: "lantern", name: "灯笼", location: "rice_market", vendor: "杂货", price: 40, type: "catalog", desc: "夜路照明" },
  { id: "medicine", name: "伤药", location: "qinghefang", vendor: "药铺", price: 100, type: "medicine", desc: "可移除风寒或一项轻伤" },
  { id: "coal_basket", name: "一篮炭", location: "rice_market", vendor: "杂货", price: 30, type: "catalog", desc: "过冬取暖的炭" },
];

export function normalizeInventory(inventory = []) {
  return Array.isArray(inventory)
    ? inventory.filter((item) => item && typeof item.name === "string").map((item) => ({
      name: item.name.slice(0, 60),
      desc: typeof item.desc === "string" ? item.desc.slice(0, 60) : "",
      kind: item.kind === "随身物" ? "随身物" : "目录物品",
    }))
    : [];
}

export function normalizeClothing(clothing) {
  return ["褴褛", "粗布", "体面", "锦绣"].includes(clothing) ? clothing : "褴褛";
}

export function getPurchasableItems(locationId) {
  return CATALOG_ITEMS.filter((item) => item.location === locationId);
}

export function hasItem(player, name) {
  return player.inventory.some((item) => item.name === name);
}

export function purchaseItem(player, itemId) {
  const item = CATALOG_ITEMS.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: "没有这件东西。" };
  if (player.coins < item.price) return { ok: false, message: `买${item.name}需${item.price}文，钱不够。` };

  player.coins -= item.price;
  if (item.type === "clothing") {
    player.clothing = item.clothing;
    return { ok: true, message: `买下${item.name}，换上${item.clothing}衣着。` };
  }

  if (item.type === "medicine") {
    const removed = treatWithPatentMedicine(player) || removeAilment(player);
    if (!hasItem(player, item.name)) player.inventory.push({ name: item.name, desc: item.desc, kind: "目录物品" });
    return { ok: true, message: removed ? `用了伤药，除去了${removed}。` : "买下伤药收好。" };
  }

  if (!hasItem(player, item.name)) player.inventory.push({ name: item.name, desc: item.desc, kind: "目录物品" });
  return { ok: true, message: `买下${item.name}。` };
}

export function grantNarrativeItem(player, item) {
  const name = String(item?.name || "").trim().slice(0, 60);
  if (!name) return null;
  const desc = String(item?.desc || "随故事所得").trim().slice(0, 60);
  if (!hasItem(player, name)) player.inventory.push({ name, desc, kind: "随身物" });
  return { name, desc, kind: "随身物" };
}

export function removeNarrativeItem(player, name) {
  const target = String(name || "").trim();
  const before = player.inventory.length;
  player.inventory = player.inventory.filter((item) => !(item.kind === "随身物" && item.name === target));
  return player.inventory.length < before;
}

function removeAilment(player) {
  if (!Array.isArray(player.injuries) || player.injuries.length === 0) return "";
  const index = player.injuries.includes("风寒") ? player.injuries.indexOf("风寒") : 0;
  const [removed] = player.injuries.splice(index, 1);
  return removed;
}
