# إعداد إرسال التذكيرات

لم يُجرَّب هذا الإعداد على حسابات مزوّدي الخدمة الفعلية؛ ابدأ بحسابك أنت كمستلم.

## 1) الأسرار
```bash
supabase secrets set CRON_SECRET=<نص عشوائي طويل>
supabase secrets set RESEND_API_KEY=... EMAIL_FROM="منصة الاجتماعات <no-reply@yourdomain.sa>"
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_TEMPLATE=meeting_reminder
supabase secrets set TAQNYAT_API_KEY=... SMS_SENDER=<اسم المرسل المعتمد>
```
- **البريد:** يجب توثيق نطاق المرسل لدى Resend.
- **واتساب (مزوّدان يُختار بينهما بالإعداد `WHATSAPP_PROVIDER`، والافتراضي `meta`):**
  - `meta` (الرسمي، الموصى به): يلزم قالب رسالة معتمد من Meta باسم `meeting_reminder` بثلاثة متغيرات: {{1}} العنوان، {{2}} التاريخ، {{3}} الوقت. لا يُسمح بنص حر خارج نافذة 24 ساعة.
  - `openwa` (غير رسمي): انظر القسم "OpenWA" أدناه.
- **الرسائل النصية:** تحتاج اسم مرسل (Sender ID) معتمدًا لدى مزوّدك. المثال يستخدم Taqnyat؛ لمزوّد آخر عدّل `sendSms` في `index.ts`.

### OpenWA (اختياري، غير رسمي)
[OpenWA](https://github.com/rmyndharis/OpenWA) بوابة واتساب ذاتية الاستضافة تربط رقمًا بمسح QR وترسل نصًا حرًا بلا قوالب. **غير تابعة لـ Meta وتخالف شروط واتساب؛ فيها خطر حظر الرقم.** استخدمها فقط لتذكيرات غير حساسة لأعضاء موافقين، وبرقم مخصص يمكن خسارته، وأبقِ البريد والرسائل النصية احتياطًا.
```bash
supabase secrets set WHATSAPP_PROVIDER=openwa
supabase secrets set OPENWA_URL=https://wa.yourdomain.sa OPENWA_API_KEY=... OPENWA_SESSION_ID=<معرّف الجلسة>
# اختياري
supabase secrets set OPENWA_DELAY_MS=4000 OPENWA_MAX_PER_RUN=15
```
- **الإعداد في OpenWA:** شغّله بـ Docker على خادم خاص، أنشئ جلسة (`POST /api/sessions`) وابدأها (`POST /api/sessions/{id}/start`) وامسح QR من `GET /api/sessions/{id}/qr`. استخدم مفتاح API محصورًا بالجلسة إن أمكن، وضع الخدمة خلف HTTPS وقيّد الوصول بعنوان Supabase إن استطعت.
- **المسار المستخدم:** `POST {OPENWA_URL}/api/sessions/{sessionId}/messages/send-text` بترويسة `X-API-Key` وجسم `{"chatId":"9665XXXXXXXX@c.us","text":"..."}`. أُخذ من README المشروع ولم يُجرَّب هنا، فتأكد من Swagger (`/api/docs`) لإصدارك.
- **تخفيف الخطر:** الدالة تفصل بين الرسائل `OPENWA_DELAY_MS` (+ عشوائي حتى 1.5 ثانية) وترسل حتى `OPENWA_MAX_PER_RUN` رسائل واتساب في كل دورة (5 دقائق)، والباقي يبقى `pending` للدورة التالية. فعّل أيضًا إبطاء الإرسال داخل OpenWA نفسه (معطّل افتراضيًا).
- **التبديل:** للعودة إلى Meta غيّر `WHATSAPP_PROVIDER` إلى `meta` (أو احذفه). لا تغيير في بقية المنصة؛ رسائل الانتظار تُرسل بالمزوّد الجديد في الدورة التالية.
- استجابة الدالة تتضمن `whatsapp_provider` وعدد `deferred` (المؤجَّل بسبب الحد).
- **الإرسال المؤجَّل:** رسائل واتساب المتراكمة تتقدّم في الطابور على غيرها (الترتيب بالأقدم)، فقد تتأخر رسائل البريد والنصية المجدولة لاحقًا حتى يُفرَّغ تراكم واتساب.

## 2) النشر
```bash
supabase functions deploy process-delivery-jobs --no-verify-jwt
```
`--no-verify-jwt` لأن الاستدعاء من الجدولة يستخدم `x-cron-secret`، والتحقق يتم داخل الدالة (سر الجدولة أو مستخدم مدير).

## 3) الجدولة (كل 5 دقائق)
فعّل `pg_cron` و`pg_net` من Database ▸ Extensions، ثم نفّذ (بعد استبدال القيم). يُفضَّل حفظ السر في Vault لا في نص الأمر:
```sql
select cron.schedule('process-delivery-jobs', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/process-delivery-jobs',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb);
$$);
```
المولّد `generate_meeting_reminders()` يُجدول تلقائيًا كل 15 دقيقة من الترحيل 005.

## 4) اختبار سريع
1. أنشئ اجتماعًا بعد ساعة، وفعّل "قبل الموعد بساعة" على قناة البريد لنفسك.
2. نفّذ `select public.generate_meeting_reminders();` ثم `select * from delivery_jobs order by 1 desc limit 5;`
3. استدعِ الدالة يدويًا بـ `curl -X POST -H "x-cron-secret: <CRON_SECRET>" https://<ref>.supabase.co/functions/v1/process-delivery-jobs`.

## ملاحظات
- المعالجة تتم بدفعات من 50 رسالة، وإن تداخل استدعاءان قد تُرسل رسالة مرتين؛ اترك الفاصل 5 دقائق ولا تجعل الدالة تُستدعى بالتوازي.
- الرسالة الفاشلة تُعلَّم `failed` ولا تُعاد تلقائيًا. السبب في سجلات الدالة.
- الدالة تعالج قالب `meeting_reminder` فقط؛ دعوات الاجتماع القديمة ما زالت تُعالج بالدوال الأقدم (`send-email-job`, `send-whatsapp-job`).
