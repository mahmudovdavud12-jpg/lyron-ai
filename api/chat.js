
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Yalnız POST sorğusu qəbul edilir."
    });
  }

  try {
    const groqKey = process.env.GROQ_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const groqModel =
      process.env.GROQ_MODEL || "openai/gpt-oss-20b";

    const openRouterModel =
      process.env.OPENROUTER_MODEL || "openrouter/free";

    if (!openRouterKey || !supabaseUrl || !supabaseKey) {
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

    // SUPABASE YADDAŞI

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
SƏS REJİMİ — TÜRK DİLİ:
1. Bütün cavablarını Türkiyə türkcəsində ver.
2. İstanbul türkcəsinin təbii danışıq dilindən istifadə et.
3. Azərbaycan dilinə keçmə.
4. Cümlələri canlı və səlis qur.
5. Robotik ifadələrdən qaç.
6. Cavabları danışıqda rahat eşidiləcək şəkildə yaz.
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

MƏTN FORMATI:
- Cavablarını sadə mətn formasında yaz.
- Markdown formatından istifadə etmə.
- Lazımsız dekorativ simvollar əlavə etmə.
- Siyahı lazım olduqda sadə nömrələmədən istifadə et.

ÜMUMİ DAVRANIŞ:
- Adın LYRON AI-dir.
- Özünü başqa süni intellekt adlandırma.
- Sualın mahiyyətinə birbaşa cavab ver.
- Hörmətli və təbii danış.
- Hər cavabı lazımsız yerə uzatma.
- Mürəkkəb mövzuları anlaşıqlı izah et.
- Məlumat uydurma.
- Bilmədiyin məsələlərdə bunu açıq bildir.
- İstifadəçinin yaşına uyğun təhlükəsiz cavablar ver.

MODEL HAQQINDA:
- Özünü GPT-4, GPT-5 və ya başqa model adlandırma, əgər bu məlumat texniki olaraq təsdiqlənməyibsə.
- Sən LYRON AI köməkçisisən.
- İstifadəçi hansı modeldən istifadə etdiyini soruşduqda aşağıda verilən cari texniki məlumatdan istifadə et.
- Modelin adını və provayderini uydurma.

ŞƏKİL ANALİZİ:
- Göndərilən şəkli diqqətlə analiz et.
- Görünən detalları təsvir et.
- Görünməyən detalları uydurma.
- Əmin olmadığın obyektləri ehtimal kimi təqdim et.

YADDAŞ:
Aşağıdakı məlumatlar əvvəl saxlanılmış faktlardır.
Onlardan yalnız cavabları uyğunlaşdırmaq üçün istifadə et.

İSTİFADƏÇİNİN UZUNMÜDDƏTLİ YADDAŞI:
${memoryText || "Hələ yaddaşda saxlanılmış məlumat yoxdur."}
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

    const userContent = [
      {
        type: "text",
        text: message.trim() ||
          "Zəhmət olmasa, göndərdiyim şəkli diqqətlə analiz et."
      }
    ];

    if (image) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: image
        }
      });
    }

    // Hər provayder üçün düzgün model məlumatı.

    function buildMessages(provider, model) {
      const currentSystemPrompt = `
${systemPrompt}

CARİ TEXNİKİ MƏLUMAT:
Provayder: ${provider}
Sorğuda istifadə olunan model ID-si: ${model}

İstifadəçi model haqqında soruşarsa, bu məlumatı düzgün şəkildə bildir.
`;

      return [
        {
          role: "system",
          content: currentSystemPrompt
        },
        ...safeHistory,
        {
          role: "user",
          content: image ? userContent : message.trim()
        }
      ];
    }

    function extractAnswer(data) {
      const content = data.choices?.[0]?.message?.content;

      if (typeof content === "string") {
        return content.trim();
      }

      if (Array.isArray(content)) {
        return content
          .filter(item => item.type === "text")
          .map(item => item.text || "")
          .join("\n")
          .trim();
      }

      return "";
    }

    // 1. ƏSAS MODEL: GROQ

    if (groqKey && !image) {
      try {
        const groqResponse = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${groqKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: groqModel,
              messages: buildMessages("Groq", groqModel),
              temperature: 0.65,
              max_completion_tokens: 1600
            })
          }
        );

        const groqRaw = await groqResponse.text();

        let groqData;

        try {
          groqData = JSON.parse(groqRaw);
        } catch {
          throw new Error("Groq cavabı oxunmadı.");
        }

        if (!groqResponse.ok) {
          console.error("Groq error:", groqData);
          throw new Error("Groq müvəqqəti əlçatmazdır.");
        }

        const groqAnswer = extractAnswer(groqData);

        if (!groqAnswer) {
          throw new Error("Groq boş cavab qaytardı.");
        }

        console.log("LYRON provider: Groq | Model:", groqModel);

        return res.status(200).json({
          answer: groqAnswer,
          mode,
          imageAnalyzed: false,
          provider: "groq",
          model: groqModel
        });

      } catch (groqError) {
        console.error(
          "Groq failed, switching to OpenRouter:",
          groqError.message
        );
      }
    }

    // 2. EHTİYAT MODEL: OPENROUTER

    const openRouterResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lyron-ai-henna.vercel.app",
          "X-Title": "LYRON AI"
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: buildMessages("OpenRouter", openRouterModel),
          temperature: 0.65,
          max_tokens: 1600
        })
      }
    );

    const openRouterRaw = await openRouterResponse.text();

    let openRouterData;

    try {
      openRouterData = JSON.parse(openRouterRaw);
    } catch {
      console.error("Invalid OpenRouter response.");

      return res.status(502).json({
        error: "Ehtiyat AI xidmətindən düzgün cavab alınmadı."
      });
    }

    if (!openRouterResponse.ok) {
      console.error("OpenRouter error:", openRouterData);

      const apiMessage =
        openRouterData.error?.message || "";

      if (image && /image|vision|modalit|endpoint/i.test(apiMessage)) {
        return res.status(502).json({
          error: "Hazırda şəkil analizini dəstəkləyən pulsuz AI modeli tapılmadı."
        });
      }

      return res.status(502).json({
        error: "AI xidmətlərində müvəqqəti problem yarandı. Bir az sonra yenidən yoxlayın."
      });
    }

    const answer = extractAnswer(openRouterData);

    if (!answer) {
      return res.status(502).json({
        error: "AI boş cavab qaytardı. Yenidən cəhd edin."
      });
    }

    console.log("LYRON provider: OpenRouter | Model:", openRouterModel);

    return res.status(200).json({
      answer,
      mode,
      imageAnalyzed: Boolean(image),
      provider: "openrouter",
      model: openRouterModel
    });

  } catch (error) {
    console.error("LYRON server error:", error);

    return res.status(500).json({
      error: "Daxili server xətası baş verdi. Bir az sonra yenidən yoxlayın."
    });
  }
}
