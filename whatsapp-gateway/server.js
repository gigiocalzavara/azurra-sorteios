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
 ?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}):null;

app.use((req,res,next)=>{if(!token||req.headers.authorization!==`Bearer ${token}`)return res.status(401).json({error:"unauthorized"});next()});

async function connect(org){
 const id=safe(org),existing=sessions.get(id);
 if(existing?.status==="connected"||existing?.status==="connecting"||existing?.status==="qr")return existing;
 const state={status:"connecting",qr:null,phone:null,sock:null,groupCache:new Map()};sessions.set(id,state);
 const {state:auth,saveCreds}=await useMultiFileAuthState(`/data/${id}`);
 const {version}=await fetchLatestBaileysVersion();
 const sock=makeWASocket({version,auth,logger,printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:false,cachedGroupMetadata:async jid=>state.groupCache.get(jid)});
 state.sock=sock;sock.ev.on("creds.update",saveCreds);
 sock.ev.on("groups.update",async updates=>{for(const update of updates){try{state.groupCache.set(update.id,await sock.groupMetadata(update.id))}catch{}}});
 sock.ev.on("connection.update",async update=>{
  if(update.qr){state.qr=await QRCode.toDataURL(update.qr,{margin:1,width:320});state.status="qr"}
  if(update.connection==="open"){state.status="connected";state.qr=null;state.phone=sock.user?.id?.split(":")[0]||null;logger.info({organization:id},"WhatsApp connected")}
  if(update.connection==="close"){const code=update.lastDisconnect?.error?.output?.statusCode;state.status="disconnected";state.sock=null;logger.warn({organization:id,code},"WhatsApp disconnected");if(code!==DisconnectReason.loggedOut)setTimeout(()=>connect(id).catch(error=>logger.error(error)),3000)}
 });return state;
}

async function sendMessage(org,jid,text,mediaUrl){
 const session=sessions.get(safe(org));if(!session?.sock||session.status!=="connected")throw new Error("WhatsApp desconectado");
 let payload={text};if(mediaUrl)payload={video:{url:mediaUrl},caption:text};
 return session.sock.sendMessage(jid,payload);
}

app.get("/health",(_,res)=>res.json({ok:true}));
app.post("/sessions/:org/connect",async(req,res)=>{try{const s=await connect(req.params.org);res.json({status:s.status,qr:s.qr,phone:s.phone})}catch(error){res.status(500).json({error:error.message})}});
app.get("/sessions/:org/status",(req,res)=>{const s=sessions.get(safe(req.params.org));res.json({status:s?.status||"disconnected",qr:s?.qr||null,phone:s?.phone||null})});
app.delete("/sessions/:org",async(req,res)=>{const id=safe(req.params.org),s=sessions.get(id);try{await s?.sock?.logout()}catch{}sessions.delete(id);res.json({ok:true})});
app.get("/sessions/:org/groups",async(req,res)=>{const s=sessions.get(safe(req.params.org));if(!s?.sock||s.status!=="connected")return res.status(409).json({error:"WhatsApp desconectado"});try{const groups=await s.sock.groupFetchAllParticipating();res.json(Object.values(groups).map(g=>({id:g.id,subject:g.subject,participants:g.participants?.length||0})).sort((a,b)=>a.subject.localeCompare(b.subject)))}catch(error){res.status(500).json({error:error.message})}});
app.post("/sessions/:org/send",async(req,res)=>{try{const result=await sendMessage(req.params.org,req.body.jid,req.body.text,req.body.mediaUrl);res.json({ok:true,messageId:result?.key?.id})}catch(error){res.status(500).json({error:error.message})}});

let working=false;
async function processQueue(){
 if(!supabase||working)return;working=true;
 try{
  const {data:events,error}=await supabase.from("communication_events").select("id,organization_id,promotion_id,rendered_message,media_url,attempts,status").in("status",["pending","manual_required"]).lt("attempts",3).lte("scheduled_at",new Date().toISOString()).order("scheduled_at").limit(10);
  if(error)throw error;
  for(const event of events||[]){
   const {data:settings,error:settingsError}=await supabase.from("promotion_communication_settings").select("mode,active,group_jid").eq("promotion_id",event.promotion_id).maybeSingle();
   if(settingsError){logger.error(settingsError);continue}
   if(!settings?.active||settings.mode!=="automatic"||!settings.group_jid)continue;
   const session=sessions.get(safe(event.organization_id));
   if(!session?.sock||session.status!=="connected"){if(event.status==="pending")await supabase.from("communication_events").update({status:"manual_required",last_error:"WhatsApp desconectado; aguardando reconexão",updated_at:new Date().toISOString()}).eq("id",event.id);continue}
   try{
    const result=await sendMessage(event.organization_id,settings.group_jid,event.rendered_message,event.media_url);
    await supabase.from("communication_events").update({status:"sent",sent_at:new Date().toISOString(),attempts:event.attempts+1,last_error:null,updated_at:new Date().toISOString()}).eq("id",event.id);
   }catch(error){await supabase.from("communication_events").update({status:"manual_required",attempts:event.attempts+1,last_error:error.message,updated_at:new Date().toISOString()}).eq("id",event.id)}
  }
 }catch(error){logger.error(error,"Queue processing failed")}finally{working=false}
}

async function restoreSessions(){
 if(!supabase)return;const {data:settings}=await supabase.from("promotion_communication_settings").select("promotions(organization_id)").not("group_jid","is",null);
 const organizations=new Set((settings||[]).map(item=>Array.isArray(item.promotions)?item.promotions[0]?.organization_id:item.promotions?.organization_id).filter(Boolean));
 for(const organization of organizations)connect(organization).catch(error=>logger.error(error));
}

setInterval(()=>processQueue(),5000);
app.listen(port,"0.0.0.0",()=>{logger.info(`gateway on ${port}`);restoreSessions()});
