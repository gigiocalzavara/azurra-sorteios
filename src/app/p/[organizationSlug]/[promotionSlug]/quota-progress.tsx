"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./public-promotion.module.css";

type Props = {
  total: number;
  available: number;
};

export function QuotaProgress({ total, available }: Props) {
  const router = useRouter();
  const allocated = Math.max(0, total - available);
  const percentage =
    total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0;

  useEffect(() => {
    const refresh = window.setInterval(() => {
      router.refresh();
    }, 15000);

    return () => window.clearInterval(refresh);
  }, [router]);

  return (
    <div className={styles.progressBlock}>
      <div className={styles.progressMeta}>
        <span>
          {allocated} de {total} cotas reservadas
        </span>
        <span>{available} disponíveis</span>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={allocated}
        aria-label="Progresso das cotas da promoção"
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <small className={styles.progressPercent}>{percentage}% preenchido</small>
    </div>
  );
}
