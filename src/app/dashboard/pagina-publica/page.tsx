import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";

const labels:Record<string,string>={draft:"Rascunho",published:"Em andamento",sold_out:"Esgotada",ready_to_draw:"Pronta para sortear",drawn:"Sorteada",cancelled:"Cancelada"};

export default async function Page(){
 const supabase=await createClient();
 const {data:promotions}=await supabase.from("promotions").select("id,name,slug,status,organizations(slug)").order("created_at",{ascending:false});
 return <main className={styles.main}>
  <div className={styles.heading}><div><h1>Páginas públicas</h1><p>Acesse e compartilhe os links das campanhas com os participantes.</p></div></div>
  <section className={styles.panel}>
    {!promotions?.length?<div className={styles.empty}>Nenhuma campanha cadastrada.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Campanha</th><th>Status</th><th>Ação</th></tr></thead><tbody>{promotions.map(p=>{const org=Array.isArray(p.organizations)?p.organizations[0]:p.organizations,url=`/p/${org?.slug}/${p.slug}`;return <tr key={p.id}><td><strong>{p.name}</strong></td><td><span className={styles.status}>{labels[p.status]||p.status}</span></td><td>{p.status==="draft"?<Link href={`/dashboard/promocoes/${p.id}`}>Concluir publicação</Link>:<Link className={styles.smallButton} href={url} target="_blank">Abrir página</Link>}</td></tr>})}</tbody></table></div>}
  </section>
 </main>
}