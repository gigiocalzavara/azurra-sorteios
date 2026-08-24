"use client";
import {useEffect,useRef,useState} from "react";
import styles from "./draw.module.css";

type Props={promotion:string;imageUrl:string|null;quotaQuantity:number;winningNumber:number;winnerName:string;organization:string;logoUrl:string|null;primaryColor:string;secondaryColor:string};
export default function DrawExperience(props:Props){
 const [phase,setPhase]=useState<"ready"|"countdown"|"rolling"|"winner">("ready");
 const [count,setCount]=useState(3);const [rolling,setRolling]=useState(1);const [recording,setRecording]=useState(false);const [message,setMessage]=useState("");
 const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);
 const run=()=>{setMessage("");setPhase("countdown");setCount(3);setTimeout(()=>setCount(2),900);setTimeout(()=>setCount(1),1800);setTimeout(()=>setPhase("rolling"),2700);setTimeout(()=>setPhase("winner"),7200)};
 useEffect(()=>{if(phase!=="rolling")return;const timer=setInterval(()=>setRolling(Math.floor(Math.random()*props.quotaQuantity)+1),75);return()=>clearInterval(timer)},[phase,props.quotaQuantity]);
 const record=async()=>{try{const captured=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:"browser"},audio:false});stream.current=captured;const preferred=["video/mp4;codecs=avc1","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));const chunks:Blob[]=[];const mediaRecorder=new MediaRecorder(captured,preferred?{mimeType:preferred}:undefined);recorder.current=mediaRecorder;mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};mediaRecorder.onstop=()=>{const type=mediaRecorder.mimeType||"video/webm";const extension=type.includes("mp4")?"mp4":"webm";const url=URL.createObjectURL(new Blob(chunks,{type}));const link=document.createElement("a");link.href=url;link.download=`resultado-${props.promotion.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setRecording(false);setMessage("Vídeo gravado e baixado com sucesso.")};captured.getVideoTracks()[0].onended=()=>{if(mediaRecorder.state!=="inactive")mediaRecorder.stop()};mediaRecorder.start(250);setRecording(true);run();setTimeout(()=>{if(mediaRecorder.state!=="inactive")mediaRecorder.stop();captured.getTracks().forEach(track=>track.stop())},11500)}catch{setMessage("A gravação foi cancelada. Selecione esta guia quando o navegador perguntar o que compartilhar.")}};
 return <main className={styles.page} style={{"--primary":props.primaryColor,"--secondary":props.secondaryColor} as React.CSSProperties}>
  <div className={styles.orbOne}/><div className={styles.orbTwo}/>
  <section className={styles.stage}>
   <header className={styles.brand}>{props.logoUrl?<img src={props.logoUrl} alt=""/>:<span className={styles.brandMark}>✦</span>}<strong>{props.organization}</strong></header>
   <div className={styles.promo}>{props.imageUrl?<img src={props.imageUrl} alt=""/>:null}<div><span>Sorteio oficial</span><h1>{props.promotion}</h1></div></div>
   <div className={styles.center}>
    {phase==="ready"?<><span className={styles.kicker}>Tudo pronto</span><h2>Vamos descobrir<br/>quem ganhou?</h2></>:null}
    {phase==="countdown"?<><span className={styles.kicker}>O sorteio começa em</span><div className={styles.count} key={count}>{count}</div></>:null}
    {phase==="rolling"?<><span className={styles.kicker}>Sorteando entre {props.quotaQuantity} cotas</span><div className={styles.ball}><span>{String(rolling).padStart(String(props.quotaQuantity).length,"0")}</span></div><p>Boa sorte!</p></>:null}
    {phase==="winner"?<><div className={styles.confetti}>{Array.from({length:32},(_,i)=><i key={i} style={{"--i":i} as React.CSSProperties}/>)}</div><span className={styles.kicker}>Temos um vencedor!</span><div className={styles.ballWinner}><span>{String(props.winningNumber).padStart(String(props.quotaQuantity).length,"0")}</span></div><h2 className={styles.winner}>{props.winnerName}</h2><p>Parabéns! Esta cota é a grande vencedora.</p></>:null}
   </div>
   <footer>Resultado registrado com segurança • {new Date().toLocaleDateString("pt-BR")}</footer>
  </section>
  <aside className={`${styles.controls} ${recording?styles.hidden:""}`}><button onClick={record}>Gravar sorteio</button><button className={styles.secondary} onClick={run}>Reproduzir sem gravar</button>{message?<p>{message}</p>:null}<small>Ao gravar, escolha “Esta guia” na janela do navegador.</small></aside>
 </main>
}
