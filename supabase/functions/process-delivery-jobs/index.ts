// يرسل رسائل التذكير المعلّقة في delivery_jobs (template = meeting_reminder) عبر البريد والواتساب والرسائل النصية، وإشعارات القرارات (template = decision_notice) عبر البريد فقط.
// لم يُجرَّب مع مزوّدي الخدمة الفعليين: راجع واجهات كل مزوّد (Resend, WhatsApp Cloud API, Taqnyat) قبل الاعتماد عليه.
//
// الأسرار المطلوبة (supabase secrets set ...):
//   CRON_SECRET                      سر مشترك لاستدعاء الدالة من الجدولة
//   RESEND_API_KEY, EMAIL_FROM       البريد عبر Resend (مثال EMAIL_FROM: "منصة الاجتماعات <no-reply@yourdomain.sa>")
//   WHATSAPP_PROVIDER                مزوّد الواتساب: meta (الافتراضي، الرسمي) أو openwa (غير رسمي، ذاتي الاستضافة)
//     عند meta:   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (افتراضي meeting_reminder)
//     عند openwa: OPENWA_URL (مثل https://wa.example.org)، OPENWA_API_KEY، OPENWA_SESSION_ID
//                 اختياري: OPENWA_DELAY_MS (فاصل بين الرسائل، افتراضي 4000)، OPENWA_MAX_PER_RUN (افتراضي 15)
//   TAQNYAT_API_KEY, SMS_SENDER      الرسائل النصية عبر Taqnyat
// القناة التي لا تُضبط أسرارها تُعلَّم failed ولا تعطّل القنوات الأخرى.
//
// قالب واتساب المعتمد من Meta يجب أن يحتوي 3 متغيرات بالترتيب: {{1}} عنوان الاجتماع، {{2}} التاريخ، {{3}} الوقت.
// OpenWA يرسل نصًا حرًا بلا قوالب لكنه غير رسمي وفيه خطر حظر الرقم؛ اقرأ التحذيرات في README قبل تفعيله.
//
// النشر: supabase functions deploy process-delivery-jobs --no-verify-jwt   (التحقق يتم داخل الدالة)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type, apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Job = { id: string; channel: "email" | "whatsapp" | "sms"; recipient: string; template: string; payload: Record<string, any> };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// أرقام الجوال: نحوّل الصيغ السعودية الشائعة إلى 9665XXXXXXXX
function phone(raw: string): string {
  let d = String(raw).replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
  else if (d.startsWith("5") && d.length === 9) d = "966" + d;
  return d;
}

function body(p: Record<string, any>) {
  const lines = [`تذكير باجتماع: ${p.title ?? ""}`, `التاريخ: ${p.date ?? ""}`];
  if (p.time) lines.push(`الوقت: ${String(p.time).slice(0, 5)}`);
  if (p.location) lines.push(`المكان: ${p.location}`);
  if (p.url) lines.push(`الرابط: ${p.url}`);
  return lines.join("\n");
}

