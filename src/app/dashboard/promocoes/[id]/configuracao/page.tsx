import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, MessageCircle, PackageCheck, Rocket } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import styles from "../../../dashboard.module.css";
import WhatsAppConnection from "../../../comunicacao/whatsapp-connection";
import { publishPromotion, savePromotionCommunication } from "../actions";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; error?: string }>;
};

const stepStyle = (active: boolean, done: boolean) => ({
  flex: 1,
  minWidth: 180,
  padding: "16px 18px",
  borderRadius: 16,
  border: active ? "2px solid #6d00ff" : "1px solid #dfe3ee",
  background: done ? "#f4efff" : "#fff",
  fontWeight: 800,
});

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const step = Math.min(3, Math.max(2, Number(query.step || 2)));
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: promotion } = await supabase
    .from("promotions")
    .select("id,name,status,description,campaign_image_url,quota_quantity,quota_price,post_draw_pix_amount,organization_id,organizations(name,pix_key)")
    .eq("id", id)
    .maybeSingle();
  if (!promotion) notFound();

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", auth.user.id)
    .eq("organization_id", promotion.organization_id)
    .maybeSingle();
  if (!member) notFound();

  const [{ data: setting }, { data: products, count: productsCount }] = await Promise.all([
    supabase.from("promotion_communication_settings").select("mode,active,group_jid,group_name").eq("promotion_id", id).maybeSingle(),
    supabase.from("promotion_products").select("product_id,products(name)", { count: "exact" }).eq("promotion_id", id),
  ]);

  const org = Array.isArray(promotion.organizations) ? promotion.organizations[0] : promotion.organizations;
  const dataOk = Boolean(
    promotion.name?.trim() &&
    promotion.description?.trim() &&
    promotion.campaign_image_url &&
    Number(promotion.quota_quantity) > 0 &&
    Number(promotion.quota_price) > 0 &&
    (productsCount || 0) > 0
  );
  const communicationOk = Boolean(setting?.active && setting?.group_jid && setting?.mode);
  const pixOk = Boolean(org?.pix_key);
  const ready = dataOk && communicationOk && pixOk;

  const modeLabel: Record<string, string> = {
    automatic: "Automático pelo grupo",
    approval: "Aprovar antes de enviar",
    manual: "Somente copiar e colar",
  };

  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Configurar promoção</h1>
          <p>{promotion.name}</p>
        </div>
        <Link href="/dashboard/promocoes">Sair da configuração</Link>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
        <div style={stepStyle(false, true)}><CheckCircle2 size={18} /> 01. Dados da promoção</div>
        <div style={stepStyle(step === 2, communicationOk)}><MessageCircle size={18} /> 02. Comunicação</div>
        <div style={stepStyle(step === 3, false)}><Rocket size={18} /> 03. Revisão e publicação</div>
      </div>

      {query.error ? <div className={styles.alertError}>{query.error}</div> : null}

      {step === 2 ? (
        <>
          <section className={styles.panel} style={{ marginBottom: 20 }}>
            <h2>Comunicação da promoção</h2>
            <p style={{ marginTop: 6 }}>
              Esta configuração será vinculada exclusivamente à promoção <strong>{promotion.name}</strong>.
            </p>
            <p style={{ marginTop: 6 }}>
              Conecte o WhatsApp, escolha o grupo e depois defina como as mensagens serão enviadas.
            </p>
          </section>

          <WhatsAppConnection
            organizationId={promotion.organization_id}
            promotionId={id}
            currentGroup={setting?.group_jid}
          />

          <section className={styles.panel} style={{ marginTop: 20 }}>
            <form action={savePromotionCommunication}>
              <input type="hidden" name="id" value={id} />
              <label className={styles.field}>
                Modo de operação
                <select name="mode" defaultValue={setting?.mode || "automatic"}>
                  <option value="automatic">Automático pelo grupo</option>
                  <option value="approval">Aprovar antes de enviar</option>
                  <option value="manual">Somente copiar e colar</option>
                </select>
              </label>
              <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: setting?.group_jid ? "#effaf4" : "#fff5f5" }}>
                {setting?.group_jid ? (
                  <strong>Grupo vinculado: {setting.group_name || setting.group_jid}</strong>
                ) : (
                  <strong>Antes de continuar, vincule um grupo acima.</strong>
                )}
              </div>
              <div className={styles.actions} style={{ marginTop: 20 }}>
                <Link href={`/dashboard/promocoes/${id}`}>Voltar</Link>
                <button className={styles.primary} type="submit" disabled={!setting?.group_jid}>
                  Salvar comunicação e revisar
                </button>
              </div>
            </form>
          </section>
        </>
      ) : (
        <>
          <section className={styles.panel}>
            <h2>Checklist antes de publicar</h2>
            <p>A promoção só será publicada quando todos os itens obrigatórios estiverem concluídos.</p>
            <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
              {[
                [dataOk, "Dados da promoção completos", `${promotion.quota_quantity} cotas • ${Number(promotion.quota_price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por cota`],
                [(productsCount || 0) > 0, "Produtos vinculados", (products || []).map((p: any) => Array.isArray(p.products) ? p.products[0]?.name : p.products?.name).filter(Boolean).join(", ") || "Nenhum produto"],
                [pixOk, "PIX da organização configurado", org?.pix_key || "Chave PIX ausente"],
                [Boolean(setting?.group_jid), "Grupo de WhatsApp vinculado", setting?.group_name || "Nenhum grupo"],
                [Boolean(setting?.mode), "Modo de comunicação definido", setting?.mode ? modeLabel[setting.mode] || setting.mode : "Não definido"],
              ].map(([ok, title, detail]) => (
                <div key={String(title)} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 16, border: "1px solid #e1e5ef", borderRadius: 14 }}>
                  {ok ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                  <div><strong>{String(title)}</strong><div style={{ marginTop: 4, opacity: .72 }}>{String(detail)}</div></div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.panel} style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <PackageCheck size={28} />
              <div>
                <h3 style={{ margin: 0 }}>Publicação</h3>
                <p style={{ margin: "4px 0 0" }}>
                  Ao publicar, a promoção fica disponível para compra e o evento de lançamento é criado para o grupo vinculado.
                </p>
              </div>
            </div>
            <div className={styles.actions} style={{ marginTop: 22 }}>
              <Link href={`/dashboard/promocoes/${id}/configuracao?step=2`}>Voltar para comunicação</Link>
              <form action={publishPromotion}>
                <input type="hidden" name="id" value={id} />
                <button className={styles.primary} type="submit" disabled={!ready}>
                  {ready ? "Publicar promoção" : "Conclua o checklist"}
                </button>
              </form>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
