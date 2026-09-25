import Link from "next/link";
import {notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import styles from "../../dashboard.module.css";

const labels:Record<string,string>={draft:"Rascunho",published:"Em andamento",sold_out:"Esgotada",ready_to_draw:"Pronta para sortear",drawn:"Sorteada",cancelled:"Cancelada"};

export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{published?:string}>}){
  const {id}=await params;
  const query=await searchParams;
  const supabase=await createClient();
  const {data:p}=await supabase.from("promotions").select("*,organizations(name,slug,pix_key)").eq("id",id).maybeSingle();
  if(!p)notFound();
  const org=Array.isArray(p.organizations)?p.organizations[0]:p.organizations;
  const url=`/p/${org.slug}/${p.slug}`;
  const {count}=await supabase.from("quotas").select("id",{count:"exact",head:true}).eq("promotion_id",id).eq("status","paid");
  const paid=count??0;
  const percent=p.quota_quantity?Math.min(100,Math.round((paid/p.quota_quantity)*100)):0;

  return <main className={styles.main}>
    <div className={styles.heading}>
      <div><h1>{p.name}</h1><p>Acompanhe a campanha e acesse as principais ações.</p></div>
      <Link href="/dashboard/promocoes">← Minhas campanhas</Link>
    </div>
    {query.published?<div className={styles.alertSuccess}>Campanha publicada com sucesso. A comunicação está vinculada ao grupo configurado.</div>:null}

    <section className={styles.infoGrid}>
      <article className={styles.infoCard}><span>Status</span><strong>{labels[p.status]||p.status}</strong></article>
      <article className={styles.infoCard}><span>Cotas pagas</span><strong>{paid.toLocaleString("pt-BR")} / {p.quota_quantity.toLocaleString("pt-BR")}</strong></article>
      <article className={styles.infoCard}><span>Progresso</span><strong>{percent}%</strong></article>
    </section>

    <section className={styles.panel}>
      <h2 style={{marginTop:0}}>Operação da campanha</h2>
      <div className={styles.flowGrid}>
        <div className={styles.flowStep}>1. Dados e produtos</div>
        <div className={styles.flowStep}>2. Comunicação</div>
        <div className={styles.flowStep}>3. Pagamentos</div>
        <div className={styles.flowStep}>4. Sorteio</div>
      </div>
      <div className={styles.softPanel} style={{marginTop:18}}>
        <strong>Recebimento via PIX</strong>
        <p>{org.pix_key||"Ainda não configurado em Configurações."}</p>
      </div>
      {p.status==="draft"?
        <div className={styles.actions} style={{marginTop:20}}>
          <Link className={styles.primary} href={`/dashboard/promocoes/${id}/configuracao?step=2`}>Continuar configuração</Link>
        </div>
        :<div className={styles.actions} style={{marginTop:20}}>
          <Link href={url} target="_blank">Abrir página pública</Link>
          <Link className={styles.primary} href="/dashboard/pagamentos">Ver reservas e pagamentos</Link>
        </div>}
    </section>
  </main>
}