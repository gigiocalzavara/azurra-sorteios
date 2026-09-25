import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import styles from "../dashboard.module.css";
import local from "./communication.module.css";
import CopyButton from "./copy-button";
import WhatsAppConnection from "./whatsapp-connection";
import {completePostPurchase,markManualSent,saveTemplate,setPromotionMode} from "./actions";

const stages=[
  {key:"launch",label:"Lançamento",description:"Mensagem de abertura da campanha"},
  {key:"first_purchase",label:"Primeira compra",description:"Primeira conversão registrada"},
  {key:"progress_50",label:"50% vendido",description:"Metade das cotas preenchida"},
  {key:"progress_60",label:"60% vendido",description:"Campanha ganhando tração"},
  {key:"progress_85",label:"85% vendido",description:"Reta final da campanha"},
  {key:"last_quota",label:"Última cota",description:"Última oportunidade disponível"},
  {key:"sold_out",label:"Encerramento",description:"Todas as cotas preenchidas"},
  {key:"result",label:"Resultado",description:"Resultado e vencedor do sorteio"}
] as const;

const labels:Record<string,string>=Object.fromEntries(stages.map(s=>[s.key,s.label]));
const postStatus:Record<string,string>={automated:"Fluxo automático",awaiting_pix_contact:"Aguardando contato PIX",awaiting_shipping:"Aguardando envio",pix_paid:"PIX pago",product_sent:"Produto enviado",completed:"Concluído"};
const eventStatus:Record<string,string>={sent:"Enviada",failed:"Falhou",manual_required:"Enviar manualmente",pending:"Pendente",skipped:"Ignorada"};

