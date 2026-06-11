// 模型固定
const DS_MODEL = "deepseek-v4-flash";
const DS_URL = "https://api.deepseek.com/chat/completions";

// 三档思考模式
// 无思考：thinking disabled，可用temperature
// 思考：thinking enabled + reasoning_effort: "high"
// 最大思考：thinking enabled + reasoning_effort: "max"
// 注意：思考模式下temperature无效，不要传

// 多轮对话注意：返回的reasoning_content不能放回messages，只取content

export async function callDeepSeek(messages, mode = "disabled", apiKey) {
  const body = {
    model: DS_MODEL,
    messages,
    stream: false,
    max_tokens: 1000
  };

  if (mode === "disabled") {
    body.thinking = { type: "disabled" };
    body.temperature = 0.85;
  } else if (mode === "high") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "high";
  } else if (mode === "max") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "max";
  }

  const res = await fetch(DS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "HTTP " + res.status);
  }

  const data = await res.json();
  // 只返回content，reasoning_content不暴露给调用方
  return data.choices?.[0]?.message?.content || "";
}
