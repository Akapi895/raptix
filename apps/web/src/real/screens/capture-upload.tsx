/** Bounded capture upload; integrity is computed by the retained artifact authority. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import { uploadCapture } from '../api'
import { Button } from '../../ui'

export function CaptureUpload({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = useMutation({
    mutationFn: async () => {
      const selected = file.current?.files?.[0]
      if (!selected || selected.size === 0 || selected.size > 262144) throw new Error('Select a capture of 1-262144 bytes.')
      const bytes = new Uint8Array(await selected.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return uploadCapture(engagementId, { base64: btoa(binary), mediaType: selected.type })
    },
    onSuccess: () => { setError(null); if (file.current) file.current.value = ''; void client.invalidateQueries({ queryKey: ['real', 'artifacts', engagementId] }) },
    onError: (err) => setError(err.message),
  })
  return <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); upload.mutate() }}>
    <label className="block text-sm">Retain capture (maximum 256 KiB)<input type="file" ref={file} required className="block w-full" /></label>
    <Button type="submit" disabled={upload.isPending}>Upload capture</Button>
    {upload.data && <p role="status" className="break-all text-xs">Retained {upload.data.path} · SHA-256 {upload.data.digest}. Capture integrity is not independent verification of a claim.</p>}
    {error && <p role="alert" className="text-bad">{error}</p>}
  </form>
}
