CREATE TABLE push_subscriptions (
  device_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_device_account_fk
    FOREIGN KEY (device_id, account_id)
    REFERENCES account_devices(id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT push_subscriptions_endpoint_nonempty CHECK (length(endpoint) > 0),
  CONSTRAINT push_subscriptions_p256dh_nonempty CHECK (length(p256dh) > 0),
  CONSTRAINT push_subscriptions_auth_nonempty CHECK (length(auth) > 0),
  CONSTRAINT push_subscriptions_failure_count_nonnegative CHECK (failure_count >= 0)
);

CREATE UNIQUE INDEX push_subscriptions_endpoint_unique
  ON push_subscriptions (endpoint);

CREATE INDEX push_subscriptions_account_active
  ON push_subscriptions (account_id, device_id)
  WHERE revoked_at IS NULL;
