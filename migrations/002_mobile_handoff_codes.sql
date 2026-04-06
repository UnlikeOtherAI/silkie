CREATE TABLE mobile_handoff_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash   bytea NOT NULL UNIQUE
                 CHECK (octet_length(code_hash) = 32),
    user_id     uuid NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mobile_handoff_codes_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT mobile_handoff_codes_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_mobile_handoff_codes_user_created_at
    ON mobile_handoff_codes (user_id, created_at DESC);

CREATE INDEX idx_mobile_handoff_codes_expires_at
    ON mobile_handoff_codes (expires_at);
