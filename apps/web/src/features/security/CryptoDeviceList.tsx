import { Button } from "../../design/primitives.tsx";
import type { CryptoDeviceProjection } from "../../lib/crypto/crypto-api.ts";
import { useCryptoSecurity } from "./CryptoSecurityProvider.tsx";
import { cryptoErrorCopy } from "./crypto-copy.ts";

interface AccountDevice {
  readonly id: string;
  readonly displayName: string;
  readonly revokedAt: string | null;
  readonly isCurrent: boolean;
}

export function CryptoDeviceList({
  accountDevices,
  busy,
  onBusyChange,
  onError,
  onNotice,
}: {
  readonly accountDevices: readonly AccountDevice[];
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onError: (message: string) => void;
  readonly onNotice: (message: string) => void;
}) {
  const security = useCryptoSecurity();

  function labelFor(device: CryptoDeviceProjection): string {
    const accountDevice = accountDevices.find((row) => row.id === device.deviceId);
    if (accountDevice?.isCurrent) return "This device";
    return accountDevice?.displayName ?? "Your device";
  }

  async function approve(device: CryptoDeviceProjection) {
    onBusyChange(true);
    onError("");
    try {
      await security.approveDevice(device.cryptoDeviceId);
      onNotice(
        "Device approved for future protected sharing. Approval alone does not promise access to older protected history.",
      );
    } catch (error) {
      onError(cryptoErrorCopy(error));
    } finally {
      onBusyChange(false);
    }
  }

  if (security.devices.length === 0) {
    return <p className="hint">No protected-sharing device information is available yet.</p>;
  }

  return (
    <ul className="security-device-list">
      {security.devices.map((device) => {
        const current =
          accountDevices.find((row) => row.id === device.deviceId)?.isCurrent ?? false;
        const pending = device.trustState === "pending";
        const canApprove =
          pending &&
          !current &&
          security.model.canApproveOtherDevices &&
          security.model.currentDeviceTrust === "trusted";

        return (
          <li key={device.cryptoDeviceId} className="security-device-row">
            <div>
              <strong>{labelFor(device)}</strong>
              <p className="muted">
                {device.trustState === "trusted"
                  ? "Trusted for protected sharing"
                  : device.trustState === "pending"
                    ? "Waiting for protected-sharing approval"
                    : "Protected-sharing access revoked"}
              </p>
            </div>
            {canApprove ? (
              <Button compact disabled={busy} onClick={() => void approve(device)}>
                Approve
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
