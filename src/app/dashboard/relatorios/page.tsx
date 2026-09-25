import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";

export default async function ReportsPage(){
 const supabase=await createClient();
 const [{data:promotions},{data:orders},{data:participants}]=await Promise.all([
  supabase.from("promotions").select("id,name,status,quota_quantity,quota_price,created_at").order("created_at",{ascending:false}),
  supabase.from("orders").select("status,total_amount,quota_count,promotion_id"),
  supabase.from("participants").select("id")
 ]);
 const paidOrders=(orders||[]).filter(o=>o.status==="paid");
 const totalRevenue=paidOrders.reduce((s,o)=>s+Number(o.total_amount),0);
 const soldQuotas=paidOrders.reduce((s,o)=>s+Number(o.quota_count||0),0);
 const active=(promotions||[]).filter(p=>["published","sold_out","ready_to_draw"].includes(p.status)).length;

 return <main className={styles.main}>
  <div className={styles.heading}><div><h1>Relatórios</h1><p>Resumo da operação das suas campanhas.</p></div></div>
  <section className={styles.stats}>
    <article className={styles.stat}><span>Campanhas ativas</span><strong>{active}</strong></article>
    <article className={styles.stat}><span>Cotas vendidas</span><strong>{soldQuotas.toLocaleString("pt-BR")}</strong></article>
    <article className={styles.stat}><span>Participantes</span><strong>{participants?.length??0}</strong></article>
    <article className={styles.stat}><span>Receita confirmada</span><strong>{totalRevenue.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</strong></article>
  </section>

  <section className={styles.panel}>
    <h2 style={{marginTop:0}}>Desempenho por campanha</h2>
    {!promotions?.length?<div className={styles.empty}>Nenhuma campanha cadastrada.</div>:<div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>Campanha</th><th>Status</th><th>Cotas pagas</th><th>Receita</th><th></th></tr></thead>
      <tbody>{promotions.map(p=>{
        const campaignOrders=paidOrders.filter(o=>o.promotion_id===p.id);
        const quotas=campaignOrders.reduce((s,o)=>s+Number(o.quota_count||0),0);
        const revenue=campaignOrders.reduce((s,o)=>s+Number(o.total_amount),0);
        return <tr key={p.id}><td><strong>{p.name}</strong></td><td><span className={styles.status}>{p.status}</span></td><td>{quotas.toLocaleString("pt-BR")} / {p.quota_quantity.toLocaleString("pt-BR")}</td><td>{revenue.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</td><td><Link href={`/dashboard/promocoes/${p.id}`}>Abrir</Link></td></tr>
      })}</tbody>
    </table></div>}
  </section>
 </main>
}