import { useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, Dialog, Notice } from "../../design/primitives.tsx";
import { useCryptoSecurity } from "./CryptoSecurityProvider.tsx";
import { cryptoErrorCopy, recoveryStatusCopy } from "./crypto-copy.ts";

export function CryptoRecoveryFlow({
  reauthenticatedAt,
  busy,
  onBusyChange,
  onError,
  onNotice,
}: {
  readonly reauthenticatedAt: string | null;
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onError: (message: string) => void;
  readonly onNotice: (message: string) => void;
}) {
  const security = useCryptoSecurity();
  const [enteredSecret, setEnteredSecret] = useState("");
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState("");
  const secretRef = useRef("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(
    () => () => {
      secretRef.current = "";
    },
    [],
  );

  async function setupRecovery() {
    if (!reauthenticatedAt) {
      document.getElementById("security-confirmation")?.scrollIntoView({ block: "center" });
      onError("Confirm your password first. Recovery setup requires a recent security confirmation.");
      return;
    }

    onBusyChange(true);
    onError("");
    try {
      const created = await security.setupRecovery();
      secretRef.current = created.recoveryMasterSecret;
      setRevealedSecret(created.recoveryMasterSecret);
      setSaved(false);
      setCopied(false);
    } catch (error) {
      if (error instanceof Error && error.message === "REAUTH_REQUIRED") {
        document.getElementById("security-confirmation")?.scrollIntoView({ block: "center" });
      }
      onError(cryptoErrorCopy(error));
    } finally {
      onBusyChange(false);
    }
  }

  async function recover() {
    const secret = enteredSecret.trim();
    if (!secret) return;
    setEnteredSecret("");
    onBusyChange(true);
    onError("");
    try {
      await security.recoverWithMasterSecret(secret);
      onNotice(
        "This device is trusted and recovery capability was restored. Recoverable older protected history can open as its keys are needed.",
      );
    } catch (error) {
      onError(cryptoErrorCopy(error));
    } finally {
      onBusyChange(false);
    }
  }

  function finishReveal() {
    if (!saved) return;
    secretRef.current = "";
    setRevealedSecret("");
    setCopied(false);
    setSaved(false);
    onNotice("Recovery setup complete.");
  }

  const recovery = security.model.recovery;
  const pending = security.model.currentDeviceTrust === "pending";

  return (
    <div className="security-recovery">
      <p className="hint">{recoveryStatusCopy(recovery)}</p>

      {recovery === "not_configured" && !pending ? (
        <div className="stack">
          <p>
            Create one recovery key and store it somewhere you control. Shawtie stores an encrypted
            recovery bundle, not the readable recovery key.
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (!reauthenticatedAt) {
                document
                  .getElementById("security-confirmation")
                  ?.scrollIntoView({ block: "center" });
                onError(
                  "Confirm your password first. Recovery setup requires a recent security confirmation.",
                );
                return;
              }
              setConfirmSetup(true);
            }}
          >
            Create recovery key
          </Button>
          {!reauthenticatedAt ? (
            <p className="hint">Confirm your password above before creating the key.</p>
          ) : null}
        </div>
      ) : null}

      {pending && security.model.canUseRecoveryKeyHere ? (
        <div className="stack">
          <label className="field">
            <span>Recovery key</span>
            <input
              name="cryptoRecoveryKey"
              value={enteredSecret}
              onChange={(event) => setEnteredSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || enteredSecret.trim().length === 0}
            onClick={() => void recover()}
          >
            Restore with recovery key
          </Button>
          <p className="hint">
            Another trusted device can approve this device for future protected sharing, but that
            approval alone does not promise access to older protected history.
          </p>
        </div>
      ) : null}

      {pending && recovery !== "pending_can_recover" ? (
        <Notice tone="warning">
          This device is waiting for approval. Recovery with a key is unavailable because no
          matching account recovery bundle could be verified.
        </Notice>
      ) : null}

      <ConfirmDialog
        open={confirmSetup}
        onCancel={() => setConfirmSetup(false)}
        onConfirm={() => {
          setConfirmSetup(false);
          void setupRecovery();
        }}
        title="Ready to save a recovery key?"
        confirmLabel="Generate recovery key"
      >
        The readable recovery key is shown once after generation. Have a safe place ready before
        continuing. Shawtie will not persist the readable key for you.
      </ConfirmDialog>

      <Dialog
        open={revealedSecret.length > 0}
        onClose={finishReveal}
        title="Save your recovery key"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (!revealedSecret) return;
                void navigator.clipboard
                  .writeText(revealedSecret)
                  .then(() => setCopied(true))
                  .catch(() =>
                    onError("The recovery key could not be copied. Select and copy it manually."),
                  );
              }}
            >
              {copied ? "Copied" : "Copy recovery key"}
            </Button>
            <Button variant="primary" disabled={!saved} onClick={finishReveal}>
              Done
            </Button>
          </>
        }
      >
        <div className="security-secret">
          <p>
            This key can restore recoverable protected history on a new device. Shawtie cannot
            show this readable key again from its server copy.
          </p>
          <code className="security-secret__value">{revealedSecret}</code>
          <label className="security-confirm">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            <span>I saved this recovery key somewhere I control.</span>
          </label>
          <p className="hint">
            Copying is explicit. Shawtie does not automatically save this key to browser storage,
            a file, or the clipboard.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
