import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import makeWASocket,{DisconnectReason,fetchLatestBaileysVersion,useMultiFileAuthState} from "@whiskeysockets/baileys";
import {createClient} from "@supabase/supabase-js";

const app=express();
app.use(express.json({limit:"2mb"}));
const port=Number(process.env.PORT||3100);
const token=process.env.GATEWAY_TOKEN||"";
const sessions=new Map();
const logger=pino({level:process.env.LOG_LEVEL||"info"});
const safe=id=>String(id).replace(/[^a-zA-Z0-9_-]/g,"");
const supabase=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY
  ?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
  :null;
const worker={running:false,lastCycleAt:null,lastSuccessAt:null,lastError:null,lastProcessed:0,totalSent:0};

app.use((req,res,next)=>{if(!token||req.headers.authorization!==`Bearer ${token}`)return res.status(401).json({error:"unauthorized"});next()});

const jidFor=phone=>`${String(phone).replace(/\D/g,"")}@s.whatsapp.net`;
async function sendMessage(org,jid,text,mediaUrl){
 const s=sessions.get(safe(org));
 if(!s?.sock||s.status!=="connected")throw new Error("WhatsApp desconectado");
 const payload=mediaUrl?{video:{url:mediaUrl},caption:text}:{text};
 return s.sock.sendMessage(jid,payload);
}

async function productMenu(flow){
 const {data,error}=await supabase.from("promotion_products").select("product_id,display_order,products(name)").eq("promotion_id",flow.promotion_id).order("display_order");
 if(error)throw error;
 const rows=data||[];
 return {rows,text:`🏆 Parabéns! Você foi o vencedor.\n\nDigite o número do produto que você quer:\n${rows.map((r,i)=>`${i+1}. ${r.products?.name||"Produto"}`).join("\n")}`};
}

async function startPostPurchase(flow){
 const menu=await productMenu(flow);
 if(!menu.rows.length)throw new Error("Promoção sem produtos");
 const result=await sendMessage(flow.organization_id,jidFor(flow.phone_e164),menu.text);
 const {error}=await supabase.from("post_purchase_flows").update({stage:"awaiting_product",started_at:new Date().toISOString(),last_message_id:result?.key?.id,last_error:null}).eq("id",flow.id);
 if(error)throw error;
}

