/**
 * VariableResolverPlugin -- resolves ${secret:KEY} references in channel XML.
 *
 * Called before VariableResolver.resolve() to handle vault-backed secrets.
 * This keeps VariableResolver itself synchronous and untouched.
 */
import { SecretsManager } from '../SecretsManager.js';

const SECRET_REF_PATTERN = /\$\{secret:([^}]+)\}/g;

export interface SecretResolutionResult {
  resolved: string;
  resolvedKeys: string[];
  unresolvedKeys: string[];
}

/**
 * Resolve all ${secret:KEY} references in input text.
 * Uses SecretsManager.resolve() (async) for each unique key.
 */
export async function resolveSecretReferences(input: string): Promise<SecretResolutionResult> {
  const mgr = SecretsManager.getInstance();
  const resolvedKeys: string[] = [];
  const unresolvedKeys: string[] = [];

  if (!mgr) {
    // No secrets manager -- return input unchanged, mark all as unresolved
    const matches = input.matchAll(SECRET_REF_PATTERN);
    for (const match of matches) {
      unresolvedKeys.push(match[1]!);
    }
    return { resolved: input, resolvedKeys, unresolvedKeys };
  }

  // Collect unique keys
  const keys = new Set<string>();
  for (const match of input.matchAll(SECRET_REF_PATTERN)) {
    keys.add(match[1]!);
  }

  // Resolve all in parallel
  const resolutions = new Map<string, string>();
  await Promise.all(
    Array.from(keys).map(async (key) => {
      const secret = await mgr.resolve(key);
      if (secret) {
        resolutions.set(key, secret.value);
        resolvedKeys.push(key);
      } else {
        unresolvedKeys.push(key);
      }
    })
  );

  // Replace in text
  const resolved = input.replace(SECRET_REF_PATTERN, (_match, key: string) => {
    return resolutions.get(key) ?? `\${secret:${key}}`;
  });

  return { resolved, resolvedKeys, unresolvedKeys };
}
