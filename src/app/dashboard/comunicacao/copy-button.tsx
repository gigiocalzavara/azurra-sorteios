"use client";
import {useState} from "react";
export default function CopyButton({text}:{text:string}){const [copied,setCopied]=useState(false);return <button type="button" onClick={async()=>{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1800)}}>{copied?"Copiado!":"Copiar mensagem"}</button>}
