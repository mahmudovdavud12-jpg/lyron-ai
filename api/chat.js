
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Yalnız POST sorğusu qəbul edilir."
    });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const model = process.env.OPENROUTER_MODEL || "openrouter/free";

    if (!apiKey || !supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        error: "Server parametrləri tapılmadı. Vercel dəyişənlərini yoxlayın."
      });
    }

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body || {});

    const {
      message = "",
      history = [],
      mode = "text",
      image = null
    } = body;

    const validImage =
      image === null ||
      (
        typeof image === "string" &&
        image.length <= 4000000 &&
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
      );

    if (
      typeof message !== "string" ||
      message.length > 4000 ||
      (!message.trim() && !image) ||
      !Array.isArray(history) ||
      !["text", "voice"].includes(mode) ||
      !validImage
    ) {
      return res.status(400).json({
        error: "Mesaj və ya şəkil düzgün deyil. PNG, JPG və WEBP formatından istifadə edin."
      });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "Davam etmək üçün hesabınıza daxil olun."
      });
    }

    const baseUrl = supabaseUrl.replace(/\/$/, "");

    // İstifadəçi sessiyasını təsdiqlə
    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "Sessiya etibarsızdır. Yenidən daxil olun."
      });
    }

    const user = await authResponse.json();

    if (!user || !user.id) {
      return res.status(401).json({
        error: "İstifadəçi hesabı təsdiqlənmədi."
      });
    }

    // İstifadəçinin yalnız öz uzunmüddətli yaddaşını oxu
    let memories = [];

    const memoryUrl = new URL(
      `${baseUrl}/rest/v1/lyron_profile_memory`
    );

    memoryUrl.searchParams.set("select", "content,created_at");
    memoryUrl.searchParams.set("user_id", `eq.${user.id}`);
    memoryUrl.searchParams.set("order", "created_at.desc");
    memoryUrl.searchParams.set("limit", "30");

    const memoryResponse = await fetch(memoryUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (memoryResponse.ok) {
      memories = await memoryResponse.json();
    } else {
      console.error("Memory read error:", await memoryResponse.text());
    }

    const memoryText = memories
      .map(item => item.content)
      .filter(Boolean)
      .join("\n");

    const languageInstruction = mode === "voice"
      ? `
SƏS REJİMİ — AZƏRBAYCAN DİLİ:
1. Bütün cavablarını Azərbaycan dilində ver.
2. Azərbaycan ədəbi dilindən istifadə et.
3. Cümlələri danışıq üçün təbii və aydın qur.
4. Türkiyə türkcəsinə keçmə.
5. Cavabları səsli oxunuşa uyğun yaz.
`
      : `
YAZIŞMA REJİMİ — AZƏRBAYCAN DİLİ:
1. Bütün cavablarını Azərbaycan dilində yaz.
2. Azərbaycan ədəbi dilinin qaydalarına əməl et.
3. ə, ı, ö, ü, ş, ç, ğ hərflərini düzgün işlət.
4. Türkiyə türkcəsinin sözlərini Azərbaycan dilinə qarışdırma.
5. Təbii, səlis və aydın danış.
`;

    const systemPrompt = `
Sən LYRON AI adlı müasir süni intellekt köməkçisisən.

${languageInstruction}

ÜMUMİ DAVRANIŞ:
- Adın LYRON AI-dir.
- Özünü başqa süni intellekt adlandırma.
- Sualın mahiyyətinə birbaşa cavab ver.
- Robotik ifadələrdən qaç.
- İstifadəçi ilə səmimi və hörmətli danış.
- Mürəkkəb mövzuları anlaşıqlı izah et.
- İstifadəçinin yaşına uyğun, təhlükəsiz cavablar ver.
- Məlumat uydurma.
- Bilmədiyin məsələlərdə bunu açıq bildir.
- İstifadəçinin şəxsi məlumatlarını istəmə və lazımsız yerə təkrar etmə.

ŞƏKİL ANALİZİ:
- İstifadəçi şəkil göndərdikdə onu diqqətlə analiz et.
- Görünən obyektləri və detalları təsvir et.
- Şəkil haqqında verilən suallara konkret cavab ver.
- Görünməyən detalları uydurma.
- Əmin olmadığın obyektləri ehtimal kimi təqdim et.
- Şəkildə mətn varsa, oxuna bildiyi qədər köçür.
- Şəkli analiz edə bilmədikdə bunu açıq bildir.

YADDAŞ:
Aşağıdakı məlumatlar istifadəçi haqqında əvvəl saxlanılmış faktlardır.
Onlardan yalnız cavabları uyğunlaşdırmaq üçün istifadə et.
Yaddaşda olmayan məlumatları uydurma.

İSTİFADƏÇİNİN UZUNMÜDDƏTLİ YADDAŞI:
${memoryText || "Hələ yadda saxlanılmış məlumat yoxdur."}
`;

    // Tarixçəni yoxla və təhlükəsiz formada hazırla
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

    // İstifadəçinin mesajını hazırla
    const userContent = [];

    userContent.push({
      type: "text",
      text: message.trim() ||
        "Zəhmət olmasa, göndərdiyim şəkli diqqətlə analiz et."
    });

    if (image) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: image
        }
      });
    }

    // OpenRouter AI sorğusu
    const aiResponse = await fetch(
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
          model,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...safeHistory,
            {
              role: "user",
              content: userContent
            }
          ],
          temperature: 0.5,
          max_tokens: 1600
        })
      }
    );

    const aiRaw = await aiResponse.text();

    let aiData;

    try {
      aiData = JSON.parse(aiRaw);
    } catch {
      console.error("Invalid OpenRouter response:", aiRaw.slice(0, 1000));

      return res.status(502).json({
        error: "AI xidmətindən düzgün cavab alınmadı. Bir az sonra yenidən yoxlayın."
      });
    }

    if (!aiResponse.ok) {
      console.error("OpenRouter error:", aiData);

      const apiMessage = aiData.error?.message || "";

      if (image && /image|vision|modalit|endpoint/i.test(apiMessage)) {
        return res.status(502).json({
          error: "Hazırda şəkil analizini dəstəkləyən pulsuz AI modeli tapılmadı. Bir az sonra yenidən yoxlayın."
        });
      }

      return res.status(502).json({
        error: "AI xidmətində müvəqqəti problem yarandı. Bir az sonra yenidən cəhd edin."
      });
    }

    const answer = aiData.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({
        error: "AI boş cavab qaytardı. Yenidən cəhd edin."
      });
    }

    // Uzunmüddətli yaddaş üçün təhlükəsiz fakt seçimi
    // Yalnız mətn mesajlarında işləyir.
    // Həssas məlumatların saxlanmasına icazə verilmir.
    if (message.trim() && !image && memories.length < 30) {
      try {
        const recentUserMessages = safeHistory
          .filter(item => item.role === "user")
          .slice(-5)
          .map(item => item.content);

        recentUserMessages.push(message.trim());

        const extractionResponse = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "system",
                  content: `
Sən LYRON AI yaddaş köməkçisisən.

İstifadəçinin gələcək söhbətlərdə faydalı ola biləcək davamlı layihə və ünsiyyət seçimlərini müəyyən et.

Qaydalar:
- Yalnız istifadəçinin açıq şəkildə dediyi məlumatları seç.
- Təxmin etmə.
- Şifrə, API açarı, ünvan və maliyyə məlumatlarını saxlama.
- Sağlamlıq, din, siyasi baxış, cinsi həyat və digər həssas məlumatları saxlama.
- Keçici məlumatları və salamlaşmaları saxlama.
- Maksimum 2 qısa fakt qaytar.
- Cavab yalnız JSON massivi olsun.
- Saxlanılacaq məlumat yoxdursa [] qaytar.
`
                },
                {
                  role: "user",
                  content: JSON.stringify(recentUserMessages)
                }
              ],
              temperature: 0.1,
              max_tokens: 200
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

          if (Array.isArray(facts)) {
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
              .slice(0, Math.min(2, 30 - memories.length));

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
    }

    return res.status(200).json({
      answer: answer.trim(),
      mode,
      imageAnalyzed: Boolean(image)
    });

  } catch (error) {
    console.error("LYRON server error:", error);

    return res.status(500).json({
      error: "Daxili server xətası baş verdi. Bir az sonra yenidən yoxlayın."
    });
  }
}
