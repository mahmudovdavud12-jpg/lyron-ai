
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnız POST sorğusu qəbul edilir."
    });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!apiKey || !supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: "Server parametrləri tam qurulmayıb."
      });
    }

    // İSTİFADƏÇİ SESSİYASINI YOXLAMAQ
    const authorization = req.headers.authorization || "";
    const accessToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "Daxil olmaq tələb olunur."
      });
    }

    const authResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${accessToken}`
        }
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "Sessiya etibarsızdır. Yenidən daxil olun."
      });
    }

    const user = await authResponse.json();

    if (!user || !user.id) {
      return res.status(401).json({
        error: "İstifadəçi təsdiqlənmədi."
      });
    }

    // GƏLƏN MƏLUMATLAR
    const {
      message,
      history = [],
      mode = "text",
      image = null
    } = req.body || {};

    if (typeof message !== "string" || (!message.trim() && !image)) {
      return res.status(400).json({
        error: "Mesaj və ya şəkil göndərilməlidir."
      });
    }

    if (message.length > 12000) {
      return res.status(400).json({
        error: "Mesaj çox uzundur."
      });
    }

    // ŞƏKİLİN YOXLAMASI
    if (image !== null) {
      if (
        typeof image !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(image)
      ) {
        return res.status(400).json({
          error: "Şəkil formatı dəstəklənmir."
        });
      }

      if (image.length > 4000000) {
        return res.status(413).json({
          error: "Şəkil çox böyükdür."
        });
      }
    }

    // SÖHBƏT TARİXÇƏSİ
    const safeHistory = Array.isArray(history)
      ? history
          .filter(item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          )
          .slice(-10)
          .map(item => ({
            role: item.role,
            content: item.content.slice(0, 12000)
          }))
      : [];

    // LYRON AI SİSTEM TƏLİMATI
    const systemPrompt = `
Sən LYRON AI adlı ağıllı virtual köməkçisən.

ƏSAS DAVRANIŞ QAYDALARI:

- İstifadəçi ilə səmimi, nəzakətli və təbii danış.
- Özünü LYRON AI kimi təqdim et.
- Cavablarını dəqiq, məntiqli və anlaşıqlı hazırla.
- İstifadəçinin sualını diqqətlə anla.
- Lazımsız uzun cavablardan qaç.
- Bilmədiyin məlumatı uydurma.
- Əmin olmadığın məsələlərdə bunu açıq bildir.
- Azərbaycan dilinin düzgün yazılış qaydalarına əməl et.
- İstifadəçi şəkil göndərdikdə şəkli diqqətlə analiz et.
- Şəkildə görünməyən detalları uydurma.
- İstifadəçi şəkil haqqında sual verirsə, konkret cavablandır.
- İstifadəçinin şəxsi məlumatlarını qorumağa diqqət et.

DİL REJİMİ:

${mode === "voice"
  ? "Səsli danışıq rejimindəsən. Cavablarını təbii TÜRK dilində ver."
  : "Adi rejimdəsən. Cavablarını Azərbaycan dilində ver."}

Sənin adın LYRON AI-dir.
`;

    // OPENROUTER MESAJLARI
    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...safeHistory
    ];

    // ŞƏKİLLİ VƏ YA ADİ MESAJ
    if (image) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: message || "Bu şəkli diqqətlə analiz et və təsvir et."
          },
          {
            type: "image_url",
            image_url: {
              url: image
            }
          }
        ]
      });
    } else {
      messages.push({
        role: "user",
        content: message
      });
    }

    // OPENROUTER SORĞUSU
    const aiResponse = await fetch(
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
          max_tokens: 1500
        })
      }
    );

    const responseText = await aiResponse.text();

    let aiData;

    try {
      aiData = JSON.parse(responseText);
    } catch {
      throw new Error("AI serverindən düzgün cavab alınmadı.");
    }

    if (!aiResponse.ok) {
      console.error("OpenRouter error:", aiData);

      throw new Error(
        aiData.error?.message ||
        "AI xidmətində müvəqqəti problem yarandı."
      );
    }

    const answer = aiData.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("AI boş cavab qaytardı.");
    }

    return res.status(200).json({
      answer: answer.trim()
    });

  } catch (error) {
    console.error("LYRON API error:", error);

    return res.status(500).json({
      error: error.message || "Naməlum server xətası."
    });
  }
}