async function sendEmail(j: Job) {
  if (!env("RESEND_API_KEY") || !env("EMAIL_FROM")) throw new Error("إعدادات البريد غير مكتملة");
  const p = j.payload, isDecision = j.template === "decision_notice";
  const text = isDecision ? `${p.title ?? ""}
${p.body ?? ""}` : body(p);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("EMAIL_FROM"), to: [j.recipient], subject: isDecision ? String(p.title ?? "إشعار قرار") : `تذكير: ${p.title ?? "اجتماع"}`, text,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8">${esc(text).replace(/\n/g, "<br>")}</div>`,
    }),
  });
  if (!r.ok) throw new Error(`email ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// مزوّد الواتساب يُختار بالإعداد WHATSAPP_PROVIDER؛ أي قيمة غير معروفة تُرفض بدل الرجوع بصمت لمزوّد آخر
const waProvider = () => (env("WHATSAPP_PROVIDER") || "meta").trim().toLowerCase();

async function sendWhatsapp(j: Job) {
  const p = waProvider();
  if (p === "meta") return sendWhatsappMeta(j);
  if (p === "openwa") return sendWhatsappOpenWA(j);
  throw new Error(`WHATSAPP_PROVIDER غير معروف: ${p} (القيم: meta, openwa)`);
}

// OpenWA: POST {OPENWA_URL}/api/sessions/{sessionId}/messages/send-text  ترويسة X-API-Key  الجسم {chatId, text}
// chatId بصيغة 9665XXXXXXXX@c.us. المسار والحقول من README المشروع؛ راجع Swagger في /api/docs لإصدارك قبل الاعتماد عليه.
async function sendWhatsappOpenWA(j: Job) {
  const base = env("OPENWA_URL").trim().replace(/\/+$/, "");
  if (!base || !env("OPENWA_API_KEY") || !env("OPENWA_SESSION_ID")) throw new Error("إعدادات OpenWA غير مكتملة");
  let origin: string;
  try { origin = new URL(base).origin; } catch { throw new Error("OPENWA_URL غير صالح"); }
  const number = phone(j.recipient);
  if (!/^\d{9,15}$/.test(number)) throw new Error("رقم الجوال غير صالح لواتساب");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${origin}/api/sessions/${encodeURIComponent(env("OPENWA_SESSION_ID"))}/messages/send-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": env("OPENWA_API_KEY") },
      body: JSON.stringify({ chatId: `${number}@c.us`, text: body(j.payload) }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`openwa ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsappMeta(j: Job) {
  if (!env("WHATSAPP_TOKEN") || !env("WHATSAPP_PHONE_ID")) throw new Error("إعدادات واتساب غير مكتملة");
  const p = j.payload;
  const r = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: phone(j.recipient), type: "template",
      template: {
        name: env("WHATSAPP_TEMPLATE") || "meeting_reminder", language: { code: "ar" },
        components: [{ type: "body", parameters: [
          { type: "text", text: String(p.title ?? "") }, { type: "text", text: String(p.date ?? "") }, { type: "text", text: String(p.time ?? "").slice(0, 5) || "-" },
        ] }],
      },
    }),
  });
  if (!r.ok) throw new Error(`whatsapp ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function sendSms(j: Job) {
  if (!env("TAQNYAT_API_KEY") || !env("SMS_SENDER")) throw new Error("إعدادات الرسائل النصية غير مكتملة");
  const r = await fetch("https://api.taqnyat.sa/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("TAQNYAT_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipients: [phone(j.recipient)], body: body(j.payload), sender: env("SMS_SENDER") }),
  });
  if (!r.ok) throw new Error(`sms ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

const senders = { email: sendEmail, whatsapp: sendWhatsapp, sms: sendSms } as const;

async function authorized(req: Request): Promise<boolean> {
  const secret = env("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  // مستخدم مسجّل: يجب أن يكون مديرًا (الدالة is_admin من الترحيل 001)
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await user.rpc("is_admin");
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  const { data: jobs, error } = await admin
    .from("delivery_jobs").select("id,channel,recipient,template,payload")
    .eq("status", "pending").in("template", ["meeting_reminder", "decision_notice"]).in("channel", ["email", "whatsapp", "sms"])
    .lte("scheduled_for", new Date().toISOString()).order("scheduled_for").limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0, deferred = 0, openwaSent = 0;
  const viaOpenWA = waProvider() === "openwa";
  const maxOpenWA = Math.max(1, Number(env("OPENWA_MAX_PER_RUN")) || 15);
  const delayMs = Math.max(0, Number(env("OPENWA_DELAY_MS")) || 4000);
  for (const job of (jobs ?? []) as Job[]) {
    const isOpenWA = viaOpenWA && job.channel === "whatsapp";
    if (isOpenWA) {
      // OpenWA غير رسمي: نبطئ الإرسال ونحدّد العدد في كل دورة لتقليل خطر الحظر؛ ما زاد يبقى pending للدورة التالية
      if (openwaSent >= maxOpenWA) { deferred++; continue; }
      if (openwaSent > 0) await new Promise((r) => setTimeout(r, delayMs + Math.floor(Math.random() * 1500)));
    }
    try {
      await senders[job.channel](job);
      if (isOpenWA) openwaSent++;
      await admin.from("delivery_jobs").update({ status: "sent" }).eq("id", job.id);
      sent++;
    } catch (e) {
      console.error(job.id, job.channel, (e as Error).message);
      if (isOpenWA) openwaSent++; // المحاولة الفاشلة تُحتسب أيضًا حتى لا نُغرق الجلسة
      await admin.from("delivery_jobs").update({ status: "failed" }).eq("id", job.id);
      failed++;
    }
  }
  return json({ processed: sent + failed, sent, failed, deferred, whatsapp_provider: waProvider() });
});
