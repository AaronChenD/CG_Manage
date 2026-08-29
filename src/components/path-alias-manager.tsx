"use client";

import { useMemo, useState } from "react";
import { Check, Copy, FolderTree, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { joinNative, parsePathTemplate, resolveTemplate, type PathAliasDTO } from "@/lib/asset-catalog";

type Tone = "success" | "error";

export default function PathAliasManager({
  aliases,
  usageCount,
  onClose,
  onChanged,
  onNotify,
}: {
  aliases: PathAliasDTO[];
  usageCount: Record<string, number>;
  onClose: () => void;
  onChanged: (aliases: PathAliasDTO[]) => void;
  onNotify: (message: string, tone?: Tone) => void;
}) {
  const empty = { key: "", label: "", root: "", note: "" };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState("$SHOW/model/hero_body.fbx");
  const [probeResult, setProbeResult] = useState<{ resolved: string; exists: boolean | null; size: number | null; error: string | null } | null>(null);

  const preview = useMemo(() => resolveTemplate(probe, aliases), [aliases, probe]);
  const parsedProbe = useMemo(() => parsePathTemplate(probe), [probe]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (editingId) {
        const response = await fetch(`/api/vault/path-aliases/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "更新失败。");
        onChanged(aliases.map((alias) => (alias.id === editingId ? result.alias : alias)));
        onNotify(`别名 $${result.alias.key} 已更新。`);
      } else {
        const response = await fetch("/api/vault/path-aliases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "创建失败。");
        onChanged([...aliases, result.alias]);
        onNotify(`路径别名 $${result.alias.key} 已创建。`);
      }
      setForm(empty);
      setEditingId(null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存失败。", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (alias: PathAliasDTO) => {
    try {
      const response = await fetch(`/api/vault/path-aliases/${alias.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !alias.enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "更新失败。");
      onChanged(aliases.map((item) => (item.id === alias.id ? result.alias : item)));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "更新失败。", "error");
    }
  };

  const remove = async (alias: PathAliasDTO) => {
    if (!window.confirm(`删除别名 $${alias.key}？引用它的资产路径会立即变为无法解析。`)) return;
    try {
      const response = await fetch(`/api/vault/path-aliases/${alias.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除失败。");
      onChanged(aliases.filter((item) => item.id !== alias.id));
      if (editingId === alias.id) {
        setEditingId(null);
        setForm(empty);
      }
      onNotify(`别名 $${alias.key} 已删除。`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "删除失败。", "error");
    }
  };

  const runProbe = async () => {
    setProbeResult(null);
    if (preview.error) {
      onNotify(preview.error, "error");
      return;
    }
    try {
      // 直接把原始模板交给服务端解析（服务端会识别 $KEY/ 前缀并拼接别名根）。
      // 之前这里传的是“解析后的绝对路径 + aliasKey”，会被再次拼进别名根，
      // 导致 /root/<绝对路径> 的双重拼接，探测结果永远是“缺失”。
      const response = await fetch("/api/vault/files/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ aliasKey: parsedProbe.aliasKey, path: probe }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "校验失败。");
      const status = result.results?.[0];
      setProbeResult({ resolved: preview.resolved, exists: status?.exists ?? null, size: status?.size ?? null, error: status?.error ?? null });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "校验失败。", "error");
    }
  };

  return <div className="modal-layer compact-layer" role="dialog" aria-modal="true" aria-label="路径别名管理">
    <div className="alias-modal">
      <header className="alias-header">
        <div className="modal-mini-icon"><FolderTree size={18} /></div>
        <div><h2>路径别名管理</h2><p>用 <code>$SHOW</code> 这类别名代替绝对路径，换机器或换 Show 时只需改一处。</p></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
      </header>

      <div className="alias-form">
        <label className="alias-key-field">别名 Key<input value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value.toUpperCase().replace(/[^A-Z0-9_.-]/g, "") }))} placeholder="SHOW" /></label>
        <label>显示名称<input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="当前 Show 根目录" /></label>
        <label className="alias-root-field">根路径<input value={form.root} onChange={(event) => setForm((current) => ({ ...current, root: event.target.value }))} placeholder="\\\\server\\show\\atlas 或 D:/Show/Atlas" /></label>
        <label className="alias-note-field">备注<input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="挂载盘符、命名规范等" /></label>
        <div className="alias-form-actions">
          {editingId && <button className="ghost-tiny" onClick={() => { setEditingId(null); setForm(empty); }}>取消编辑</button>}
          <button className="save-button" onClick={() => void submit()} disabled={busy || !form.key.trim() || !form.root.trim()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}{editingId ? "保存修改" : "新增别名"}
          </button>
        </div>
      </div>

      <div className="alias-list">
        {aliases.length === 0 && <p className="alias-empty">尚未定义任何别名。建议至少建立 SHOW、PUB、TEX 三个根路径。</p>}
        {aliases.map((alias) => <div key={alias.id} className={`alias-row ${alias.enabled ? "" : "is-off"}`}>
          <div className="alias-row-main">
            <button className="alias-key" onClick={() => { setEditingId(alias.id); setForm({ key: alias.key, label: alias.label, root: alias.root, note: alias.note }); }} title="编辑该别名">${alias.key}</button>
            <div className="alias-meta">
              <strong>{alias.label}</strong>
              <code title={alias.root}>{alias.root}</code>
              {alias.note && <small>{alias.note}</small>}
            </div>
          </div>
          <div className="alias-row-side">
            <span className={`alias-usage ${usageCount[alias.key] ? "" : "is-zero"}`}>{usageCount[alias.key] ?? 0} 条引用</span>
            <button className="icon-tiny" onClick={() => void navigator.clipboard.writeText(joinNative(alias.root, "")).then(() => onNotify("根路径已复制。")).catch(() => onNotify("剪贴板不可用。", "error"))} aria-label="复制根路径"><Copy size={14} /></button>
            <button className="icon-tiny" onClick={() => void toggleEnabled(alias)} aria-label="启用或停用">{alias.enabled ? <Check size={14} /> : <X size={14} />}</button>
            <button className="icon-tiny" onClick={() => { setEditingId(alias.id); setForm({ key: alias.key, label: alias.label, root: alias.root, note: alias.note }); }} aria-label="编辑"><Pencil size={14} /></button>
            <button className="icon-tiny danger" onClick={() => void remove(alias)} aria-label="删除"><Trash2 size={14} /></button>
          </div>
        </div>)}
      </div>

      <section className="alias-probe">
        <div className="alias-probe-head"><ShieldCheck size={15} /><span>路径解析测试</span></div>
        <div className="alias-probe-form"><input value={probe} onChange={(event) => { setProbe(event.target.value); setProbeResult(null); }} placeholder="$PUB/model/hero_body.fbx" /><button className="primary-tiny" onClick={() => void runProbe()}>服务器校验</button></div>
        <div className="alias-probe-result">
          <div><span>解析结果</span><code>{preview.error ? "—" : preview.resolved}</code></div>
          {preview.error ? <p className="probe-error">{preview.error}</p> : probeResult ? (
            <p className={probeResult.error ? "probe-error" : probeResult.exists ? "probe-ok" : "probe-warn"}>
              {probeResult.error ?? (probeResult.exists ? `路径存在${probeResult.size !== null ? ` · ${probeResult.size} 字节` : ""}` : "路径不存在（服务端未找到该文件）")}
            </p>
          ) : <p className="probe-hint">点击「服务器校验」可确认该路径在运行 CG Vault 的这台机器上是否真实存在。</p>}
        </div>
      </section>
    </div>
  </div>;
}
