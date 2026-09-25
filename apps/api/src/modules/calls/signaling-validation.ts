export function validateCallDescription(sdp: string): boolean {
  const lines = sdp.split(/\r?\n/).map((line) => line.trim());
  if (lines.some((line) => /^a=(candidate:|end-of-candidates)/i.test(line))) return false;
  const media = lines.filter((line) => line.startsWith("m="));
  return media.length === 1 && /^m=audio\s/i.test(media[0] ?? "");
}

export function validateVideoCallDescription(sdp: string): boolean {
  const lines = sdp.split(/\r?\n/).map((line) => line.trim());
  if (lines.length > 1024) return false;
  if (lines.some((line) => /^a=(candidate:|end-of-candidates)/i.test(line))) return false;
  const media = lines.filter((line) => line.startsWith("m="));
  return (
    media.length === 2 && /^m=audio\s/i.test(media[0] ?? "") && /^m=video\s/i.test(media[1] ?? "")
  );
}

export function validateCallRelayCandidate(candidate: string): boolean {
  const tokens = candidate.trim().split(/\s+/);
  if (tokens.length < 8) return false;

  const foundation = tokens[0] ?? "";
  const component = tokens[1] ?? "";
  const transport = (tokens[2] ?? "").toLowerCase();
  const priority = tokens[3] ?? "";
  const address = tokens[4] ?? "";
  const port = tokens[5] ?? "";
  const typ = (tokens[6] ?? "").toLowerCase();
  const candidateType = (tokens[7] ?? "").toLowerCase();

  if (!/^candidate:[A-Za-z0-9+/_-]{1,64}$/.test(foundation)) return false;
  if (!/^[12]$/.test(component)) return false;
  if (transport !== "udp" && transport !== "tcp") return false;
  if (!/^\d+$/.test(priority) || BigInt(priority) > 4_294_967_295n) return false;
  if (!address) return false;
  if (!/^\d+$/.test(port)) return false;
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return false;
  if (typ !== "typ" || candidateType !== "relay") return false;

  const extensions = tokens.slice(8);
  if (extensions.length % 2 !== 0) return false;

  let sawRelatedAddress = false;
  let sawRelatedPort = false;
  let sawTcpType = false;
  for (let index = 0; index < extensions.length; index += 2) {
    const name = (extensions[index] ?? "").toLowerCase();
    const value = extensions[index + 1] ?? "";
    if (!name || !value || name === "typ") return false;

    if (name === "raddr") {
      if (sawRelatedAddress) return false;
      sawRelatedAddress = true;
      const related = value.toLowerCase();
      if (!["0.0.0.0", "::", "0", "0:0:0:0:0:0:0:0"].includes(related)) return false;
    } else if (name === "rport") {
      if (sawRelatedPort || value !== "0") return false;
      sawRelatedPort = true;
    } else if (name === "tcptype") {
      if (sawTcpType || transport !== "tcp") return false;
      sawTcpType = true;
      if (!["active", "passive", "so"].includes(value.toLowerCase())) return false;
    }
  }
  if (transport === "tcp" && !sawTcpType) return false;
  return true;
}
