export interface ApprovalRef { id: string; projectId: string; type: string }
export interface ScopeAssetInput { name: string; ident: string; type: string; os: string; owner: string; scope: 'in' | 'out'; source: string; ip?: string }
