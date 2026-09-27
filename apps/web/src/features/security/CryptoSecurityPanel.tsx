import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  ErrorNotice,
  Notice,
} from "../../design/primitives.tsx";
import { CryptoDeviceList } from "./CryptoDeviceList.tsx";
import { CryptoRecoveryFlow } from "./CryptoRecoveryFlow.tsx";
import { useCryptoSecurity } from "./CryptoSecurityProvider.tsx";
import { cryptoErrorCopy, recoveryStatusCopy } from "./crypto-copy.ts";
import "./security.css";

interface AccountDevice {
  readonly id: string;
  readonly displayName: string;
  readonly revokedAt: string | null;
  readonly isCurrent: boolean;
}

function trustLabel(value: string): string {
  if (value === "trusted") return "Trusted";
  if (value === "pending") return "Waiting for approval";
  if (value === "revoked") return "Revoked";
  return "Unavailable";
}

function partnershipLabel(value: string): string {
  const labels: Record<string, string> = {
    none: "No current partnership",
    preparing: "Preparing",
    waiting_for_recovery: "Waiting for recovery setup",
    ready: "Ready",
    rekeying: "Updating device access",
    repair_required: "Repair required",
    unavailable: "Unavailable",
  };
  return labels[value] ?? "Unavailable";
}

export function CryptoSecurityPanel({
  accountDevices,
  reauthenticatedAt,
}: {
  readonly accountDevices: readonly AccountDevice[];
  readonly reauthenticatedAt: string | null;
}) {
  const security = useCryptoSecurity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRepair, setConfirmRepair] = useState(false);

  async function repair() {
    setConfirmRepair(false);
    setBusy(true);
    setError("");
    try {
      await security.repairPartnership();
      setNotice(
        "Protected sharing was repaired for future content. Older unavailable content may still remain unavailable.",
      );
    } catch (caught) {
      setError(cryptoErrorCopy(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="us-block security-panel" aria-labelledby="protected-sharing-title">
      <div className="security-panel__heading">
        <div>
          <h2 id="protected-sharing-title">Protected sharing</h2>
          <p className="hint">
            Messages, relationship content, and shared media use end-to-end encryption after S1
            activation. Calls continue to use their separate private relay calling design.
          </p>
        </div>
        <Button compact variant="quiet" disabled={busy || security.refreshing} onClick={() => void security.refresh()}>
          {security.refreshing ? "Checking..." : "Refresh"}
        </Button>
      </div>

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <dl className="security-summary">
        <div>
          <dt>This device</dt>
          <dd>{trustLabel(security.model.currentDeviceTrust)}</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>{recoveryStatusCopy(security.model.recovery)}</dd>
        </div>
        <div>
          <dt>Relationship protection</dt>
          <dd>{partnershipLabel(security.model.partnership)}</dd>
        </div>
      </dl>

      {security.model.currentDeviceTrust === "pending" ? (
        <Notice tone="warning">
          This device cannot use protected sharing yet. Restore it with your recovery key, or approve
          it from another trusted device.
        </Notice>
      ) : null}

      {security.model.partnership === "rekeying" ? (
        <Notice>
          Protected sharing is updating after a device-access change. Existing verified content
          remains readable where available, but protected writes are temporarily paused.
        </Notice>
      ) : null}

      <div className="security-panel__section">
        <h3>Recovery</h3>
        <CryptoRecoveryFlow
          reauthenticatedAt={reauthenticatedAt}
          busy={busy}
          onBusyChange={setBusy}
          onError={setError}
          onNotice={setNotice}
        />
      </div>

      <div className="security-panel__section">
        <h3>Protected-sharing devices</h3>
        <CryptoDeviceList
          accountDevices={accountDevices}
          busy={busy}
          onBusyChange={setBusy}
          onError={setError}
          onNotice={setNotice}
        />
        <p className="hint">
          To revoke a device, use the Devices section below. Revocation remains the account-device
          authority and removes future access according to the existing account and crypto rules.
        </p>
      </div>

      {security.model.canOfferGroupRepair ? (
        <div className="security-panel__section security-panel__repair">
          <h3>Repair protected sharing</h3>
          <p>
            Normal reconciliation could not restore this device's current protected-sharing group.
            Repair creates a new generation for future protected content. It does not guarantee
            recovery of older unavailable content.
          </p>
          <Button variant="dangerQuiet" disabled={busy} onClick={() => setConfirmRepair(true)}>
            Review repair
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRepair}
        onCancel={() => setConfirmRepair(false)}
        onConfirm={() => void repair()}
        title="Repair protected sharing?"
        confirmLabel="Create new protected-sharing generation"
        destructive
      >
        This creates a new protected-sharing generation for future content. Older content that is
        already unavailable may remain unavailable. The repair will run only if the recovery-backed
        safety checks still pass.
      </ConfirmDialog>
    </section>
  );
}
