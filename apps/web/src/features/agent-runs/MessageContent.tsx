export default function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ color: isUser ? '#0F172A' : '#0F172A' }}>
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="font-mono text-[11px] px-1 py-0.5 rounded"
              style={
                isUser
                  ? { backgroundColor: '#FECACA', color: '#DC2626' }
                  : { backgroundColor: '#FEF2F2', color: '#DC2626' }
              }
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part === '\n') return <br key={i} />
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
