"use client";

import { useState } from "react";
import Link from "next/link";
import { formatModelRouteId } from "@agentic/contracts";
import { useLlmSettings, useGatewayModels } from "@/lib/hooks/useLlmSettings";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import styles from "./skills.module.css";

export function SkillModelPicker({
  value,
  onChange,
  disabled = false,
  purpose = "evaluation",
}: {
  value: string;
  onChange: (route: string) => void;
  disabled?: boolean;
  purpose?: "creation" | "evaluation";
}) {
  const { t } = useI18n();
  const tenant = useTenant();
  const settings = useLlmSettings();
  const [gateway, setGateway] = useState(
    value.includes("/") ? value.split("/")[0]! : "",
  );
  const models = useGatewayModels(gateway, Boolean(gateway));
  const gateways =
    settings.data?.settings.gatewayInstances.filter(
      (entry) =>
        entry.enabled && entry.kind !== "mock" && entry.providerId !== "mock",
    ) ?? [];
  const model = value.startsWith(`${gateway}/`)
    ? value.slice(gateway.length + 1)
    : "";
  return (
    <div>
      <label className={styles.label}>
        {t("skills.model")}
        <select
          className={styles.control}
          value={gateway}
          disabled={disabled}
          onChange={(event) => {
            setGateway(event.target.value);
            onChange("");
          }}
        >
          <option value="">
            {t(
              purpose === "creation"
                ? "skills.creatorProModel"
                : "skills.tenantModel",
            )}
          </option>
          {gateways.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </label>
      {gateway && (
        <label className={styles.label}>
          {t("skills.selectModel")}
          {/* Keep the required control enabled while discovery loads so the
              form cannot silently submit with the tenant's default route. */}
          <select
            className={styles.control}
            value={model}
            disabled={disabled}
            aria-busy={models.isLoading}
            onChange={(event) =>
              onChange(
                event.target.value
                  ? formatModelRouteId(gateway, event.target.value)
                  : "",
              )
            }
            required
          >
            <option value="">
              {models.isLoading ? t("common.loading") : t("skills.selectModel")}
            </option>
            {models.data?.models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {(settings.error ||
        models.error ||
        (gateway && models.data && !models.data.models.length)) && (
        <p className={styles.hint}>
          {t("skills.modelUnavailable")}{" "}
          <Link href={`/portal/${tenant}/settings` as never}>
            {t("skills.settings")}
          </Link>
        </p>
      )}
    </div>
  );
}
