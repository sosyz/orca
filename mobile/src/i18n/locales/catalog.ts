export type MobileLocaleDomainCatalog = Record<string, unknown>

function plainRecord(value: unknown): value is MobileLocaleDomainCatalog {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeDomain(
  target: MobileLocaleDomainCatalog,
  source: MobileLocaleDomainCatalog
): MobileLocaleDomainCatalog {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    target[key] =
      plainRecord(current) && plainRecord(value) ? mergeDomain({ ...current }, value) : value
  }
  return target
}

export function mergeMobileLocaleDomains(
  ...domains: readonly MobileLocaleDomainCatalog[]
): MobileLocaleDomainCatalog {
  return domains.reduce<MobileLocaleDomainCatalog>(
    (catalog, domain) => mergeDomain(catalog, domain),
    {}
  )
}
