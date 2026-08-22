"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { buildPixPayload } from "@/lib/pix";
import styles from "./public.module.css";

type Reservation = { order_id: string; numbers: number[]; total_amount: number; expires_at: string };

export default function PurchaseForm(props: {
  promotionId: string; price: number; minimum: number; maximum: number | null; available: number;
  pixKey: string | null; receiverName: string | null; receiverCity: string | null;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [count, setCount] = useState(props.minimum);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [qr, setQr] = useState("");
  const total = useMemo(() => count * props.price, [count, props.price]);
  const pixCode = reservation && props.pixKey ? buildPixPayload({
    key: props.pixKey, receiverName: props.receiverName || "RECEBEDOR",
    receiverCity: props.receiverCity || "CIDADE", amount: Number(reservation.total_amount),
    reference: reservation.order_id.slice(0, 20)
  }) : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("reserve_random_quotas", {
      target_promotion: props.promotionId, participant_name: name,
      participant_phone: phone, requested_count: count
    });
    if (rpcError) { setError("Não foi possível reservar as cotas. Confira os dados ou tente outra quantidade."); setLoading(false); return; }
    const result = data as Reservation; setReservation(result);
    if (props.pixKey) setQr(await QRCode.toDataURL(buildPixPayload({
      key: props.pixKey, receiverName: props.receiverName || "RECEBEDOR",
      receiverCity: props.receiverCity || "CIDADE", amount: Number(result.total_amount),
      reference: result.order_id.slice(0, 20)
    }), { width: 440, margin: 1 }));
    setLoading(false);
  }

  if (reservation) return <div className={styles.payment}>
    <div className={styles.success}>Cotas reservadas com sucesso!</div>
    <div><strong>Seus números</strong><div className={styles.numbers}>{reservation.numbers.map(number => <span className={styles.number} key={number}>{number}</span>)}</div></div>
    <div className={styles.summary}><span>Total do PIX</span><span>{Number(reservation.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div>
    {pixCode ? <><img className={styles.qr} src={qr} alt="QR Code PIX" /><div className={styles.code}>{pixCode}</div><button className={styles.copy} type="button" onClick={() => navigator.clipboard.writeText(pixCode)}>Copiar código PIX</button></> : <div className={styles.error}>O recebedor ainda não configurou a chave PIX. Entre em contato para concluir o pagamento.</div>}
    <div className={styles.notice}>A reserva vale até {new Date(reservation.expires_at).toLocaleString("pt-BR")}. O pagamento ainda precisa ser confirmado pelo responsável.</div>
  </div>;

  return <form className={styles.form} onSubmit={submit}>
    <label className={styles.field}>Seu nome<input value={name} onChange={e => setName(e.target.value)} minLength={2} required /></label>
    <label className={styles.field}>WhatsApp com DDD<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(83) 99999-9999" required /></label>
    <label className={styles.field}>Quantidade de cotas<input type="number" value={count} onChange={e => setCount(Number(e.target.value))} min={props.minimum} max={Math.min(props.maximum || props.available, props.available)} required /></label>
    <div className={styles.summary}><span>Total</span><span>{total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></div>
    {error ? <div className={styles.error}>{error}</div> : null}
    <button className={styles.button} disabled={loading || props.available < props.minimum}>{loading ? "Reservando..." : "Escolher meus números"}</button>
    <div className={styles.notice}>Os números são selecionados aleatoriamente entre as cotas disponíveis.</div>
  </form>;
}
