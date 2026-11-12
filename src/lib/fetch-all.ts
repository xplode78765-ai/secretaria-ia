// Supabase returns at most 1000 rows per request. Lists that must be complete
// (clients, payments) are fetched page by page with this helper.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, max = 20000 }: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}
