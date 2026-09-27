import { Button, ErrorNotice, Notice } from "../../design/primitives.tsx";
import { useCryptoSecurity } from "./CryptoSecurityProvider.tsx";
import { securityTaskCopy } from "./crypto-copy.ts";

export function SecurityTaskCard({ onOpenSecurity }: { readonly onOpenSecurity: () => void }) {
  const { model } = useCryptoSecurity();
  const copy = securityTaskCopy(model.primaryTask);
  if (!copy) return null;

  const action = copy.actionLabel ? (
    <Button compact variant="quiet" onClick={onOpenSecurity}>
      {copy.actionLabel}
    </Button>
  ) : undefined;

  if (copy.tone === "error") {
    return (
      <ErrorNotice action={action}>
        <strong>{copy.title}</strong>
        <div>{copy.body}</div>
      </ErrorNotice>
    );
  }

  return (
    <Notice tone={copy.tone} action={action}>
      <strong>{copy.title}</strong>
      <div>{copy.body}</div>
    </Notice>
  );
}

export function SecurityOperationalNotice({
  onOpenSecurity,
}: {
  readonly onOpenSecurity: () => void;
}) {
  const { model } = useCryptoSecurity();
  const copy = securityTaskCopy(model.primaryTask);
  if (
    !copy ||
    ![
      "runtime_unavailable",
      "device_pending",
      "partnership_waiting_for_recovery",
      "rekeying",
      "repair_required",
    ].includes(model.primaryTask)
  ) {
    return null;
  }

  const action = (
    <Button compact variant="quiet" onClick={onOpenSecurity}>
      {copy.actionLabel ?? "Open protected sharing"}
    </Button>
  );
  return copy.tone === "error" ? (
    <ErrorNotice action={action}>
      <strong>{copy.title}</strong>
      <div>{copy.body}</div>
    </ErrorNotice>
  ) : (
    <Notice tone={copy.tone} action={action}>
      <strong>{copy.title}</strong>
      <div>{copy.body}</div>
    </Notice>
  );
}
