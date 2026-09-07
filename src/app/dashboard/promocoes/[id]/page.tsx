import Link from "next/link";
import {notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import styles from "../../dashboard.module.css";

export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{published?:string}>}){
  const {id}=await params;
  const query=await searchParams;
  const supabase=await createClient();
  const {data:p}=await supabase.from("promotions").select("*,organizations(name,slug,pix_key)").eq("id",id).maybeSingle();
  if(!p)notFound();
  const org=Array.isArray(p.organizations)?p.organizations[0]:p.organizations;
  const url=`/p/${org.slug}/${p.slug}`;
  const {count}=await supabase.from("quotas").select("id",{count:"exact",head:true}).eq("promotion_id",id).eq("status","paid");
  return <main className={styles.main}>
    <div className={styles.heading}>
      <div><h1>{p.name}</h1><p>{count??0} de {p.quota_quantity} cotas pagas.</p></div>
      <Link className={styles.primary} href="/dashboard/promocoes">Voltar</Link>
    </div>
    {query.published?<div className={styles.alertSuccess}>Promoção publicada com sucesso. A comunicação está vinculada ao grupo configurado.</div>:null}
    <section className={styles.panel}>
      <p><strong>Status:</strong> {p.status}</p>
      <p><strong>PIX:</strong> {org.pix_key||"Não configurado"}</p>
      {p.status==="draft"?
        <div style={{marginTop:18}}>
          <p>Este rascunho ainda precisa concluir comunicação e revisão antes de ser publicado.</p>
          <Link className={styles.primary} href={`/dashboard/promocoes/${id}/configuracao?step=2`}>Continuar configuração</Link>
        </div>
        :<p><strong>Link público:</strong> <Link href={url}>{url}</Link></p>}
    </section>
  </main>
}
