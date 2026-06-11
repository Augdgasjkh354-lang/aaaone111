import { callDeepSeek } from "./api.js";
import { formatClock } from "./clock.js";

const MAX_MEMORY_COUNT = 20;
const COMPRESSION_SOURCE_COUNT = 15;

export function normalizeMemories(savedMemories) {
  return Array.isArray(savedMemories) ? savedMemories.filter(isValidMemory).map((memory) => ({ ...memory, pivotal: Boolean(memory.pivotal) })) : [];
}

export function getRecentMemories(player, count = 5) {
  return normalizeMemories(player.memories).slice(-count);
}

export async function rememberStory(player, clock, memoryText, apiKey) {
  const text = String(memoryText || "").trim();
  if (!text) return;

  player.memories = normalizeMemories(player.memories);
  const { dateText, timeText } = formatClock(clock);
  player.memories.push({ date: `${dateText} ${timeText}`, text: text.slice(0, 120) });

  if (player.memories.length > MAX_MEMORY_COUNT) {
    await compressOldMemories(player, apiKey);
  }
}

async function compressOldMemories(player, apiKey) {
  if (!apiKey || player.memories.length <= MAX_MEMORY_COUNT) return;

  const oldMemories = player.memories.slice(0, COMPRESSION_SOURCE_COUNT);
  const remainingMemories = player.memories.slice(COMPRESSION_SOURCE_COUNT);
  const content = oldMemories.map((memory) => `${memory.date}：${memory.text}`).join("\n");

  try {
    const summary = await callDeepSeek([
      {
        role: "system",
        content: "你负责压缩南宋临安生存游戏的主角记忆。只输出一段不超过100字的中文总结，不要JSON，不要解释。",
      },
      { role: "user", content },
    ], "disabled", apiKey);

    const text = summary.trim().slice(0, 100);
    if (!text) return;
    const pivotal = player.memories.filter((memory) => memory.pivotal);
    player.memories = [...pivotal, { date: "早年记忆", text }, ...remainingMemories].slice(-MAX_MEMORY_COUNT);
  } catch (error) {
    console.warn("记忆压缩失败，将留待下次尝试。", error);
  }
}

function isValidMemory(memory) {
  return memory && typeof memory.date === "string" && typeof memory.text === "string";
}
