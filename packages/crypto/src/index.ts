export const cryptoImplementationStatus = "reviewed-protocol-not-selected" as const;

export interface CryptoBoundary {
  readonly implementationStatus: typeof cryptoImplementationStatus;
}
