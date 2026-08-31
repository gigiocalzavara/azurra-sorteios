import { createClient } from "@/lib/supabase/server";
import styles from "../dashboard.module.css";
import LeadCapture from "./lead-capture";

export default async function Page() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: member } = await supabase.from("organization_members").select("organization_id")
    .eq("user_id", auth.user!.id).limit(1).maybeSingle();
  if (!member) return <main className={styles.main}><div className={styles.alertError}>Organização não encontrada.</div></main>;
  const [{ data: leads }, { data: runs }] = await Promise.all([
    supabase.from("captured_leads").select("id,display_name,phone_e164,consent_status,last_captured_at,captured_lead_sources(group_name)")
      .eq("organization_id", member.organization_id).order("last_captured_at", { ascending: false }).limit(100),
    supabase.from("lead_capture_runs").select("id,group_name,found_count,imported_count,duplicate_count,created_at")
      .eq("organization_id", member.organization_id).order("created_at", { ascending: false }).limit(10)
  ]);
  return <main className={styles.main}>
    <div className={styles.heading}><div><h1>Captura de leads</h1><p>Extraia contatos dos seus grupos usando uma conexão exclusiva do WhatsApp.</p></div>
      <a className={styles.primary} href={`/api/lead-capture?org=${member.organization_id}&action=export`}>Exportar CSV</a>
    </div>
    <LeadCapture organizationId={member.organization_id} />
    <section className={styles.panel} style={{ marginTop: 20 }}><h2>Base capturada</h2>
      {!leads?.length ? <div className={styles.empty}>Nenhum contato importado.</div> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Nome</th><th>WhatsApp</th><th>Origem</th><th>Consentimento</th><th>Última captura</th></tr></thead>
        <tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.display_name || "Nome não disponível"}</strong></td><td>{lead.phone_e164}</td><td>{(lead.captured_lead_sources || []).map((source: { group_name: string }) => source.group_name).join(", ")}</td><td>{lead.consent_status === "confirmed" ? "Confirmado" : lead.consent_status === "opted_out" ? "Recusado" : "Não confirmado"}</td><td>{new Date(lead.last_captured_at).toLocaleString("pt-BR")}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <section className={styles.panel} style={{ marginTop: 20 }}><h2>Histórico de extrações</h2>
      {!runs?.length ? <div className={styles.empty}>Nenhuma extração realizada.</div> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Grupo</th><th>Encontrados</th><th>Importados</th><th>Repetidos</th><th>Data</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id}><td><strong>{run.group_name}</strong></td><td>{run.found_count}</td><td>{run.imported_count}</td><td>{run.duplicate_count}</td><td>{new Date(run.created_at).toLocaleString("pt-BR")}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
