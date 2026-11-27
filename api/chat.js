
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

    // Əvvəlki profil yaddaşını oxuyuruq.
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
4. Cümlələri canlı, səlis və gündəlik danışığa uyğun qur.
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
- Lazımsız dekorativ simvollar və emojilər əlavə etmə.
- Siyahı lazım olduqda sadə nömrələmədən istifadə et.
- Mətnin oxunaqlılığını qoru.

ÜMUMİ DAVRANIŞ:
- Adın LYRON AI-dir.
- Özünü başqa süni intellekt adlandırma.
- Sualın mahiyyətinə birbaşa cavab ver.
- Robotik ifadələrdən qaç.
- Hörmətli və təbii danış.
- Hər cavabı lazımsız yerə uzatma.
- Mürəkkəb mövzuları anlaşıqlı izah et.
- İstifadəçinin yaşına uyğun təhlükəsiz cavablar ver.
- Məlumat uydurma.
- Bilmədiyin məsələlərdə bunu açıq bildir.
- Şəxsi məlumatları lazımsız yerə istəmə.

ŞƏKİL ANALİZİ:
- Göndərilən şəkli diqqətlə analiz et.
- Görünən obyektləri və detalları təsvir et.
- Şəkil haqqında suallara konkret cavab ver.
- Görünməyən detalları uydurma.
- Əmin olmadığın obyektləri ehtimal kimi təqdim et.
- Şəkildəki oxuna bilən mətni izah et.
- Şəkli analiz edə bilmədikdə bunu açıq bildir.

YADDAŞ:
Aşağıdakı məlumatlar əvvəl saxlanılmış faktlardır.
Onlardan yalnız cavabları uyğunlaşdırmaq üçün istifadə et.
Yaddaşda olmayan məlumatları uydurma.

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

    // Əsas AI sorğusu.
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
          temperature: 0.65,
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

    // Cavabı ikinci AI sorğusu gözləmədən qaytarırıq.
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
