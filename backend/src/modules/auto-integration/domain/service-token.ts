/**
 * Service credentials must be explicitly provisioned in both applications.
 * Missing/unsafe values disable the adapter; they never select a public fallback.
 * Length is a configuration floor, not an entropy estimate: generate random keys.
 */
export function configuredServiceToken(value: string | undefined): string | undefined {
  return value && /^[\x21-\x7e]{32,512}$/u.test(value) ? value : undefined;
}
