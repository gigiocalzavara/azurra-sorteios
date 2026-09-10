import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";
import {addMember,removeMember,saveSettings,updateMemberRole} from "./actions";

type MemberRow={user_id:string;email:string;full_name:string|null;role:"superadmin"|"admin"|"manager"|"operator";created_at:string};
const roleLabel:{[key:string]:string}={superadmin:"Superadmin",admin:"Administrador",manager:"Gerente",operator:"Operador"};

export default async function Page({searchParams}:{searchParams:Promise<{saved?:string;error?:string;membersaved?:string;memberremoved?:string}>}){
 const query=await searchParams,supabase=await createClient(),{data:auth}=await supabase.auth.getUser();
 const {data:member}=await supabase.from("organization_members").select("organization_id,role").eq("user_id",auth.user!.id).limit(1).maybeSingle();
 const {data:profile}=await supabase.from("profiles").select("is_superadmin").eq("id",auth.user!.id).maybeSingle();
 const {data:org}=member?await supabase.from("organizations").select("*").eq("id",member.organization_id).single():{data:null};
 const canManageUsers=Boolean(profile?.is_superadmin||member?.role==="superadmin"||member?.role==="admin");
 const {data:members}=member&&canManageUsers?await supabase.rpc("list_org_members",{target_org:member.organization_id}):{data:[]};
 return <main className={styles.main}>
  <div className={styles.heading}><div><h1>Configurações</h1><p>Personalize a página pública, configure o PIX e gerencie os acessos da equipe.</p></div></div>
  {query.saved?<div className={styles.alertSuccess}>Configurações salvas.</div>:null}
  {query.membersaved?<div className={styles.alertSuccess}>Usuário e permissões atualizados.</div>:null}
  {query.memberremoved?<div className={styles.alertSuccess}>Acesso do usuário removido.</div>:null}
  {query.error?<div className={styles.alertError}>{query.error}</div>:null}
  {org?<>
   <form className={styles.form} action={saveSettings}>
    <section className={styles.section}><h2>Empresa e identidade</h2><div className={styles.fields}><label className={styles.field}><span>Nome</span><input name="name" required defaultValue={org.name}/></label><label className={styles.field}><span>Cor principal</span><input name="primaryColor" type="color" defaultValue={org.primary_color}/></label><label className={styles.field}><span>Cor secundária</span><input name="secondaryColor" type="color" defaultValue={org.secondary_color}/></label></div></section>
    <section className={styles.section}><h2>Recebimento via PIX</h2><div className={styles.fields}><label className={styles.field}><span>Tipo de chave</span><select name="pixKeyType" required defaultValue={org.pix_key_type||"phone"}><option value="phone">Telefone</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="random">Chave aleatória</option></select></label><label className={styles.field}><span>Chave PIX</span><input name="pixKey" required defaultValue={org.pix_key||""}/></label><label className={styles.field}><span>Nome do recebedor</span><input name="receiverName" required maxLength={25} defaultValue={org.pix_receiver_name||""}/></label><label className={styles.field}><span>Cidade do recebedor</span><input name="receiverCity" required maxLength={15} defaultValue={org.pix_receiver_city||""}/></label></div></section>
    <div className={styles.actions}><button className={styles.primary}>Salvar configurações</button></div>
   </form>
   {canManageUsers?<section className={styles.section} style={{marginTop:24}}>
    <h2>Usuários e permissões</h2><p>Vincule usuários já cadastrados no Supabase Auth e defina o nível de acesso ao sistema.</p>
    <form action={addMember} className={styles.form} style={{marginTop:16}}><div className={styles.fields}>
     <label className={styles.field}><span>E-mail do usuário</span><input name="email" type="email" required placeholder="usuario@empresa.com"/></label>
     <label className={styles.field}><span>Perfil</span><select name="role" defaultValue="operator"><option value="admin">Administrador</option><option value="manager">Gerente</option><option value="operator">Operador</option>{profile?.is_superadmin?<option value="superadmin">Superadmin</option>:null}</select></label>
    </div><div className={styles.actions}><button className={styles.primary}>Adicionar usuário</button></div></form>
    <div style={{display:"grid",gap:12,marginTop:20}}>{(members as MemberRow[]||[]).map(row=><div key={row.user_id} style={{border:"1px solid rgba(255,255,255,.12)",borderRadius:12,padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
      <div><strong>{row.full_name||row.email}</strong><div style={{opacity:.7,fontSize:14}}>{row.email} · {roleLabel[row.role]}</div></div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
       <form action={updateMemberRole} style={{display:"flex",gap:8}}><input type="hidden" name="userId" value={row.user_id}/><select name="role" defaultValue={row.role} disabled={row.user_id===auth.user!.id&&!profile?.is_superadmin}><option value="admin">Administrador</option><option value="manager">Gerente</option><option value="operator">Operador</option>{profile?.is_superadmin?<option value="superadmin">Superadmin</option>:null}</select><button className={styles.primary} disabled={row.user_id===auth.user!.id&&!profile?.is_superadmin}>Alterar</button></form>
       <form action={removeMember}><input type="hidden" name="userId" value={row.user_id}/><button disabled={row.user_id===auth.user!.id&&!profile?.is_superadmin}>Remover</button></form>
      </div>
     </div>)}</div>
   </section>:<section className={styles.section} style={{marginTop:24}}><h2>Usuários e permissões</h2><p>Somente administradores podem gerenciar usuários e permissões.</p></section>}
  </>:<div className={styles.alertError}>Organização não encontrada.</div>}
 </main>
}
