"use client";
import { useEffect, useState } from "react";
import local from "./lead-capture.module.css";

type Group = { id: string; subject: string; participants: number };
type Contact = { jid: string; phone: string | null; username: string | null; lid: string | null; name: string | null; admin: string | null; contactMode: "azurra_leads" | "manual" };

export default function LeadCapture({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState("disconnected"), [qr, setQr] = useState<string | null>(null), [phone, setPhone] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]), [groupId, setGroupId] = useState(""), [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const group = groups.find((item) => item.id === groupId);
  const call = async (url: string, options?: RequestInit) => { const response = await fetch(url, options), data = await response.json(); if (!response.ok) throw new Error(data.error || "Erro na captura"); return data; };
  const refresh = async () => { try {
    const data = await call(`/api/lead-capture?org=${organizationId}&action=status`);
    setStatus(data.status); setQr(data.qr); setPhone(data.phone);
    if (data.status === "connected") setGroups(await call(`/api/lead-capture?org=${organizationId}&action=groups`));
  } catch (error) { setMessage(error instanceof Error ? error.message : "Serviço indisponível"); } };
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [organizationId]);
  const connect = async () => { setBusy(true); setMessage("Gerando QR Code..."); try { await call("/api/lead-capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: organizationId, action: "connect" }) }); await refresh(); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha"); } finally { setBusy(false); } };
  const disconnect = async () => { if (!confirm("Desconectar e apagar esta sessão exclusiva de captura?")) return; setBusy(true); try { await call(`/api/lead-capture?org=${organizationId}`, { method: "DELETE" }); setStatus("disconnected"); setQr(null); setGroups([]); setContacts([]); setSelected(new Set()); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha"); } finally { setBusy(false); } };
  const loadContacts = async () => { if (!groupId) return; setBusy(true); setMessage("Lendo participantes do grupo..."); try { const data = await call(`/api/lead-capture?org=${organizationId}&action=participants&groupId=${encodeURIComponent(groupId)}`); setContacts(data.contacts); setSelected(new Set(data.contacts.map((contact: Contact) => contact.jid))); const ready = data.contacts.filter((contact: Contact) => contact.phone).length; setMessage(`${data.contacts.length} identificados: ${ready} com telefone e ${data.contacts.length - ready} para contato manual.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha"); } finally { setBusy(false); } };
  const toggle = (jid: string) => setSelected((current) => { const next = new Set(current); next.has(jid) ? next.delete(jid) : next.add(jid); return next; });
  const importContacts = async () => { if (!group) return; setBusy(true); try { const chosen = contacts.filter((contact) => selected.has(contact.jid)); const result = await call("/api/lead-capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: organizationId, action: "import", groupId: group.id, groupName: group.subject, foundCount: contacts.length, contacts: chosen }) }); setMessage(`${result.imported} salvos: ${result.azurraReady} para o Azurra Leads e ${result.manual} para contato manual.`); setTimeout(() => location.reload(), 1200); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha"); } finally { setBusy(false); } };
  const allSelected = contacts.length > 0 && selected.size === contacts.length;
  return <section className={local.module}>
    <div className={local.connection}><div><strong>WhatsApp exclusivo para extração</strong><p>{status === "connected" ? `Conectado${phone ? ` • +${phone}` : ""}` : status === "qr" ? "Aguardando leitura do QR Code" : "Desconectado"}</p></div><span className={status === "connected" ? local.online : local.offline}>{status === "connected" ? "Online" : "Offline"}</span></div>
    <p className={local.notice}>Esta conexão apenas consulta grupos e participantes. Ela não possui funções de envio.</p>
    {status !== "connected" ? <button className={local.primary} onClick={connect} disabled={busy}>Conectar WhatsApp de captura</button> : <button className={local.secondary} onClick={disconnect} disabled={busy}>Desconectar e apagar sessão</button>}
    {qr && status !== "connected" ? <div className={local.qr}><img src={qr} alt="QR Code" /><p>No WhatsApp, abra <strong>Aparelhos conectados</strong> e leia este código.</p></div> : null}
    {status === "connected" ? <div className={local.picker}><select value={groupId} onChange={(event) => { setGroupId(event.target.value); setContacts([]); setSelected(new Set()); }}><option value="">Selecione um grupo</option>{groups.map((item) => <option value={item.id} key={item.id}>{item.subject} ({item.participants})</option>)}</select><button onClick={loadContacts} disabled={!groupId || busy}>Visualizar contatos</button></div> : null}
    {contacts.length ? <div className={local.preview}><div className={local.previewHead}><label><input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(contacts.map((contact) => contact.jid)) : new Set())} /> Selecionar todos</label><strong>{selected.size} de {contacts.length} selecionados</strong></div>
      <div className={local.list}>{contacts.map((contact) => <label key={contact.jid}><input type="checkbox" checked={selected.has(contact.jid)} onChange={() => toggle(contact.jid)} /><span><strong>{contact.name || contact.username || "Nome não disponível"}</strong><small>{contact.phone || contact.username || "Telefone protegido"}{contact.lid ? ` • LID ${contact.lid.replace("@lid", "")}` : ""}{contact.admin ? " • administrador" : ""}</small><small>{contact.contactMode === "azurra_leads" ? "Pronto para Azurra Leads" : "Contato manual"}</small></span></label>)}</div>
      <button className={local.primary} onClick={importContacts} disabled={!selected.size || busy}>Importar selecionados</button>
    </div> : null}
    {message ? <div className={local.message}>{message}</div> : null}
  </section>;
}
