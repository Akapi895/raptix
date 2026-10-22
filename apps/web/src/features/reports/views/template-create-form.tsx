import { useState } from 'react'
import { useReportWrites } from '../query'
import { useToastStore } from '../../../state/stores'
import { Button, Card, Field, Input, Textarea } from '../../../ui/index'

/**
 * A new immutable template version, written through the reports port. Sections are one per line. A trailing * marks a required
 * section; `requireAll` makes every section required (the stored gallery).
 */
export function TemplateCreateForm({ onDone, onCancel, requireAll = false }: { onDone: () => void; onCancel: () => void; requireAll?: boolean }) {
  const writes = useReportWrites()
  const toast = useToastStore((x) => x.toast)
  const [name, setName] = useState('')
  const [sections, setSections] = useState('')
  const parsed = sections.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    .map((line) => (line.endsWith('*') || requireAll ? { title: line.replace(/\*$/, '').trim(), required: true } : { title: line, required: false }))
  return <Card className="mb-4"><div className="space-y-3">
    <Field label="Template name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label="Sections" hint={requireAll ? 'One required section per line, in the order the report shows them.' : 'One section per line. End a line with * when the section is required.'}><Textarea value={sections} onChange={(e) => setSections(e.target.value)} /></Field>
    <div className="flex gap-2">
      <Button variant="primary" disabled={name.trim().length === 0 || parsed.length === 0} onClick={() => void writes.createTemplate({ name: name.trim(), sections: parsed }).then((res) => {
        if (!res.ok) return toast(res.failure.message, 'bad')
        toast(`Template ${res.data.name} ${res.data.version} created`)
        onDone()
      })}>Create template</Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  </div></Card>
}
