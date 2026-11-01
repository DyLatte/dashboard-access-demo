(() => {
  function unpackSnapshot(packet){
 if(packet.format!=='qianchuan-columns-v1')return packet;
 const table=source=>{
  if(!Number.isInteger(source.length)||source.length<0||source.length>1000000||!Array.isArray(source.columns))throw new Error('数据包格式不正确');
  const records=Array.from({length:source.length},()=>({}));
  for(const column of source.columns){
   if(['__proto__','constructor','prototype'].includes(column.name))throw new Error('数据包字段不正确');
   for(let i=0;i<source.length;i++)if(!column.present||column.present[i]==='1'){
    records[i][column.name]=Object.hasOwn(column,'constant')?column.constant:column.dictionary?column.dictionary[column.codes[i]]:column.values[i];
   }
  }
  return records;
 };
 return {...packet.meta,rows:table(packet.rows),materials:table(packet.materials)};
}
  const originalFetch = window.fetch.bind(window);
  let snapshot, packetPromise, finishUnlock, busy = false;
  const unlocked = new Promise(resolve => { finishUnlock = resolve; });
  const timing = window.dashboardLoadTiming = {};
  const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const started = performance.now();
  let progress;
  const show = text => { if (progress) progress.textContent = text; };

  function loadPacket() {
    if (!packetPromise) {
      // Only ciphertext uses the browser HTTP cache. A new publication has a new filename.
      packetPromise = (async () => {
        show('正在准备加密数据…');
        const res = await originalFetch(window.DASHBOARD_SNAPSHOT, { cache: 'force-cache' });
        if (!res.ok) throw new Error('加密数据下载失败，请稍后重试');
        const packet = await res.json();
        if (packet.version !== 1 || packet.iterations < 310000) throw new Error('加密数据格式不正确');
        timing.downloadMs = Math.round(performance.now() - started);
        if (!busy) show('数据已准备好，请输入访问密码');
        return packet;
      })().catch(error => { packetPromise = undefined; throw error; });
    }
    return packetPromise;
  }

  async function unlock(password) {
    const submitted = performance.now();
    show('正在读取加密数据…');
    const packet = await loadPacket();
    timing.downloadWaitMs = Math.round(performance.now() - submitted);
    show('正在验证密码…');
    const verifyStarted = performance.now();
    const rawKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(packet.salt), iterations: packet.iterations,
      hash: 'SHA-256' }, rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const ciphertext = bytes(packet.data), tag = bytes(packet.tag);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext); combined.set(tag, ciphertext.length);
    const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(packet.iv) }, key, combined);
    timing.decryptMs = Math.round(performance.now() - verifyStarted);
    show('正在加载看板…');
    const expandStarted = performance.now();
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    snapshot = unpackSnapshot(JSON.parse(await new Response(stream).text()));
    timing.expandMs = Math.round(performance.now() - expandStarted);
    timing.unlockMs = Math.round(performance.now() - submitted);
    finishUnlock();
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname.startsWith('/api/case-library') || url.pathname === '/api/dashboard/weekly-excellent') {
      return response({ status: 'removed', message: '案例功能已取消' }, 410);
    }
    if (url.pathname === '/api/oceanengine/status') return response({ loggedIn: false });
    if (url.pathname === '/api/oceanengine/open') return response({ status: 'disabled' }, 403);
    await unlocked;
    if (url.pathname === '/api/dashboard/rows') {
      const start = url.searchParams.get('start') || '', end = url.searchParams.get('end') || '';
      const materials = snapshot.materials.filter(row => {
        const added = row.material_time_basis === 'plan_added' ? row.material_plan_add_time?.slice(0, 10) : '';
        return added ? added <= end : (!row.first_observed_date || row.first_observed_date <= end);
      });
      return response({ ...snapshot, materials, rows: snapshot.rows.filter(row => row.date >= start && row.date <= end) });
    }
    if (url.pathname === '/api/dashboard/collection-status') return response(snapshot.collectionStatus);
    return response({ status: 'not_found' }, 404);
  };

  document.querySelector('#connectionStatus')?.remove();
  document.querySelector('#connectOceanEngineButton')?.remove();
  const reloadButton = document.querySelector('#reloadButton');
  if (reloadButton) {
    reloadButton.title = '获取最新发布版本，需重新输入访问密码';
    reloadButton.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation(); location.reload();
    }, { capture: true });
  }
  for (const id of ['connectionStatus', 'connectionStatusText', 'connectOceanEngineButton']) {
    if (!document.getElementById(id)) {
      const node = document.createElement(id === 'connectOceanEngineButton' ? 'button' : 'span');
      node.id = id; node.hidden = true; document.body.append(node);
    }
  }
  const style = document.createElement('style');
  style.textContent = '#dashboard-lock{position:fixed;inset:0;background:#f4f6fb;z-index:10000;display:grid;place-items:center;padding:24px}#dashboard-lock form{background:white;box-shadow:0 16px 48px #10203d22;border-radius:16px;padding:32px;width:min(100%,420px)}#dashboard-lock h2{margin:0 0 12px}#dashboard-lock p{line-height:1.6}#dashboard-lock input{box-sizing:border-box;width:100%;padding:12px;margin:12px 0}#dashboard-lock button{width:100%;padding:12px;background:#2563eb;color:white;border:0;border-radius:8px;cursor:pointer}#dashboard-lock button:disabled{opacity:.6;cursor:wait}#dashboard-lock .error{color:#b91c1c;min-height:24px}#dashboard-lock .progress{color:#64748b;min-height:24px}';
  document.head.append(style);
  const lock = document.createElement('div');
  lock.id = 'dashboard-lock';
  lock.innerHTML = '<form><h2>千川数据看板</h2><p>请输入访问密码，查看看板数据。</p><input type="password" autocomplete="off" required placeholder="访问密码" aria-label="访问密码"><button type="submit">解锁看板</button><p class="progress" role="status" aria-live="polite"></p><p class="error" role="alert"></p></form>';
  document.body.append(lock);
  progress = lock.querySelector('.progress');
  lock.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const button = lock.querySelector('button'), error = lock.querySelector('.error'), input = lock.querySelector('input');
    busy = true; button.disabled = true; error.textContent = '';
    try { await unlock(input.value); input.value = ''; lock.remove(); }
    catch (e) {
      show('');
      error.textContent = e.name === 'OperationError' ? '访问密码不正确，请重试' : (e.message || '加载失败，请重试');
    } finally { busy = false; button.disabled = false; }
  });
  // Begin while the viewer types; failed password attempts reuse this same packet.
  loadPacket().catch(() => show('数据准备未完成，提交密码时将重新尝试'));
})();

