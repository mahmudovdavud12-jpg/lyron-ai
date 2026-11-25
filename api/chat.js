
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
        error: "Server parametrləri tapılmadı."
      });
    }

    const {
      message,
      history = [],
      mode = "text"
    } = req.body || {};

    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 4000 ||
      !Array.isArray(history) ||
      !["text", "voice"].includes(mode)
    ) {
      return res.status(400).json({
        error: "Mesaj düzgün deyil."
      });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "Davam etmək üçün hesaba daxil olun."
      });
    }

    const baseUrl = supabaseUrl.replace(/\/$/, "");

    const authResponse = await fetch(
      `${baseUrl}/auth/v1/user`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "Sessiya etibarsızdır. Yenidən daxil olun."
      });
    }

    const user = await authResponse.json();

    // Uzunmüddətli yaddaş
    let memories = [];

    const memoryResponse = await fetch(
      `${baseUrl}/rest/v1/lyron_profile_memory?select=content,created_at&order=created_at.desc&limit=30`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (memoryResponse.ok) {
      memories = await memoryResponse.json();
    } else {
      console.error(
        "Memory read error:",
        await memoryResponse.text()
      );
    }

    const memoryText = memories
      .map(item => item.content)
      .filter(Boolean)
      .join("\n");

    // Rejimə uyğun sistem təlimatı
    const languageInstruction = mode === "voice"
      ? `
SƏS REJİMİ — TÜRKİYƏ TÜRKÇƏSİ:

1. Bütün cavablarını Türkiyə türkcəsində yaz.
2. İstanbul türkcəsinin təbii və düzgün qrammatikasından istifadə et.
3. Azərbaycan dilinə keçmə.
4. Cavablarını danışıq üçün uyğun, aydın və təbii qur.
5. Lazımsız uzun cümlələrdən qaç.
6. İstifadəçi ilə səmimi və hörmətli danış.
7. Cavablarını türk dilində səsləndirilməyə uyğun yaz.
`
      : `
YAZIŞMA REJİMİ — AZƏRBAYCAN DİLİ:

1. Bütün cavablarını Azərbaycan dilində yaz.
2. Azərbaycan ədəbi dilinin qrammatika və orfoqrafiya qaydalarına əməl et.
3. ə, ı, ö, ü, ş, ç, ğ hərflərini düzgün işlət.
4. Türkiyə türkcəsinin sözlərini Azərbaycan dilinə qarışdırma.
5. Təbii, səlis, aydın və düzgün danış.
6. İstifadəçinin yazı səhvlərini təkrarlama.
7. İstifadəçi başqa dil istəmədikcə Azərbaycan dilində cavab ver.
`;

    const systemPrompt = `
Sən LYRON AI adlı müasir süni intellekt köməkçisisən.

${languageInstruction}

ÜMUMİ DAVRANIŞ:
- Adın LYRON AI-dir.
- Özünü başqa süni intellekt adlandırma.
- Sualın mahiyyətinə birbaşa cavab ver.
- Robotik və süni ifadələrdən qaç.
- İstifadəçi ilə səmimi, hörmətli və təbii danış.
- Mürəkkəb mövzuları anlaşıqlı izah et.
- İstifadəçinin yaşına uyğun, təhlükəsiz cavablar ver.
- Məlumat uydurma.
- Bilmədiyin məsələlərdə bunu açıq bildir.

YADDAŞ:
Aşağıdakı məlumatlar istifadəçi haqqında saxlanılmış faktlardır.
Onlardan cavabları uyğunlaşdırmaq üçün istifadə et.
Yaddaşda olmayan məlumatları uydurma.

İSTİFADƏÇİNİN UZUNMÜDDƏTLİ YADDAŞI:
${memoryText || "Hələ yadda saxlanılmış məlumat yoxdur."}
`;

    const safeHistory = history
      .slice(-10)
      .filter(item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      )
      .map(item => ({
        role: item.role,
        content: item.content.slice(0, 4000)
      }));

    // Əsas AI cavabı
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lyron-ai-henna.vercel.app",
          "X-Title": "LYRON AI"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...safeHistory,
            {
              role: "user",
              content: message.trim()
            }
          ],
          temperature: 0.4,
          max_tokens: 900
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

    if (!answer || typeof answer !== "string") {
      return res.status(502).json({
        error: "AI boş cavab qaytardı."
      });
    }

    // Uzunmüddətli yaddaşın yenilənməsi
    try {
      const userMessages = history
        .filter(item =>
          item &&
          item.role === "user" &&
          typeof item.content === "string"
        )
        .slice(-5)
        .map(item => item.content);

      userMessages.push(message.trim());

      const extractionResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "openrouter/free",
            messages: [
              {
                role: "system",
                content: `
Sən LYRON AI yaddaş köməkçisisən.

İstifadəçinin açıq şəkildə bildirdiyi davamlı və gələcəkdə faydalı olacaq faktları seç.

Qaydalar:
- Yalnız istifadəçinin özünün dediyi məlumatları seç.
- Təxmin etmə və məlumat uydurma.
- Layihələri, məqsədləri və ünsiyyət seçimlərini seçə bilərsən.
- Şifrə, API açarı, ünvan və maliyyə məlumatlarını saxlama.
- Sağlamlıq, din, siyasi baxış, cinsi həyat və digər həssas məlumatları saxlama.
- Keçici məlumatları və salamlaşmaları saxlama.
- Maksimum 3 qısa fakt qaytar.
- Cavab yalnız JSON massivi olsun.
- Saxlanılacaq məlumat yoxdursa, [] qaytar.

Nümunə:
["İstifadəçi LYRON AI layihəsi üzərində işləyir."]
`
              },
              {
                role: "user",
                content: JSON.stringify(userMessages)
              }
            ],
            temperature: 0.1,
            max_tokens: 250
          })
        }
      );

      if (extractionResponse.ok) {
        const extractionData = await extractionResponse.json();

        let extracted =
          extractionData.choices?.[0]?.message?.content || "[]";

        extracted = extracted
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();

        const facts = JSON.parse(extracted);

        if (Array.isArray(facts) && memories.length < 30) {
          const existing = new Set(
            memories.map(item =>
              String(item.content).toLowerCase().trim()
            )
          );

          const newFacts = facts
            .filter(fact =>
              typeof fact === "string" &&
              fact.trim().length > 0 &&
              fact.length <= 300 &&
              !existing.has(fact.toLowerCase().trim())
            )
            .slice(0, Math.min(3, 30 - memories.length));

          if (newFacts.length > 0) {
            const saveResponse = await fetch(
              `${baseUrl}/rest/v1/lyron_profile_memory`,
              {
                method: "POST",
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal"
                },
                body: JSON.stringify(
                  newFacts.map(content => ({
                    user_id: user.id,
                    content: content.trim()
                  }))
                )
              }
            );

            if (!saveResponse.ok) {
              console.error(
                "Memory save error:",
                await saveResponse.text()
              );
            }
          }
        }
      }
    } catch (memoryError) {
      console.error("Memory extraction error:", memoryError);
    }

    return res.status(200).json({
      answer,
      mode
    });

  } catch (error) {
    console.error("LYRON error:", error);

    return res.status(500).json({
      error: "Daxili server xətası baş verdi."
    });
  }
}
