import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";
import {createTestScenario,performDraw} from "./actions";
type Result={winning_number:number;winner_name:string;winner_phone:string};
export default async function Page({searchParams}:{searchParams:Promise<{error?:string;draw?:string;test?:string}>}){
 const query=await searchParams;let result:Result|null=null;
 try{result=query.draw?JSON.parse(query.draw):null}catch{}
 const {data:promotions}=await (await createClient()).from("promotions").select("id,name,status,quota_quantity,draws(drawn_at,participant_snapshot,quotas(number))").in("status",["published","sold_out","ready_to_draw","drawn"]).order("created_at",{ascending:false});
 return <main className={styles.main}>
  <div className={styles.heading}><div><h1>Sorteios</h1><p>O botão é liberado somente quando todas as cotas estão pagas.</p></div><form action={createTestScenario}><button className={styles.primary}>Criar cenário de teste</button></form></div>
  {query.test?<div className={styles.alertSuccess}>Cenário criado: 8 cotas aguardam confirmação e 2 estão livres para teste público.</div>:null}
  {query.error?<div className={styles.alertError}>{query.error}</div>:null}
  {result?<section className={styles.winner}><span>Número sorteado</span><strong>{result.winning_number}</strong><h2>{result.winner_name}</h2><p>{result.winner_phone}</p></section>:null}
  <section className={styles.panel}>{!promotions?.length?<div className={styles.empty}>Nenhuma promoção disponível.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Promoção</th><th>Status</th><th>Cotas</th><th>Resultado</th><th></th></tr></thead><tbody>{promotions.map(p=>{const draw=Array.isArray(p.draws)?p.draws[0]:p.draws;return <tr key={p.id}><td><strong>{p.name}</strong></td><td><span className={styles.status}>{p.status}</span></td><td>{p.quota_quantity}</td><td>{draw?String((draw.participant_snapshot as {name?:string})?.name||"Sorteado"):"—"}</td><td>{p.status==="ready_to_draw"?<form action={performDraw}><input type="hidden" name="id" value={p.id}/><button className={styles.smallButton}>Realizar sorteio</button></form>:p.status==="drawn"?"Concluído":"Aguardando pagamentos"}</td></tr>})}</tbody></table></div>}</section>
 </main>
}
