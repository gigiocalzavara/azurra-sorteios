"use client";
import {FormEvent,useMemo,useState} from "react";
import {LoaderCircle,Minus,Plus} from "lucide-react";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";
import styles from "./public-promotion.module.css";
type Props={organizationSlug:string;promotionSlug:string;quotaPrice:number;minimum:number;maximum:number;reservationMinutes:number;disabled:boolean};
const money=(v:number)=>v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
export function PurchaseForm(p:Props){
 const router=useRouter(),[quantity,setQuantity]=useState(p.minimum),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const total=useMemo(()=>p.quotaPrice*quantity,[p.quotaPrice,quantity]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setLoading(true);setError("");const f=new FormData(e.currentTarget);const phone=`+55${String(f.get("phone")||"").replace(/\D/g,"").replace(/^55/,"")}`;const {data,error:err}=await createClient().rpc("create_public_order",{organization_slug:p.organizationSlug,promotion_slug:p.promotionSlug,participant_name:f.get("name"),participant_phone:phone,requested_quota_count:quantity});if(err){setError(err.message);setLoading(false);return}const token=(data as {public_token:string}).public_token;localStorage.setItem(`azurra-order-${token}`,phone);router.push(`/pagamento/${token}`)}
 return <form className={styles.box} onSubmit={submit}><div className={styles.price}><span>Valor da cota</span><strong>{money(p.quotaPrice)}</strong></div><label>Quantas cotas você quer?</label><div className={styles.counter}><button type="button" onClick={()=>setQuantity(v=>Math.max(p.minimum,v-1))}><Minus/></button><strong>{quantity}</strong><button type="button" onClick={()=>setQuantity(v=>Math.min(p.maximum,v+1))}><Plus/></button></div><label htmlFor="name">Seu nome</label><input id="name" name="name" minLength={2} maxLength={120} required placeholder="Nome completo"/><label htmlFor="phone">Seu WhatsApp</label><input id="phone" name="phone" inputMode="tel" minLength={10} required placeholder="(83) 99999-9999"/><button className={styles.buy} disabled={p.disabled||loading}>{loading?<><LoaderCircle className={styles.spin}/> Reservando...</>:p.disabled?"Cotas esgotadas":`Reservar ${quantity} ${quantity===1?"cota":"cotas"} • ${money(total)}`}</button><small className={styles.hint}>Os números são escolhidos aleatoriamente entre os disponíveis.</small>{error?<div className={styles.error}>{error}</div>:null}</form>
}
