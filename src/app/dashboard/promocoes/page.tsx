import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";

const statusLabels:Record<string,string>={draft:"Rascunho",published:"Em andamento",sold_out:"Esgotada",ready_to_draw:"Pronta para sortear",drawn:"Sorteada",cancelled:"Cancelada"};

export default async function PromotionsPage({searchParams}:{searchParams:Promise<{created?:string}>}){
 const {created}=await searchParams;
 const supabase=await createClient();
 const {data:promotions}=await supabase.from("promotions").select("id,name,slug,status,quota_quantity,quota_price,created_at").order("created_at",{ascending:false});
 const inProgress=(promotions||[]).filter(p=>["published","sold_out","ready_to_draw"].includes(p.status)).length;
 const drafts=(promotions||[]).filter(p=>p.status==="draft").length;

 return <main className={styles.main}>
  <div className={styles.heading}>
    <div><h1>Campanhas</h1><p>Crie, publique e acompanhe suas campanhas.</p></div>
    <Link className={styles.primary} href="/dashboard/promocoes/nova">Criar campanha</Link>
  </div>
  {created?<div className={styles.alertSuccess}>Campanha criada com sucesso.</div>:null}
  <section className={styles.infoGrid}>
    <article className={styles.infoCard}><span>Total de campanhas</span><strong>{promotions?.length??0}</strong></article>
    <article className={styles.infoCard}><span>Em andamento</span><strong>{inProgress}</strong></article>
    <article className={styles.infoCard}><span>Rascunhos</span><strong>{drafts}</strong></article>
  </section>
  <section className={styles.panel}>
    {!promotions?.length?<div className={styles.empty}>Você ainda não criou nenhuma campanha.</div>:<div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>Campanha</th><th>Status</th><th>Cotas</th><th>Valor da cota</th><th></th></tr></thead>
      <tbody>{promotions.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td><span className={styles.status}>{statusLabels[p.status]??p.status}</span></td><td>{p.quota_quantity.toLocaleString("pt-BR")}</td><td>{Number(p.quota_price).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</td><td><Link href={`/dashboard/promocoes/${p.id}`}>Abrir</Link></td></tr>)}</tbody>
    </table></div>}
  </section>
 </main>
}