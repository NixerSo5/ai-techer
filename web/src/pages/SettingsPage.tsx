import { useEffect, useState } from 'react';
import { getSettings, saveSettings, testLlm, type PublicSettings } from '../api';

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enableWiki, setEnableWiki] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setBaseUrl(s.llmBaseUrl);
        setModel(s.llmModel);
        setEnableWiki(s.enableWiki);
      })
      .catch((err: Error) => setMessage(err.message));
  }, []);

  async function handleSave() {
    setBusy(true);
    setMessage('');
    try {
      const patch: Record<string, unknown> = { llmBaseUrl: baseUrl, llmModel: model, enableWiki };
      // Only send the key when the user typed a new one; otherwise keep the stored one.
      if (apiKey.trim()) patch.llmApiKey = apiKey.trim();
      const saved = await saveSettings(patch);
      setSettings(saved);
      setApiKey('');
      setMessage('已保存');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage('');
    try {
      const result = await testLlm();
      setMessage(result.ok ? `连接正常：${result.sample ?? 'pong'}` : `失败：${result.error}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>模型设置</h1>
      <p className="hint">
        配置 OpenAI 兼容的模型服务。密钥保存在本地数据库中，界面上只显示掩码。
      </p>

      <label className="field">
        <span>Base URL</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com"
        />
      </label>

      <label className="field">
        <span>模型名</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-flash" />
      </label>

      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings?.llmApiKeyConfigured ? settings.llmApiKeyMasked : '未配置'}
        />
      </label>

      <label className="field checkbox">
        <input type="checkbox" checked={enableWiki} onChange={(e) => setEnableWiki(e.target.checked)} />
        <span>使用 Wikipedia 增强主题搜索（需要能访问 wikipedia.org）</span>
      </label>

      <div className="actions">
        <button onClick={handleSave} disabled={busy}>
          保存
        </button>
        <button className="secondary" onClick={handleTest} disabled={busy}>
          测试连接
        </button>
      </div>

      {message && <p className="message">{message}</p>}
    </section>
  );
}
