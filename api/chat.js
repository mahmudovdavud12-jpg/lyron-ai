
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnız POST sorğusu qəbul edilir."
    });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "AI API açarı tapılmadı."
      });
    }

    const { message, history = [] } = req.body || {};

    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 4000 ||
      !Array.isArray(history)
    ) {
      return res.status(400).json({
        error: "Mesaj düzgün deyil."
      });
    }

    const messages = [
      {
        role: "system",
        content:
          "Sən LYRON AI adlı süni intellekt köməkçisisən. Azərbaycan dilində aydın, təbii və faydalı cavab ver. Özünü LYRON AI kimi təqdim et. İstifadəçinin sualına birbaşa cavab ver."
      },
      ...history.slice(-10).filter(
        item =>
          item &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string"
      ),
      {
        role: "user",
        content: message.trim()
      }
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lyron-ai-henna.vercel.app",
          "X-Title": "LYRON AI"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages,
          temperature: 0.7,
          max_tokens: 700
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", data);

      return res.status(502).json({
        error: "AI xidmətindən cavab almaq mümkün olmadı."
      });
    }

    const answer = data.choices?.[0]?.message?.content;

    if (!answer) {
      return res.status(502).json({
        error: "AI boş cavab qaytardı."
      });
    }

    return res.status(200).json({
      answer
    });

  } catch (error) {
    console.error("LYRON error:", error);

    return res.status(500).json({
      error: "Daxili server xətası baş verdi."
    });
  }
}