async function handleWinnerReply(org,phone,text){
 if(!supabase)return false;
 const {data:flow,error}=await supabase.from("post_purchase_flows").select("id,organization_id,promotion_id,phone_e164,stage,selected_product_id,promotions(post_draw_pix_amount)").eq("organization_id",org).eq("phone_e164",phone).in("stage",["awaiting_product","awaiting_reward_type","awaiting_address"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(error)throw error;
 if(!flow)return false;
 const answer=String(text||"").trim();
 if(flow.stage==="awaiting_product"){
  const menu=await productMenu(flow),index=Number(answer)-1;
  if(!Number.isInteger(index)||!menu.rows[index]){await sendMessage(org,jidFor(phone),`Opção inválida.\n\n${menu.text}`);return true;}
  await supabase.from("post_purchase_flows").update({selected_product_id:menu.rows[index].product_id,stage:"awaiting_reward_type"}).eq("id",flow.id);
  const promo=Array.isArray(flow.promotions)?flow.promotions[0]:flow.promotions;
  const amount=Number(promo?.post_draw_pix_amount||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  await sendMessage(org,jidFor(phone),`Você prefere receber o produto escolhido ou um PIX no valor de ${amount}?\n\n1. PIX\n2. Produto`);
  return true;
 }
 if(flow.stage==="awaiting_reward_type"){
  if(answer==="1"){
   const {error:updateError}=await supabase.from("post_purchase_flows").update({reward_type:"pix",stage:"completed",operator_status:"awaiting_pix_contact",completed_at:null}).eq("id",flow.id);
   if(updateError)throw updateError;
   await sendMessage(org,jidFor(phone),"Obrigado! Registramos sua escolha pelo PIX. Um operador entrará em contato para combinar os dados e realizar o pagamento.");
   return true;
  }
  if(answer==="2"){
   const {error:updateError}=await supabase.from("post_purchase_flows").update({reward_type:"product",stage:"awaiting_address"}).eq("id",flow.id);
   if(updateError)throw updateError;
   await sendMessage(org,jidFor(phone),"Perfeito. Envie seu endereço completo para entrega, incluindo rua, número, complemento (se houver), bairro, cidade, estado e CEP.");
   return true;
  }
  await sendMessage(org,jidFor(phone),"Digite 1 para PIX ou 2 para Produto.");return true;
 }
 if(flow.stage==="awaiting_address"){
  if(answer.length<10){await sendMessage(org,jidFor(phone),"Por favor, envie o endereço completo para conseguirmos organizar a entrega.");return true;}
  const {error:updateError}=await supabase.from("post_purchase_flows").update({delivery_address:answer,stage:"completed",operator_status:"awaiting_shipping",completed_at:null}).eq("id",flow.id);
  if(updateError)throw updateError;
  await sendMessage(org,jidFor(phone),"Obrigado! Recebemos seu endereço. Agora nossa equipe vai organizar o envio do seu prêmio.");
  return true;
 }
 return false;
}

async function connect(org){
 const id=safe(org),existing=sessions.get(id);
 if(existing?.status==="connected"||existing?.status==="connecting"||existing?.status==="qr")return existing;
 const state={status:"connecting",qr:null,phone:null,sock:null,groupCache:new Map(),groupList:null,groupListFetchedAt:0};
 sessions.set(id,state);
 const {state:auth,saveCreds}=await useMultiFileAuthState(`/data/${id}`);
 const {version}=await fetchLatestBaileysVersion();
 const sock=makeWASocket({version,auth,logger,printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:false,cachedGroupMetadata:async jid=>state.groupCache.get(jid)});
 state.sock=sock;
 sock.ev.on("creds.update",saveCreds);
 sock.ev.on("messages.upsert",async({messages})=>{for(const m of messages||[]){if(m.key.fromMe||!m.key.remoteJid?.endsWith("@s.whatsapp.net"))continue;const text=m.message?.conversation||m.message?.extendedTextMessage?.text||"",phone=`+${m.key.remoteJid.split("@")[0]}`;try{await handleWinnerReply(id,phone,text)}catch(error){logger.error(error,"post purchase reply failed")}}});
 sock.ev.on("connection.update",async update=>{
  if(update.qr){state.qr=await QRCode.toDataURL(update.qr,{margin:1,width:320});state.status="qr";}
  if(update.connection==="open"){state.status="connected";state.qr=null;state.phone=sock.user?.id?.split(":")[0]||null;state.groupList=null;state.groupListFetchedAt=0;logger.info({organization:id},"WhatsApp connected");}
  if(update.connection==="close"){
   const code=update.lastDisconnect?.error?.output?.statusCode;
   state.status="disconnected";state.sock=null;state.groupList=null;state.groupListFetchedAt=0;
   logger.warn({organization:id,code},"WhatsApp disconnected");
   if(code!==DisconnectReason.loggedOut)setTimeout(()=>connect(id).catch(error=>logger.error(error)),3000);
  }
 });
 return state;
}

app.get("/health",(_,res)=>res.json({ok:true,supabaseConfigured:Boolean(supabase),worker}));
app.post("/sessions/:org/connect",async(req,res)=>{try{const s=await connect(req.params.org);res.json({status:s.status,qr:s.qr,phone:s.phone})}catch(error){res.status(500).json({error:error.message})}});
app.get("/sessions/:org/status",(req,res)=>{const s=sessions.get(safe(req.params.org));res.json({status:s?.status||"disconnected",qr:s?.qr||null,phone:s?.phone||null})});
app.get("/sessions/:org/worker",(req,res)=>{const s=sessions.get(safe(req.params.org));res.json({configured:Boolean(supabase),worker,sessionStatus:s?.status||"disconnected",phone:s?.phone||null})});
app.post("/sessions/:org/process",async(req,res)=>{try{await processQueue(req.params.org);res.json({ok:true,worker})}catch(error){res.status(500).json({error:error.message,worker})}});
app.delete("/sessions/:org",async(req,res)=>{const id=safe(req.params.org),s=sessions.get(id);try{await s?.sock?.logout()}catch{}sessions.delete(id);res.json({ok:true})});
app.get("/sessions/:org/groups",async(req,res)=>{const s=sessions.get(safe(req.params.org));if(!s?.sock||s.status!=="connected")return res.status(409).json({error:"WhatsApp desconectado"});try{const now=Date.now();if(s.groupList&&now-s.groupListFetchedAt<60000)return res.json(s.groupList);const groups=await s.sock.groupFetchAllParticipating();const list=Object.values(groups).map(g=>({id:g.id,subject:g.subject,participants:g.participants?.length||0}));s.groupList=list;s.groupListFetchedAt=now;res.json(list)}catch(error){if(String(error?.message||error).includes("rate-overlimit")&&s.groupList)return res.json(s.groupList);res.status(500).json({error:error.message})}});
app.post("/sessions/:org/send",async(req,res)=>{try{const result=await sendMessage(req.params.org,req.body.jid,req.body.text,req.body.mediaUrl);res.json({ok:true,messageId:result?.key?.id})}catch(error){res.status(500).json({error:error.message})}});

let working=false;
async function processQueue(onlyOrg=null){
 if(!supabase){worker.lastError="SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no gateway";return;}
 if(working)return;
 working=true;worker.running=true;worker.lastCycleAt=new Date().toISOString();worker.lastProcessed=0;
 try{
  let query=supabase.from("communication_events").select("id,organization_id,promotion_id,stage,rendered_message,media_url,attempts,status").in("status",["pending","manual_required"]).lt("attempts",3).lte("scheduled_at",new Date().toISOString()).order("scheduled_at").limit(20);
  if(onlyOrg)query=query.eq("organization_id",onlyOrg);
  const {data:events,error:eventsError}=await query;
  if(eventsError)throw new Error(`Fila de comunicação: ${eventsError.message}`);
  for(const event of events||[]){
   const {data:settings,error:settingsError}=await supabase.from("promotion_communication_settings").select("mode,active,group_jid").eq("promotion_id",event.promotion_id).maybeSingle();
   if(settingsError){logger.error(settingsError,"communication settings failed");continue;}
   if(!settings?.active||!settings.group_jid)continue;
   if(settings.mode!=="automatic"&&event.stage!=="launch"&&event.stage!=="result"&&event.stage!=="sold_out")continue;
   let session=sessions.get(safe(event.organization_id));
   if(!session||session.status==="disconnected"){
    try{session=await connect(event.organization_id)}catch(error){logger.error(error,"session restore failed");continue;}
   }
   if(!session?.sock||session.status!=="connected")continue;
   try{
    await sendMessage(event.organization_id,settings.group_jid,event.rendered_message,event.media_url);
    const {error:updateError}=await supabase.from("communication_events").update({status:"sent",sent_at:new Date().toISOString(),attempts:event.attempts+1,last_error:null}).eq("id",event.id);
    if(updateError)throw updateError;
    worker.lastProcessed++;worker.totalSent++;
   }catch(error){
    logger.error({error:event?.id,message:error.message},"communication send failed");
    await supabase.from("communication_events").update({status:"manual_required",attempts:event.attempts+1,last_error:error.message}).eq("id",event.id);
   }
  }
  let flowQuery=supabase.from("post_purchase_flows").select("id,organization_id,promotion_id,phone_e164,stage").eq("stage","pending_send").order("created_at").limit(10);
  if(onlyOrg)flowQuery=flowQuery.eq("organization_id",onlyOrg);
  const {data:flows,error:flowsError}=await flowQuery;
  if(flowsError)throw new Error(`Fila pós-venda: ${flowsError.message}`);
  for(const flow of flows||[]){
   let session=sessions.get(safe(flow.organization_id));
   if(!session||session.status==="disconnected"){try{session=await connect(flow.organization_id)}catch(error){logger.error(error,"post-sale session restore failed");continue;}}
   if(!session?.sock||session.status!=="connected")continue;
   try{await startPostPurchase(flow)}catch(error){logger.error(error,"post-sale send failed");await supabase.from("post_purchase_flows").update({stage:"failed",last_error:error.message}).eq("id",flow.id);}
  }
  worker.lastSuccessAt=new Date().toISOString();worker.lastError=null;
 }catch(error){worker.lastError=error.message;logger.error(error,"Queue processing failed");}
 finally{working=false;worker.running=false;}
}

async function restoreSessions(){
 if(!supabase)return;
 const {data:settings,error:settingsError}=await supabase.from("promotion_communication_settings").select("promotions(organization_id)").not("group_jid","is",null);
 const {data:flows,error:flowsError}=await supabase.from("post_purchase_flows").select("organization_id").in("stage",["pending_send","awaiting_product","awaiting_reward_type","awaiting_address"]);
 if(settingsError||flowsError){logger.error({settingsError,flowsError},"restore sessions query failed");return;}
 const organizations=new Set([...(settings||[]).map(item=>Array.isArray(item.promotions)?item.promotions[0]?.organization_id:item.promotions?.organization_id),...(flows||[]).map(f=>f.organization_id)].filter(Boolean));
 for(const organization of organizations)connect(organization).catch(error=>logger.error(error));
}

setInterval(()=>processQueue(),5000);
app.listen(port,"0.0.0.0",()=>{logger.info(`gateway on ${port}`);restoreSessions();setTimeout(()=>processQueue(),1500)});
