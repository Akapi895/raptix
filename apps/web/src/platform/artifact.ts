/** Saves one server-produced report artifact exactly as the server encoded it: text as UTF-8, PDF and DOCX as base64 bytes (P07). */
export interface ReportArtifactFile {
  filename: string
  mediaType: string
  content: string
  encoding: 'utf8' | 'base64'
}

export function artifactBlob(artifact: Pick<ReportArtifactFile, 'content' | 'encoding' | 'mediaType'>): Blob {
  if (artifact.encoding === 'utf8') return new Blob([artifact.content], { type: artifact.mediaType })
  const bytes = Uint8Array.from(atob(artifact.content), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: artifact.mediaType })
}

export function saveArtifact(artifact: ReportArtifactFile): void {
  const url = URL.createObjectURL(artifactBlob(artifact))
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.filename
  link.click()
  URL.revokeObjectURL(url)
}
