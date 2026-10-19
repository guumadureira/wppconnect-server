// Based on the Meta sample's protocol; accepts only explicit trusted origins.
const trustedOrigins = new Set(['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com']);
export function createSignupFlow({ complete, notify, done }) {
  let attempt, code, info, active = false, completing = false;
  let generation = 0;
  function stop(message) { active = false; code = info = null; notify(message); done?.(); }
  async function finish() {
    if (!active || completing || !code || !info) return;
    completing = true;
    const current = generation;
    const payload = { attemptId: attempt.attemptId, code, wabaId: info.waba_id, phoneNumberId: info.phone_number_id };
    code = info = null;
    notify('Conferindo a autorização na Meta…');
    try {
      const result = await complete(payload);
      if (current === generation) stop(result.message);
    } catch { if (current === generation) stop('A autorização não pôde ser conferida. A conexão atual foi preservada. Inicie uma nova tentativa ou confira os requisitos no painel da Meta.'); }
    finally { if (current === generation) completing = false; }
  }
  return {
    begin(value) { if (active || completing) return false; generation++; attempt = value; code = info = null; active = true; notify('Conclua o cadastro na janela da Meta.'); return true; },
    login(response) {
      if (!active || completing) return;
      if (typeof response?.authResponse?.code !== 'string' || !response.authResponse.code) { stop('Cadastro cancelado. A conexão atual foi preservada.'); return; }
      code = response.authResponse.code; void finish();
    },
    message(event) {
      if (!active || completing || !trustedOrigins.has(event.origin) || typeof event.data !== 'string' || event.data.length > 32768) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'CANCEL' || data.event === 'ERROR') { stop('A Meta interrompeu o cadastro. A conexão atual foi preservada.'); return; }
      if (!['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(data.event)) return;
      if (!/^\d{5,30}$/.test(data.data?.waba_id) || !/^\d{5,30}$/.test(data.data?.phone_number_id)) return;
      info = { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id }; void finish();
    },
    cancel() { if (completing) return; generation++; stop('Cadastro encerrado. A conexão atual foi preservada.'); },
  };
}

async function bootSignup() {
  const launch = document.querySelector('#launch'), status = document.querySelector('#status'), retry = document.querySelector('#retry');
  const notify = message => { status.textContent = message; };
  const api = async (path, body) => {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir esta etapa.');
    return result;
  };
  let timeout;
  const flow = createSignupFlow({ complete: body => api('/api/whatsapp/signup/complete', body), notify,
    done: () => { clearTimeout(timeout); launch.disabled = true; retry.hidden = false; } });
  window.addEventListener('message', flow.message);
  retry.onclick = () => location.reload();
  try {
    const config = await api('/api/whatsapp/signup');
    if (!config.available) {
      const pending = [...config.missing, ...config.invalid];
      throw new Error('O cadastro ainda não está disponível nesta central.' + (pending.length ? ' Configurações pendentes: ' + pending.join(', ') + '.' : ' É necessário modo real e HTTPS.'));
    }
    const attempt = await api('/api/whatsapp/signup/start', {});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A Meta demorou para carregar. Verifique se o navegador permite o SDK do Facebook.')), 15000);
      window.fbAsyncInit = () => {
        try { window.FB.init({ appId: attempt.appId, version: attempt.graphVersion, autoLogAppEvents: false, xfbml: false }); clearTimeout(timer); resolve(); }
        catch { clearTimeout(timer); reject(new Error('Não foi possível inicializar o cadastro da Meta.')); }
      };
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js'; script.async = true; script.crossOrigin = 'anonymous';
      script.onerror = () => { clearTimeout(timer); reject(new Error('O SDK da Meta não carregou. Verifique a conexão e os bloqueadores do navegador.')); };
      document.head.append(script);
    });
    launch.textContent = 'Abrir conexão no WhatsApp Business'; launch.disabled = false;
    notify('Pronto para abrir o cadastro oficial da Meta.');
    launch.onclick = () => {
      if (Date.now() >= attempt.expiresAt) { notify('A preparação expirou. Clique em Tentar novamente.'); launch.disabled = true; retry.hidden = false; return; }
      if (!flow.begin(attempt)) return;
      launch.disabled = true;
      retry.textContent = 'Reiniciar preparação'; retry.hidden = false;
      timeout = setTimeout(() => flow.cancel(), 10 * 60000);
      // Synchronous user gesture: awaiting fetch here can cause popup blockers.
      try { window.FB.login(flow.login, attempt.login); }
      catch { flow.cancel(); }
    };
  } catch (error) { notify(error.message); launch.textContent = 'Cadastro indisponível'; retry.hidden = false; }
}
if (typeof document !== 'undefined') void bootSignup();
