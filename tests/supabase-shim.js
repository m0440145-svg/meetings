// واجهة مصغّرة تحاكي supabase-js فوق PGlite (Postgres حقيقي) لتشغيل واجهات المنصة الفعلية مقابل الترحيلات الفعلية.
// تدعم: rpc بالأسماء، from().select/insert/update/delete مع eq/neq/in/gte/lte/is/order/limit/single/maybeSingle، وتخزين بسيط في الذاكرة.
// كل عملية تُنفَّذ بدور authenticated وبمعرّف المستخدم الحالي (RLS فعلية)، وتُسلسَل لأن الاتصال واحد.
window.makeShim = function (pg, getUid) {
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const files = new Map();
  const argNames = {};

  async function run(sql, params = []) {
    return serial(async () => {
      const uid = getUid();
      await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid || ''}',false)`);
      try { return {data: (await pg.query(sql, params)).rows, error: null}; }
      catch (e) { return {data: null, error: {message: e.message}}; }
      finally { await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
    });
  }
  const lit = v => Array.isArray(v) ? '{' + v.map(x => '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}' : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  const q = id => '"' + String(id).replace(/"/g, '""') + '"';

  class QB {
    constructor(table) { this.t = table; this.op = 'select'; this.cols = '*'; this.f = []; this.ord = []; this.lim = null; this.mode = 'many'; this.payload = null; this.ret = false; }
    select(c = '*') { if (this.op === 'select') this.cols = c; else this.ret = true; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(p) { this.op = 'insert'; this.payload = p; return this; }
    eq(c, v) { this.f.push([c, '=', v]); return this; } neq(c, v) { this.f.push([c, '<>', v]); return this; }
    gte(c, v) { this.f.push([c, '>=', v]); return this; } lte(c, v) { this.f.push([c, '<=', v]); return this; }
    in(c, v) { this.f.push([c, 'in', v]); return this; } is(c, v) { this.f.push([c, 'is', v]); return this; }
    order(c, o = {}) { this.ord.push(`${q(c)} ${o.ascending === false ? 'desc' : 'asc'}`); return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.mode = 'single'; return this; } maybeSingle() { this.mode = 'maybe'; return this; }
    where(params) {
      if (!this.f.length) return '';
      return ' where ' + this.f.map(([c, op, v]) => {
        if (op === 'in') { params.push(lit(v)); return `${q(c)}::text = any($${params.length}::text[])`; }
        if (op === 'is') return `${q(c)} is ${v === null ? 'null' : v}`;
        params.push(v); return `${q(c)} ${op} $${params.length}`;
      }).join(' and ');
    }
    async exec() {
      const params = []; let sql;
      if (this.op === 'select') {
        sql = `select ${this.cols === '*' ? '*' : this.cols.split(',').map(c => q(c.trim())).join(', ')} from public.${q(this.t)}${this.where(params)}${this.ord.length ? ' order by ' + this.ord.join(', ') : ''}${this.lim ? ' limit ' + this.lim : ''}`;
      } else if (this.op === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload], cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
        const vals = rows.map(r => '(' + cols.map(c => { params.push(r[c] === undefined ? null : lit(r[c])); return `$${params.length}`; }).join(', ') + ')').join(', ');
        sql = `insert into public.${q(this.t)} (${cols.map(q).join(', ')}) values ${vals} returning *`;
      } else if (this.op === 'update') {
        const sets = Object.entries(this.payload).map(([c, v]) => { params.push(v === undefined ? null : lit(v)); return `${q(c)} = $${params.length}`; }).join(', ');
        sql = `update public.${q(this.t)} set ${sets}${this.where(params)} returning *`;
      } else sql = `delete from public.${q(this.t)}${this.where(params)} returning *`;
      const r = await run(sql, params);
      if (r.error) return r;
      if (this.mode === 'single') { if (r.data.length !== 1) return {data: null, error: {message: 'JSON object requested, multiple (or no) rows returned'}}; return {data: r.data[0], error: null}; }
      if (this.mode === 'maybe') return {data: r.data[0] || null, error: null};
      return r;
    }
    then(res, rej) { return this.exec().then(res, rej); }
  }

  return {
    auth: {getSession: async () => ({data: {session: getUid() ? {user: {id: getUid()}} : null}}), getUser: async () => ({data: {user: {id: getUid()}}})},
    from: t => new QB(t),
    rpc: async (name, args = {}) => {
      if (!argNames[name]) {
        const r = await serial(async () => (await pg.query("select proargnames, array(select format_type(t, null) from unnest(proargtypes::oid[]) t) as types from pg_proc where proname=$1 and pronamespace='public'::regnamespace limit 1", [name])).rows);
        const names = r[0]?.proargnames || [], types = r[0]?.types || []; argNames[name] = Object.fromEntries(names.map((n, i) => [n, types[i]]));
      }
      const names = Object.keys(args).filter(k => args[k] !== undefined);
      const params = names.map(k => { const t = argNames[name][k] || ''; const v = args[k]; return (t === 'jsonb' || t === 'json') ? JSON.stringify(v) : lit(v); });
      const sql = `select public.${name}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const r = await run(sql, params);
      return r.error ? {data: null, error: r.error} : {data: r.data[0].r, error: null};
    },
    storage: {from: bucket => ({
      upload: async (path, file) => { files.set(bucket + '/' + path, file); return {data: {path}, error: null}; },
      remove: async paths => { paths.forEach(p => files.delete(bucket + '/' + p)); return {data: paths, error: null}; },
      createSignedUrl: async path => files.has('decision-files/' + path) ? {data: {signedUrl: URL.createObjectURL(files.get('decision-files/' + path))}, error: null} : {data: null, error: {message: 'الملف غير موجود'}}
    })},
    channel: () => ({on() { return this; }, subscribe() { return this; }})
  };
};
