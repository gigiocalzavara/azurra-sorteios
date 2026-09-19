import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { createClient } from "@/lib/supabase/server";
import { PurchaseForm } from "./purchase-form";
import { QuotaProgress } from "./quota-progress";
import styles from "./public-promotion.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{
    organizationSlug: string;
    promotionSlug: string;
  }>;
};

type Product = {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
};

type Promotion = {
  name: string;
  description: string;
  special_condition: string | null;
  campaign_image_url: string | null;
  quota_quantity: number;
  quota_price: number;
  minimum_per_order: number;
  maximum_per_order: number | null;
  maximum_per_participant: number | null;
  reservation_minutes: number;
  status: string;
  products: Product[];
  organization: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
  };
  quotas: {
    available: number;
    reserved: number;
    paid: number;
  };
};

export default async function Page({ params }: Props) {
  const { organizationSlug, promotionSlug } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_public_promotion", {
    organization_slug: organizationSlug,
    promotion_slug: promotionSlug,
  });

  if (error || !data) {
    notFound();
  }

  const promotion = data as Promotion;

  const brand = {
    "--brand": promotion.organization.primary_color || "#6900ff",
    "--accent": promotion.organization.secondary_color || "#00f0ff",
  } as CSSProperties;

  const maximum = Math.min(
    promotion.maximum_per_order ??
      promotion.maximum_per_participant ??
      promotion.quotas.available,
    promotion.maximum_per_participant ?? promotion.quotas.available,
    promotion.quotas.available,
  );

  const purchaseDisabled =
    promotion.status !== "published" ||
    promotion.quotas.available < promotion.minimum_per_order;

  return (
    <main className={styles.page} style={brand}>
      <div className={styles.shell}>
        <header className={styles.header}>
          {promotion.organization.logo_url ? (
            <img
              src={promotion.organization.logo_url}
              alt={promotion.organization.name}
            />
          ) : null}
          <span>{promotion.organization.name}</span>
        </header>

        <section className={styles.grid}>
          <div className={styles.product}>
            {promotion.campaign_image_url ? (
              <img src={promotion.campaign_image_url} alt={promotion.name} />
            ) : (
              <div>Imagem da campanha</div>
            )}
          </div>

          <div className={styles.content}>
            <span className={styles.eyebrow}>Promoção ativa</span>
            <h1>{promotion.name}</h1>
            <p className={styles.description}>{promotion.description}</p>

            {promotion.products?.length ? (
              <div className={styles.condition}>
                <strong>Produtos disponíveis ao vencedor</strong>
                {promotion.products.map((product, index) => (
                  <div key={product.id}>
                    {index + 1}. {product.name}
                  </div>
                ))}
              </div>
            ) : null}

            {promotion.maximum_per_participant ? (
              <div className={styles.condition}>
                Limite: {promotion.maximum_per_participant} cotas por participante.
              </div>
            ) : null}

            <QuotaProgress
              total={promotion.quota_quantity}
              available={promotion.quotas.available}
            />

            <PurchaseForm
              organizationSlug={organizationSlug}
              promotionSlug={promotionSlug}
              quotaPrice={Number(promotion.quota_price)}
              minimum={promotion.minimum_per_order}
              maximum={maximum}
              reservationMinutes={promotion.reservation_minutes}
              disabled={purchaseDisabled}
            />
          </div>
        </section>

        <footer className={styles.footer}>
          Pagamento por PIX • Cotas atribuídas aleatoriamente
        </footer>
      </div>
    </main>
  );
}
