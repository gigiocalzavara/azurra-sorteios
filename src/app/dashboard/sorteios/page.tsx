import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";
import {createTestScenario} from "./actions";
const labels:Record<string,string>={published:"Em andamento",sold_out:"Esgotada",ready_to_draw:"Pronta para sortear",drawn:"Sorteada"};

export default async function Page({searchParams}:{searchParams:Promise<{error?:string;test?:string}>}){
 const query=await searchParams;
 const {data:promotions}=await (await createClient()).from("promotions").select("id,name,status,quota_quantity,draws(id,drawn_at,participant_snapshot,quotas(number))").in("status",["published","sold_out","ready_to_draw","drawn"]).order("created_at",{ascending:false});
 const ready=(promotions||[]).filter(p=>p.status==="ready_to_draw").length;
 const drawn=(promotions||[]).filter(p=>p.status==="drawn").length;

 return <main className={styles.main}>
  <div className={styles.heading}><div><h1>Sorteios</h1><p>Campanhas prontas, resultados e acesso à tela de sorteio.</p></div><form action={createTestScenario}><button className={styles.primary}>Criar cenário de teste</button></form></div>
  {query.test?<div className={styles.alertSuccess}>Cenário criado: 8 cotas aguardam confirmação e 2 estão livres para teste público.</div>:null}
  {query.error?<div className={styles.alertError}>{query.error}</div>:null}

  <section className={styles.infoGrid}>
    <article className={styles.infoCard}><span>Prontas para sortear</span><strong>{ready}</strong></article>
    <article className={styles.infoCard}><span>Sorteios concluídos</span><strong>{drawn}</strong></article>
  </section>

  <section className={styles.panel}>{!promotions?.length?<div className={styles.empty}>Nenhuma campanha disponível.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Campanha</th><th>Status</th><th>Cotas</th><th>Resultado</th><th></th></tr></thead><tbody>{promotions.map(p=>{const draw=Array.isArray(p.draws)?p.draws[0]:p.draws;return <tr key={p.id}><td><strong>{p.name}</strong></td><td><span className={styles.status}>{labels[p.status]||p.status}</span></td><td>{p.quota_quantity}</td><td>{draw?String((draw.participant_snapshot as {name?:string})?.name||"Sorteado"):"—"}</td><td>{p.status==="ready_to_draw"?<a className={styles.smallButton} href={`/sorteio/${p.id}`} target="_blank">Realizar sorteio</a>:p.status==="drawn"&&draw?<a className={styles.smallButton} href={`/sorteio/${draw.id}`} target="_blank">Ver resultado</a>:<span style={{color:"#7d828c"}}>Aguardando pagamentos</span>}</td></tr>})}</tbody></table></div>}</section>
 </main>
}