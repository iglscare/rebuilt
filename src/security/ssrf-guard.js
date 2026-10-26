const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata.azure.com',
  '169.254.169.254'
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.corp',
  '.home',
  '.arpa'
];

/**
 * Checks if a given IP address string falls into a private, loopback, or restricted range.
 * @param {string} ipStr
 * @returns {boolean} true if safe, false if blocked
 */
function isSafeIp(ipStr) {
  try {
    const addr = ipaddr.parse(ipStr);
    const range = addr.range();

    // Blocked IP ranges
    const restrictedRanges = [
      'loopback',
      'private',
      'linkLocal',
      'broadcast',
      'carrierGradeNat',
      'unspecified',
      'reserved',
      'uniqueLocal'
    ];

    if (restrictedRanges.includes(range)) {
      return false;
    }

    // Explicit check for AWS/GCP link-local metadata (169.254.169.254)
    if (addr.kind() === 'ipv4') {
      const octets = addr.toByteArray();
      if (octets[0] === 169 && octets[1] === 254) {
        return false;
      }
      if (octets[0] === 127) {
        return false;
      }
      if (octets[0] === 10) {
        return false;
      }
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return false;
      }
      if (octets[0] === 192 && octets[1] === 168) {
        return false;
      }
      if (octets[0] === 0) {
        return false;
      }
    }

    return true;
  } catch (err) {
    // If not parseable as IP, treat with caution
    return false;
  }
}

/**
 * Validates a target URL against SSRF and malformed input.
 * @param {string} rawUrl
 * @returns {Promise<{isValid: boolean, error?: string, sanitizedUrl?: string, parsedUrl?: URL}>}
 */
async function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, error: 'URL is required and must be a string.' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { isValid: false, error: 'URL cannot be empty.' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { isValid: false, error: 'Malformed URL format. Please provide a valid URL like https://example.com' };
  }

  // Enforce http/https only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Unsupported protocol "${parsed.protocol}". Only "http:" and "https:" are allowed.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Enforce valid hostname
  if (!hostname) {
    return { isValid: false, error: 'Missing or empty hostname in URL.' };
  }

  // Cloud metadata endpoints are strictly blocked under all circumstances
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata.azure.com') {
    return { isValid: false, error: `Access to restricted host "${hostname}" is blocked (SSRF Protection).` };
  }

  // Explicit opt-in for local automated testing environments (allowing localhost mock servers)
  if (process.env.ALLOW_LOCAL_TESTING === 'true') {
    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
      parsedUrl: parsed
    };
  }

  // Check explicit blocklist
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { isValid: false, error: `Access to restricted host "${hostname}" is blocked (SSRF Protection).` };
  }

  // Check suffix blocklist
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { isValid: false, error: `Access to internal domain suffix "${suffix}" is blocked.` };
    }
  }

  // Direct IP in hostname check
  if (ipaddr.isValid(hostname)) {
    if (!isSafeIp(hostname)) {
      return { isValid: false, error: `Direct IP "${hostname}" is within a restricted or private subnet.` };
    }
    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
      parsedUrl: parsed
    };
  }

  // Require domain name with at least one dot unless public TLD
  if (!hostname.includes('.')) {
    return { isValid: false, error: `Hostname "${hostname}" is invalid or an internal intranet alias.` };
  }

  // DNS Resolution check (prevent DNS rebinding to private IPs)
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { isValid: false, error: `DNS lookup failed for "${hostname}". Domain could not be resolved.` };
    }

    for (const record of addresses) {
      if (!isSafeIp(record.address)) {
        return {
          isValid: false,
          error: `Domain "${hostname}" resolved to restricted IP ${record.address} (SSRF Protection).`
        };
      }
    }
  } catch (dnsErr) {
    return { isValid: false, error: `DNS resolution failed for "${hostname}": ${dnsErr.code || dnsErr.message}` };
  }

  return {
    isValid: true,
    sanitizedUrl: parsed.toString(),
    parsedUrl: parsed
  };
}

/**
 * Validates a redirect URL against SSRF risks.
 * @param {string} redirectUrl
 * @returns {Promise<boolean>}
 */
async function isSafeRedirect(redirectUrl) {
  const result = await validateUrl(redirectUrl);
  return result.isValid;
}

module.exports = {
  validateUrl,
  isSafeIp,
  isSafeRedirect
};
