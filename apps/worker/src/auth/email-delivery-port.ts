export interface SecurityEmailMessage {
  readonly deliveryId: string;
  readonly destination: string;
  readonly template: string;
  readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EmailDeliveryPort {
  sendSecurityEmail(message: SecurityEmailMessage, signal: AbortSignal): Promise<void>;
}
