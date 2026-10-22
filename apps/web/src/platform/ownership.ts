/** Engagement ownership guard for wire responses: a payload that names another engagement fails its guard. */
export function owned<T extends { engagementId: string }>(id: string, guard: (v: unknown) => v is T): (v: unknown) => v is T {
  return (v): v is T => guard(v) && v.engagementId === id
}
