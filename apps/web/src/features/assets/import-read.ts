/** Synchronous import checks (duplicate identifiers and row validation) for the selected project. */
import { useQueryScope } from '../../state/keys'
import { useAssetList } from './query'
import { validateImportRows, type AssetImportRow, type AssetRowIssue } from './writes'

export interface AssetImportRead {
  assets: { projectId: string; ident: string }[]
  validate(projectId: string, rows: readonly AssetImportRow[]): AssetRowIssue[]
}

/**
 * The checks read the asset list the page shows, so they hold in both modes: the identifiers come from the port, never from the
 * mock database. The server still refuses duplicates on commit.
 */
export function useAssetImportRead(): AssetImportRead {
  const scope = useQueryScope()
  const list = useAssetList({ page: 1, pageSize: 500 })
  const assets = (list.data?.items ?? []).map(({ asset, projectId }) => ({ projectId: projectId ?? asset.projectId, ident: asset.ident }))
  return {
    assets,
    validate: (projectId, rows) => projectId === scope.project && !list.isError
      ? validateImportRows(assets.filter((a) => a.projectId === projectId).map((a) => a.ident), rows)
      : rows.map((r, index) => ({ index, name: r.name, duplicate: false, reasons: ['Select an accessible project before validating the import.'] })),
  }
}
