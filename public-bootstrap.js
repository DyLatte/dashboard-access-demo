(() => {
  const originalFetch = window.fetch.bind(window);
  let snapshot;
  let finishUnlock;
  const unlocked = new Promise(resolve => { finishUnlock = resolve; });
  const casesKey = 'demo-weekly-cases-v1';
  const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

  async function unlock(password) {
    const res = await originalFetch(window.DASHBOARD_SNAPSHOT, { cache: 'no-store' });
    if (!res.ok) throw new Error('加密数据包暂时无法读取');
    const packet = await res.json();
    const rawKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(packet.salt), iterations: packet.iterations,
      hash: 'SHA-256' }, rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const ciphertext = bytes(packet.data);
    const tag = bytes(packet.tag);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);
    const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(packet.iv) }, key, combined);
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    snapshot = JSON.parse(await new Response(stream).text());
    finishUnlock();
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname === '/api/oceanengine/status') return response({ loggedIn: false });
    if (url.pathname === '/api/oceanengine/open') return response({ status: 'disabled' }, 403);
    await unlocked;
    if (url.pathname === '/api/dashboard/rows') {
      const start = url.searchParams.get('start') || '';
      const end = url.searchParams.get('end') || '';
      const materials = snapshot.materials.filter(row => {
        const added = row.material_time_basis === 'plan_added' ? row.material_plan_add_time?.slice(0, 10) : '';
        return added ? added <= end : (!row.first_observed_date || row.first_observed_date <= end);
      });
      return response({ ...snapshot, materials, rows: snapshot.rows.filter(row => row.date >= start && row.date <= end) });
    }
    if (url.pathname === '/api/dashboard/collection-status') return response(snapshot.collectionStatus);
    if (url.pathname === '/api/dashboard/weekly-excellent') {
      const cases = JSON.parse(localStorage.getItem(casesKey) || '{}');
      if ((init.method || 'GET').toUpperCase() === 'PUT') {
        const item = JSON.parse(init.body || '{}');
        if (item.value) cases[item.key] = item;
        else delete cases[item.key];
        localStorage.setItem(casesKey, JSON.stringify(cases));
        return response({ status: 'saved', key: item.key, value: item.value });
      }
      return response({ status: 'ok', cases: Object.values(cases).filter(item =>
        item.start === url.searchParams.get('start') && item.end === url.searchParams.get('end')) });
    }
    return response({ status: 'not_found' }, 404);
  };

  document.querySelector('#connectionStatus')?.remove();
  document.querySelector('#connectOceanEngineButton')?.remove();
  // app.js retains these selectors, so provide hidden inert nodes.
  for (const id of ['connectionStatus', 'connectionStatusText', 'connectOceanEngineButton']) {
    if (!document.getElementById(id)) {
      const node = document.createElement(id === 'connectOceanEngineButton' ? 'button' : 'span');
      node.id = id; node.hidden = true; document.body.append(node);
    }
  }
  const style = document.createElement('style');
  style.textContent = '#dashboard-lock{position:fixed;inset:0;background:#f4f6fb;z-index:10000;display:grid;place-items:center;padding:24px}#dashboard-lock form{background:white;box-shadow:0 16px 48px #10203d22;border-radius:16px;padding:32px;width:min(100%,420px)}#dashboard-lock h2{margin:0 0 12px}#dashboard-lock p{line-height:1.6}#dashboard-lock input{box-sizing:border-box;width:100%;padding:12px;margin:12px 0}#dashboard-lock button{width:100%;padding:12px;background:#2563eb;color:white;border:0;border-radius:8px;cursor:pointer}#dashboard-lock .error{color:#b91c1c;min-height:24px}';
  document.head.append(style);
  const lock = document.createElement('div');
  lock.id = 'dashboard-lock';
  lock.innerHTML = '<form><h2>千川数据看板</h2><p>此站全部使用虚构演示数据，仅供访问与功能测试。公开演示口令：demo2026。页面在浏览器内解密。</p><input type="password" autocomplete="off" required placeholder="访问密码" aria-label="访问密码"><button type="submit">解锁看板</button><p class="error" role="alert"></p></form>';
  document.body.append(lock);
  lock.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = lock.querySelector('button');
    const error = lock.querySelector('.error');
    button.disabled = true; error.textContent = '正在解密…';
    try { await unlock(lock.querySelector('input').value); lock.remove(); }
    catch (e) { error.textContent = e.name === 'OperationError' ? '访问密码不正确' : (e.message || '解密失败'); }
    finally { button.disabled = false; }
  });
})();
