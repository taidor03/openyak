"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { useXflowConfig } from "@/hooks/use-xflow-config";

function XflowTabInner() {
  const { t } = useTranslation("settings");
  const { url, token, setUrl, setToken, save, clear, testConnection } =
    useXflowConfig();

  const [testStatus, setTestStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  const handleTest = async () => {
    setTestStatus("loading");
    setTestMessage("");
    const result = await testConnection();
    setTestStatus(result.ok ? "success" : "error");
    setTestMessage(result.message);
  };

  const handleSave = () => {
    save();
    setTestStatus("idle");
    setTestMessage("");
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">
          {t("xflowDesc")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="xflow-url">{t("xflowApiUrl")}</Label>
          <Input
            id="xflow-url"
            type="url"
            placeholder={t("xflowApiUrlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="xflow-token">{t("xflowApiToken")}</Label>
          <Input
            id="xflow-token"
            type="password"
            placeholder={t("xflowApiTokenPlaceholder")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        {testStatus !== "idle" && testMessage && (
          <div
            className={`flex items-center gap-2 text-sm ${
              testStatus === "success"
                ? "text-green-600 dark:text-green-400"
                : testStatus === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-[var(--text-secondary)]"
            }`}
          >
            {testStatus === "success" && (
              <CheckCircle className="h-4 w-4 shrink-0" />
            )}
            {testStatus === "error" && (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            {testStatus === "loading" && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            )}
            <span>{testMessage}</span>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testStatus === "loading"}
          >
            {testStatus === "loading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("xflowTestingConnection")}
              </>
            ) : (
              t("xflowTestConnection")
            )}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("xflowSave")}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            {t("xflowClear")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function XflowTab() {
  return (
    <ClientOnly>
      <XflowTabInner />
    </ClientOnly>
  );
}
