// أدوات مشتركة لصفحة الاختبار: تشغيل ملفات SQL على قاعدة PGlite جديدة
window.runFile = async (path) => {
  const t = await (await fetch(path + '?x=' + Date.now(), {cache: 'reload'})).text();
  try { await window.pg.exec(t); return 'OK ' + path; }
  catch (e) { return 'FAIL ' + path + ' :: ' + e.message + (e.position ? ' @' + e.position : ''); }
};
window.q = async (sql, params = []) => { try { return (await window.pg.query(sql, params)).rows; } catch (e) { return 'ERR ' + e.message; } };
window.BASE = ['/tests/prelude.sql', '/supabase/migrations/001_voting_signing_hardening.sql', '/supabase/migrations/002_platform_settings.sql', '/supabase/migrations/003_member_space.sql',
  '/supabase/migrations/004_governance_development.sql', '/supabase/migrations/005_meeting_reminders.sql', '/supabase/migrations/006_platform_banners.sql', '/supabase/migrations/007_decisions_core.sql', '/supabase/migrations/008_decisions_alerts_kpis.sql'];
window.resetDb = async (files = window.BASE, opts = {}) => {
  await window.ready;
  window.pg = new window.PGlite(opts); await window.pg.waitReady;
  const out = [];
  for (const f of files) { const r = await window.runFile(f); out.push(r); if (r.startsWith('FAIL')) break; }
  return out.join('\n');
};
