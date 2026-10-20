import crypto from 'node:crypto';

/**
 * Compare a supplied API secret against configured secrets without a
 * direct string equality check. Hashing normalizes input lengths so
 * timingSafeEqual always receives fixed-size buffers. Check every key
 * rather than returning early on the first match.
 *
 * This is one layer of defense, not a replacement for TLS, rate limiting,
 * key rotation, or keeping secrets out of logs.
 */
export function matchesConfiguredSecret(provided, configuredSecrets) {
  if (typeof provided !== 'string' || provided.length === 0 || !Array.isArray(configuredSecrets)) {
    return false;
  }

  const candidateDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  let matched = false;

  for (const secret of configuredSecrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    const expectedDigest = crypto.createHash('sha256').update(secret, 'utf8').digest();
    // Do not short-circuit: evaluate every configured secret.
    const equal = crypto.timingSafeEqual(candidateDigest, expectedDigest);
    matched = equal || matched;
  }

  return matched;
}
