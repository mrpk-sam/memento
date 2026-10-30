import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildCaptionPrompt, captionContext, familyOf } from '@memento/shared';
import { api, errorMessage } from '../../api/client';
import { qk, useAi, useLibrary } from '../../api/hooks';
import type { AiSettings } from '../../api/types';
import { Toggle } from '../../components/controls';
import { useToast } from '../../lib/toast';
import { typeOut } from '../../lib/typeOut';
import d from './Desk.module.css';
import s from './AiTab.module.css';

type Conn = 'idle' | 'testing' | 'ok' | 'error';
const CONN: Record<Conn, [string, string]> = {
  idle: ['Not tested', 'var(--tan)'],
  testing: ['Testing…', '#D9A620'],
  ok: ['Connected', '#3E8E5E'],
  error: ["Couldn't connect", '#C0443A'],
};
const MODEL_HINTS = ['gpt-4o-mini', 'gpt-4o', 'llama-3.1-70b-instruct', 'mistral-large-latest', 'qwen2.5-72b-instruct'];

export function AiTab() {
  const { data } = useAi();
  const lib = useLibrary().data;
  const [testBook, setTestBook] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const [a, setA] = useState<AiSettings | null>(null);
  const [conn, setConn] = useState<Conn>('idle');
  const [connMsg, setConnMsg] = useState('');
  const [keyEdit, setKeyEdit] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [promptPrev, setPromptPrev] = useState(false);
  const [testIn, setTestIn] = useState('Grandpa teaching Theo to fish off the dock at sunrise');
  const [testOut, setTestOut] = useState('');
  const [testing, setTesting] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsErr, setModelsErr] = useState('');
  const [typingModel, setTypingModel] = useState(false);
  const autoLoaded = useRef(false);

  useEffect(() => {
    if (data && !a) setA(data);
  }, [data, a]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Fill the model picker as soon as there's an endpoint to ask.
  useEffect(() => {
    if (!a || autoLoaded.current || !a.endpoint) return;
    autoLoaded.current = true;
    void loadModels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);
  if (!a) return null;

  const later = (k: string, fn: () => Promise<unknown>) => {
    clearTimeout(timers.current.get(k));
    timers.current.set(
      k,
      setTimeout(() => {
        fn()
          .then(() => qc.invalidateQueries({ queryKey: qk.library }))
          .catch((e) => toast(errorMessage(e)));
      }, 600),
    );
  };
  const saveSettings = (patch: Partial<AiSettings> & { key?: string }, debounce = true) => {
    setA((cur) => cur && { ...cur, ...patch });
    const send = () =>
      api<AiSettings>('/ai', { method: 'PATCH', body: patch })
        .then((v) => {
          // The server drops the key when the endpoint moves to another host.
          if (a.hasKey && !v.hasKey && patch.key === undefined) toast('New endpoint host, so the API key was removed. Paste the key again.');
          setA((cur) => cur && { ...cur, keyMasked: v.keyMasked, hasKey: v.hasKey });
        })
        .catch(async (e) => {
          // A refused value (a bad URL, an empty prompt) doesn't stay in the field: show what's saved.
          toast(errorMessage(e));
          await reload();
        });
    if (debounce) later(`settings:${Object.keys(patch).join()}`, send);
    else void send();
  };
  const reload = async () => {
    const v = await api<AiSettings>('/ai');
    setA(v);
    qc.setQueryData(qk.ai, v);
  };

  const st = a.styles.find((x) => x.id === a.voiceStyleId) ?? a.styles[0]!;
  const def = st.key ? a.defaults.styles[st.key] : undefined;
  const edited = (def !== undefined && def !== st.prompt) || a.basePrompt !== a.defaults.basePrompt;
  const setStyle = (patch: { name?: string; prompt?: string }) => {
    setA((cur) => cur && { ...cur, styles: cur.styles.map((x) => (x.id === st.id ? { ...x, ...patch } : x)) });
    later(`style:${st.id}:${Object.keys(patch).join()}`, () => api(`/ai/styles/${st.id}`, { method: 'PATCH', body: patch }));
  };
  // The preview and test box can write as if for a particular book, as real captions do.
  const tb = lib?.books.find((b) => b.id === testBook);
  const tbFamily = tb ? familyOf(lib!.households.find((h) => h.id === tb.householdId), a.familyName) : a.familyName;
  const pv = buildCaptionPrompt(
    { basePrompt: a.basePrompt, stylePrompt: st.prompt, familyName: tbFamily, owner: tb?.owner, maxLen: a.maxLen, emoji: a.emoji },
    testIn || 'a family photo',
    tb ? captionContext(tb.owner, null) : null,
  );

  async function loadModels(report = true) {
    if (!a?.endpoint) {
      if (report) setModelsErr('Add an endpoint URL first.');
      return;
    }
    setModelsBusy(true);
    setModelsErr('');
    try {
      await api('/ai', { method: 'PATCH', body: { endpoint: a.endpoint } });
      const r = await api<{ models: string[] }>('/ai/models');
      setModels(r.models);
      setTypingModel(false);
      if (!r.models.length) setModelsErr('The endpoint returned no models.');
    } catch (e) {
      if (report) setModelsErr(errorMessage(e));
    } finally {
      setModelsBusy(false);
    }
  }

  async function testConnection() {
    setConn('testing');
    // Save anything still waiting first, so the test uses what's on screen.
    await api('/ai', { method: 'PATCH', body: { endpoint: a!.endpoint, model: a!.model } }).catch(() => {});
    const started = Date.now();
    const r = await api<{ ok: boolean; message: string; models?: string[] }>('/ai/test-connection', { method: 'POST' }).catch((e) => ({ ok: false, message: errorMessage(e), models: undefined }));
    await new Promise((res) => setTimeout(res, Math.max(0, 700 - (Date.now() - started))));
    setConn(r.ok ? 'ok' : 'error');
    setConnMsg(r.ok ? '' : r.message);
    if (r.models) {
      setModels(r.models);
      setTypingModel(false);
      toast(r.message);
    }
  }

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setTestOut('');
    try {
      await api('/ai', { method: 'PATCH', body: { basePrompt: a!.basePrompt } }).catch(() => {});
      const { caption } = await api<{ caption: string }>('/ai/caption', { body: { subject: testIn, styleId: st.id, ...(testBook ? { bookId: testBook } : {}) } });
      await typeOut(caption, setTestOut);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <h2 className={d.h2}>AI captions</h2>
      <p className={d.lead}>Connect any OpenAI-compatible endpoint and tune how captions sound.</p>
      <div className={s.grid}>
        <div className={s.card}>
          <div className={s.connHead}>
            <span className={s.cardTitle}>Connection</span>
            <span className={s.status} title={connMsg}>
              <span className={s.dot} style={{ background: CONN[conn][1] }} />
              {CONN[conn][0]}
            </span>
          </div>
          <label className={s.label}>
            Endpoint URL
            <input
              className={s.mono}
              value={a.endpoint}
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => {
                setConn('idle');
                saveSettings({ endpoint: e.target.value });
              }}
            />
          </label>
          <label className={s.label}>
            API key
            <div style={{ display: 'flex', gap: 8 }}>
              {keyEdit ? (
                <input
                  className={s.mono}
                  style={{ flex: 1 }}
                  value={newKey}
                  autoFocus
                  spellCheck={false}
                  placeholder={a.hasKey ? 'Paste a new key, or leave blank to remove it' : 'Paste your key'}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={() => {
                    setKeyEdit(false);
                    if (newKey.trim() || a.hasKey) {
                      setConn('idle');
                      saveSettings({ key: newKey.trim() }, false);
                      toast(newKey.trim() ? 'API key saved. It is stored encrypted.' : 'API key removed');
                    }
                    setNewKey('');
                  }}
                />
              ) : (
                <input className={s.mono} style={{ flex: 1 }} value={a.keyMasked || 'No key yet'} readOnly />
              )}
              <button className={s.keyBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => (keyEdit ? (setKeyEdit(false), setNewKey('')) : setKeyEdit(true))}>
                {keyEdit ? 'Hide' : 'Edit'}
              </button>
            </div>
          </label>
          <label className={s.label}>
            Model
            <div style={{ display: 'flex', gap: 8 }}>
              {models && models.length > 0 && !typingModel ? (
                <select
                  className={s.mono}
                  style={{ flex: 1, paddingRight: 8 }}
                  value={a.model}
                  aria-label="Model"
                  onChange={(e) => {
                    if (e.target.value === '__type') return setTypingModel(true);
                    setConn('idle');
                    saveSettings({ model: e.target.value }, false);
                  }}
                >
                  {!a.model && <option value="">Pick a model…</option>}
                  {a.model && !models.includes(a.model) && <option value={a.model}>{a.model} (not listed)</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__type">Type a name instead…</option>
                </select>
              ) : (
                <>
                  <input
                    className={s.mono}
                    style={{ flex: 1 }}
                    list="ai-models"
                    value={a.model}
                    spellCheck={false}
                    placeholder="gpt-4o-mini"
                    aria-label="Model"
                    onChange={(e) => (setConn('idle'), saveSettings({ model: e.target.value }))}
                  />
                  <datalist id="ai-models">
                    {(models?.length ? models : MODEL_HINTS).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
              <button type="button" className={s.keyBtn} onClick={() => void loadModels()} disabled={modelsBusy} title="Ask the endpoint which models it has">
                {modelsBusy ? <span className={s.spin} style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : models ? 'Refresh' : 'Load models'}
              </button>
            </div>
            {modelsErr && <span className={s.err} style={{ marginTop: 0, fontWeight: 400 }}>{modelsErr}</span>}
          </label>
          <Toggle on={a.vision} onClick={() => saveSettings({ vision: !a.vision }, false)}>
            Send the photo too (for vision models)
          </Toggle>
          <button className={s.ghost} onClick={() => void testConnection()}>
            {conn === 'testing' && <span className={s.spin} />}
            Test connection
          </button>
          {conn === 'error' && connMsg && <div className={s.err}>{connMsg}</div>}

          <div className={s.rule} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={s.cardTitle}>Caption prompts</span>
            <span className={s.help}>
              These are the exact system prompts sent to the model. Edit them here, not in code. Placeholders: <code>{'{family}'}</code> (the book's family) <code>{'{owner}'}</code> (whose book) <code>{'{maxLen}'}</code> <code>{'{emojiRule}'}</code>. Each request also says whose book the photo is in.
            </span>
          </div>
          <label className={s.label} style={{ gap: 8 }}>
            Base instructions<span className={s.sub}>Sent with every style</span>
            <textarea className={s.code} rows={5} value={a.basePrompt} onChange={(e) => saveSettings({ basePrompt: e.target.value })} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className={s.labelText}>Style</span>
            <div className={s.voices}>
              {a.styles.map((x) => (
                <button key={x.id} className={s.voice} onClick={() => saveSettings({ voiceStyleId: x.id }, false)} style={x.id === st.id ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}>
                  {x.name || 'Untitled'}
                </button>
              ))}
              <button
                className={s.addVoice}
                onClick={async () => {
                  try {
                    const { id } = await api<{ id: string }>('/ai/styles', { body: { name: 'Custom', prompt: '' } });
                    await api('/ai', { method: 'PATCH', body: { voiceStyleId: id } });
                    await reload();
                  } catch (e) {
                    toast(errorMessage(e));
                  }
                }}
              >
                + Custom style
              </button>
            </div>
          </div>
          <div className={s.styleBox}>
            {!st.builtin && <input className={s.styleName} value={st.name} placeholder="Style name" aria-label="Style name" onChange={(e) => setStyle({ name: e.target.value })} />}
            <label className={s.label} style={{ gap: 8 }}>
              {(st.name || 'Custom') + ' instructions'}
              <textarea className={s.code} rows={5} value={st.prompt} placeholder="Describe the voice. A couple of example captions help a lot." onChange={(e) => setStyle({ prompt: e.target.value })} />
            </label>
            <div className={s.styleBtns}>
              {edited && (
                <button
                  className={s.small}
                  onClick={async () => {
                    const snap = { basePrompt: a.basePrompt, prompt: st.prompt, id: st.id };
                    try {
                      await api('/ai', { method: 'PATCH', body: { basePrompt: a.defaults.basePrompt } });
                      if (def !== undefined) await api(`/ai/styles/${st.id}`, { method: 'PATCH', body: { prompt: def } });
                      await reload();
                      toast('Prompt reset to default', 'Undo', async () => {
                        await api('/ai', { method: 'PATCH', body: { basePrompt: snap.basePrompt } });
                        await api(`/ai/styles/${snap.id}`, { method: 'PATCH', body: { prompt: snap.prompt } });
                        await reload();
                      });
                    } catch (e) {
                      toast(errorMessage(e));
                    }
                  }}
                >
                  Reset to default
                </button>
              )}
              {!st.builtin && (
                <button
                  className={`${s.small} ${s.danger}`}
                  onClick={async () => {
                    try {
                      await api(`/ai/styles/${st.id}`, { method: 'DELETE' });
                      await reload();
                      toast(`"${st.name}" deleted`, 'Undo', async () => {
                        await api(`/ai/styles/${st.id}/restore`, { method: 'POST' });
                        await api('/ai', { method: 'PATCH', body: { voiceStyleId: st.id } });
                        await reload();
                      });
                    } catch (e) {
                      toast(errorMessage(e));
                    }
                  }}
                >
                  Delete style
                </button>
              )}
              <button className={s.small} onClick={() => setPromptPrev(!promptPrev)}>{promptPrev ? 'Hide full prompt' : 'Preview full prompt'}</button>
              <button
                className={s.small}
                onClick={() => {
                  const json = JSON.stringify({ base: a.basePrompt, styles: a.styles.map(({ id, name, prompt }) => ({ id, name, prompt })), defaultStyle: st.id, maxLen: a.maxLen, emoji: a.emoji, model: a.model }, null, 2);
                  (navigator.clipboard ? navigator.clipboard.writeText(json) : Promise.reject()).then(
                    () => toast('Prompts copied as JSON'),
                    () => toast("Couldn't copy. Your browser blocked it."),
                  );
                }}
              >
                Copy prompts as JSON
              </button>
            </div>
            {promptPrev && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className={s.preLabel}>System</span>
                <pre className={s.pre}>{pv.system}</pre>
                <span className={s.preLabel}>User message</span>
                <pre className={s.pre}>{pv.user}</pre>
              </div>
            )}
          </div>
          <label className={s.label} style={{ gap: 10 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Max length<span style={{ fontWeight: 400, color: 'var(--ink2)' }}>{a.maxLen} characters</span>
            </span>
            <input type="range" min={30} max={120} step={5} value={a.maxLen} onChange={(e) => saveSettings({ maxLen: +e.target.value })} style={{ accentColor: 'var(--accent)' }} />
          </label>
          <Toggle on={a.emoji} onClick={() => saveSettings({ emoji: !a.emoji }, false)}>Allow emoji in captions</Toggle>
          <Toggle on={a.auto} onClick={() => saveSettings({ auto: !a.auto }, false)}>Auto-caption new uploads</Toggle>
        </div>

        <div className={s.testCard}>
          <span className={s.cardTitle}>Test a caption</span>
          <label className={s.label}>
            For which book
            <select className={s.testIn} style={{ height: 42, padding: '0 10px' }} value={testBook} onChange={(e) => setTestBook(e.target.value)}>
              <option value="">No particular book</option>
              {lib?.books.map((b) => (
                <option key={b.id} value={b.id}>{b.owner}</option>
              ))}
            </select>
          </label>
          <label className={s.label}>
            Describe the photo
            <textarea className={s.testIn} rows={3} value={testIn} onChange={(e) => setTestIn(e.target.value)} />
          </label>
          <button className={s.gen} onClick={() => void runTest()} style={{ opacity: testing ? 0.6 : 1 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
            {testing ? 'Writing…' : 'Generate caption'}
          </button>
          <div className={s.polaroid}>
            <div className={s.tape} />
            <div className={s.photo}>your photo</div>
            <div className={s.out} style={{ color: testOut ? '#3A3026' : 'rgba(58,48,38,.4)' }}>{testOut || (testing ? '' : 'Your caption will appear here')}</div>
          </div>
        </div>
      </div>
    </>
  );
}