export default async function Page({searchParams}:{searchParams:Promise<{tab?:string;promotion?:string;saved?:string;error?:string}>}){
 const query=await searchParams,tab=query.tab||"fluxo",supabase=await createClient();
 const {data:auth}=await supabase.auth.getUser();
 const {data:member}=await supabase.from("organization_members").select("organization_id").eq("user_id",auth.user!.id).limit(1).maybeSingle();
 if(!member)return <main className={styles.main}><div className={styles.alertError}>Organização não encontrada.</div></main>;

 const [{data:promotions},{data:templates}]=await Promise.all([
  supabase.from("promotions").select("id,name,status,quota_quantity").eq("organization_id",member.organization_id).order("created_at",{ascending:false}),
  supabase.from("communication_templates").select("*").eq("organization_id",member.organization_id).order("created_at")
 ]);

 const promotionId=query.promotion||promotions?.[0]?.id;
 const currentPromotion=promotions?.find(p=>p.id===promotionId);

 const [{data:events},{data:setting},{data:postFlows}]=promotionId?await Promise.all([
  supabase.from("communication_events").select("*").eq("promotion_id",promotionId).order("created_at",{ascending:true}),
  supabase.from("promotion_communication_settings").select("*").eq("promotion_id",promotionId).maybeSingle(),
  supabase.from("post_purchase_flows").select("id,phone_e164,stage,reward_type,delivery_address,operator_status,last_error,created_at,participants(name),products(name)").eq("promotion_id",promotionId).order("created_at",{ascending:false})
 ]):[{data:[]},{data:null},{data:[]}];

 const eventByStage=new Map((events||[]).map((event:any)=>[event.stage,event]));
 const pendingManual=(events||[]).filter((event:any)=>event.status==="manual_required"||event.status==="failed");
 const sent=(events||[]).filter((event:any)=>event.status==="sent").length;
 const mode=setting?.mode||"approval";

 return <main className={styles.main}>
  <div className={styles.heading}>
    <div>
      <h1>Central da campanha</h1>
      <p>A comunicação continua funcionando com ou sem WhatsApp conectado.</p>
    </div>
    <form className={local.toolbar}>
      <select name="promotion" defaultValue={promotionId}>{promotions?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <input type="hidden" name="tab" value={tab}/>
      <button className={styles.primary}>Abrir campanha</button>
    </form>
  </div>

  {query.saved?<div className={styles.alertSuccess}>Configuração salva.</div>:null}
  {query.error?<div className={styles.alertError}>{query.error}</div>:null}

  <div className={local.tabs}>
    <Link className={tab==="fluxo"?local.active:""} href={`/dashboard/comunicacao?promotion=${promotionId}&tab=fluxo`}>Fluxo da campanha</Link>
    <Link className={tab==="modelos"?local.active:""} href={`/dashboard/comunicacao?promotion=${promotionId}&tab=modelos`}>Mensagens base</Link>
    <Link className={tab==="posvenda"?local.active:""} href={`/dashboard/comunicacao?promotion=${promotionId}&tab=posvenda`}>Pós-sorteio</Link>
  </div>

  {promotionId&&tab==="fluxo"?<>
    <section className={local.summary}>
      <div>
        <span>Campanha</span>
        <strong>{currentPromotion?.name||"Campanha"}</strong>
      </div>
      <div>
        <span>Modo</span>
        <strong>{mode==="automatic"?"Automático":mode==="manual"?"Manual / contingência":"Assistido"}</strong>
      </div>
      <div>
        <span>Enviadas</span>
        <strong>{sent}</strong>
      </div>
      <div>
        <span>Ação manual</span>
        <strong>{pendingManual.length}</strong>
      </div>
    </section>

    {pendingManual.length?<section className={local.contingency}>
      <div>
        <strong>Contingência ativa</strong>
        <p>Existem mensagens desta campanha aguardando envio manual. Copie a mensagem, envie pelo WhatsApp Web e marque como enviada.</p>
      </div>
      <a href="https://web.whatsapp.com/" target="_blank" rel="noreferrer">Abrir WhatsApp Web</a>
    </section>:null}

    <WhatsAppConnection organizationId={member.organization_id} promotionId={promotionId} currentGroup={setting?.group_jid}/>

    <section className={local.mode}>
      <div>
        <strong>Como esta campanha deve operar</strong>
        <div>{setting?.group_name?`Grupo vinculado: ${setting.group_name}`:"Sem grupo vinculado — o fluxo manual continua disponível"}</div>
      </div>
      <form action={setPromotionMode}>
        <input type="hidden" name="promotionId" value={promotionId}/>
        <select name="mode" defaultValue={mode}>
          <option value="automatic">Automático quando WhatsApp estiver disponível</option>
          <option value="approval">Assistido — gerar e aprovar</option>
          <option value="manual">Manual / contingência</option>
        </select>
        <button>Salvar</button>
      </form>
    </section>

    <section className={local.timeline}>
      {stages.map((stage,index)=>{
        const event:any=eventByStage.get(stage.key);
        const isDone=event?.status==="sent";
        const needsAction=event&&["manual_required","failed"].includes(event.status);
        return <article className={`${local.timelineItem} ${isDone?local.done:""} ${needsAction?local.needsAction:""}`} key={stage.key}>
          <div className={local.timelineRail}>
            <span className={local.timelineNumber}>{isDone?"✓":index+1}</span>
          </div>
          <div className={local.timelineBody}>
            <div className={local.timelineHead}>
              <div>
                <strong>{stage.label}</strong>
                <p>{stage.description}</p>
              </div>
              <span className={local.timelineStatus}>{event?eventStatus[event.status]||event.status:"Aguardando condição"}</span>
            </div>

            {event?<div className={local.eventMessage}>
              <p>{event.rendered_message}</p>
              <div className={local.eventActions}>
                <CopyButton text={event.rendered_message}/>
                {event.media_url?<a href={event.media_url} target="_blank">Abrir mídia</a>:null}
                {event.status!=="sent"?<form action={markManualSent}>
                  <input type="hidden" name="id" value={event.id}/>
                  <button>Marcar como enviada</button>
                </form>:null}
              </div>
              {event.last_error?<small className={local.eventError}>{event.last_error}</small>:null}
              <small className={local.eventTime}>{new Date(event.created_at).toLocaleString("pt-BR")}</small>
            </div>:<div className={local.waiting}>A mensagem aparecerá aqui automaticamente quando a campanha atingir esta etapa.</div>}
          </div>
        </article>
      })}
    </section>
  </>:null}

  {tab==="modelos"?<>
    <section className={local.infoBox}>
      <strong>Mensagens base</strong>
      <p>Estes textos servem apenas como base. Quando um evento acontece, o Azurra gera a mensagem vinculada à campanha e salva essa versão no fluxo dela.</p>
    </section>
    <section className={local.templates}>{templates?.map((t:any)=><form className={local.template} action={saveTemplate} key={t.id}>
      <input type="hidden" name="id" value={t.id}/>
      <h3>{labels[t.stage]||t.title}</h3>
      <textarea name="message" defaultValue={t.message_template}/>
      <footer><label><input type="checkbox" name="enabled" defaultChecked={t.enabled}/> Ativa</label><button>Salvar base</button></footer>
    </form>)}</section>
  </>:null}

  {promotionId&&tab==="posvenda"?<>
    <section className={styles.panel}><h2>Fluxo de pós-sorteio</h2><p>Após o resultado, o atendimento ao vencedor segue a campanha até a escolha entre produto ou PIX.</p><div className={styles.flowGrid}>{["1. Resultado no grupo","2. Parabéns no privado","3. Escolha do produto","4. Produto ou PIX","5. Endereço, se produto","6. Operador conclui"].map(item=><div key={item} className={styles.flowStep}>{item}</div>)}</div></section>
    <section className={styles.panel} style={{marginTop:20}}><h2>Fila operacional</h2>{!postFlows?.length?<div className={styles.empty} style={{marginTop:16}}>Ainda não há vencedor em pós-venda nesta campanha.</div>:<div style={{display:"grid",gap:14,marginTop:18}}>{postFlows.map((flow:any)=>{const participant=Array.isArray(flow.participants)?flow.participants[0]:flow.participants;const product=Array.isArray(flow.products)?flow.products[0]:flow.products;return <article key={flow.id} className={styles.listCard}><div style={{display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}><div><strong>{participant?.name||"Vencedor"}</strong><div style={{marginTop:5}}>{flow.phone_e164}</div><div style={{marginTop:5}}>Produto: {product?.name||"Aguardando escolha"}</div><div style={{marginTop:5}}>Opção: {flow.reward_type==="pix"?"PIX":flow.reward_type==="product"?"Produto":"Aguardando escolha"}</div>{flow.delivery_address?<div style={{marginTop:5}}>Endereço: {flow.delivery_address}</div>:null}{flow.last_error?<div style={{marginTop:5,color:"#b42318"}}>Erro: {flow.last_error}</div>:null}</div><div><strong>{postStatus[flow.operator_status]||flow.operator_status}</strong>{flow.operator_status==="awaiting_pix_contact"?<form action={completePostPurchase} style={{marginTop:10}}><input type="hidden" name="id" value={flow.id}/><input type="hidden" name="promotionId" value={promotionId}/><input type="hidden" name="action" value="pix_paid"/><button className={styles.primary}>Marcar PIX como pago</button></form>:null}{flow.operator_status==="awaiting_shipping"?<form action={completePostPurchase} style={{marginTop:10}}><input type="hidden" name="id" value={flow.id}/><input type="hidden" name="promotionId" value={promotionId}/><input type="hidden" name="action" value="product_sent"/><button className={styles.primary}>Marcar produto como enviado</button></form>:null}</div></div></article>})}</div>}</section>
  </>:null}
 </main>
}