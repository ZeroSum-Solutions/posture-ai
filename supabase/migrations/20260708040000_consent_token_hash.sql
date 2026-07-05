-- Consent tokens at rest: store only SHA-256(token). Raw token lives in the
-- delivered URL/QR only, never in the DB. Mirrors session_token_hash.

-- 1. New hash column.
ALTER TABLE consent_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- 2. Legacy rows were stored plaintext -> treat as compromised. Invalidate every
--    unconsumed token (dead-links them; practitioners re-mint). Consumed rows are
--    already single-use-exhausted. Give ALL rows a sentinel hash so NOT NULL holds
--    without exposing anything (we never look these up again).
UPDATE consent_tokens SET consumed_at = now() WHERE consumed_at IS NULL;
UPDATE consent_tokens SET token_hash = 'legacy_' || id::text WHERE token_hash IS NULL;

-- 3. Enforce the new shape, drop the plaintext column (and its UNIQUE/index).
ALTER TABLE consent_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE consent_tokens ADD CONSTRAINT consent_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE consent_tokens DROP COLUMN token;

-- 4. RPC now takes the hash. A param RENAME requires DROP + CREATE (CREATE OR
--    REPLACE cannot rename input params).
DROP FUNCTION IF EXISTS record_remote_consent(text, text, text, text, timestamptz);

CREATE FUNCTION record_remote_consent(
  p_token_hash text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_prac uuid;
  v_version text;
BEGIN
  -- Resolve the token's client and LOCK that client row, so a concurrent
  -- right-to-erasure can't tombstone it between this check and the insert. Refuse
  -- (WITHOUT consuming the token) if the token is unknown or the client is already
  -- erased -- this closes the erasure/remote-consent TOCTOU.
  SELECT ct.client_id, ct.practitioner_id, ct.consent_version
    INTO v_client, v_prac, v_version
    FROM consent_tokens ct WHERE ct.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM clients WHERE id = v_client AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- Atomically claim the single-use, unexpired token.
  UPDATE consent_tokens
     SET consumed_at = p_signed_at
   WHERE token_hash = p_token_hash
     AND consumed_at IS NULL
     AND expires_at > p_signed_at;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM consent_tokens WHERE token_hash = p_token_hash AND consumed_at IS NOT NULL) THEN
      RETURN 'consumed';
    ELSE
      RETURN 'expired';
    END IF;
  END IF;

  INSERT INTO consent_records (
    client_id, practitioner_id, kind, consent_version, consent_hash,
    signer_name, signer_relationship, method, signed_at
  ) VALUES (
    v_client, v_prac, 'enrollment', v_version, p_consent_hash,
    btrim(p_signer_name), p_signer_relationship::signer_relationship_enum, 'remote_link', p_signed_at
  );

  UPDATE clients SET consent_recorded_at = p_signed_at WHERE id = v_client;

  RETURN 'ok';
END;
$$;

-- Lock execution to service_role only. NOTE: role_grants.sql sets ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new functions to anon+authenticated, so a bare
-- `REVOKE ... FROM PUBLIC` would leave these SECURITY DEFINER functions callable
-- by a browser client (which could forge consent, bypassing practitionerGate).
-- Revoke from those roles explicitly.
REVOKE ALL ON FUNCTION record_remote_consent(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_remote_consent(text, text, text, text, timestamptz) TO service_role;
