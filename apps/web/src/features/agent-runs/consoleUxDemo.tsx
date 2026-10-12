// THROWAWAY UX DEMO — mock-data Operator Console experience for design
// sign-off (thinking-trace toggle + opencode-style question panel). Dev-only,
// activated by ?uxDemo=1 on the console route from RealApp.tsx. No API calls:
// resume and send are simulated locally so the reviewer can feel the exact
// production components (Card, ThinkingBlock, ComposerQuestionPanel).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PendingInterruptView, ScopedRunView, ThreadBindingView } from '@raptix/web-contracts'
import { Card, ComposerQuestionPanel } from './RealConsole'
import { groupToolRuns, type ConsoleItem } from './console-view'
import type { ConsoleSession } from './use-console-session'

const PULSE_CSS = `@keyframes raptix-pulse-green { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } } .raptix-pulse-green { animation: raptix-pulse-green 1.4s ease-in-out infinite; }`

export function isUxDemoActive(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('uxDemo')
}

const C = { ink: '#0F172A', body: '#334155', muted: '#94A3B8', border: '#E2E8F0', page: '#F8FAFC', red: '#DC2626' }
const MONO = "'JetBrains Mono', monospace"
const RUN_ID = '01uxdemo0000000000000000000000'

const question = (id: string, header: string, text: string, options: { label: string; description: string }[], multiSelect = false, allowOther = true): PendingInterruptView =>
  ({ questionId: id, question: text, header, options, multiSelect, allowOther, source: 'runtime' })

const card = (item: Omit<ConsoleItem, 'runId' | 'source'> & Partial<Pick<ConsoleItem, 'runId' | 'source'>>): ConsoleItem => ({ runId: RUN_ID, source: 'runtime', ...item })

const LONG_REASONING = Array.from({ length: 12 }, (_, i) =>
  `(${i + 1}) Đối chiếu phạm vi đã phê duyệt với dữ liệu thu thập: dải 10.129.14.0/24 chỉ ghi nhận host sống 10.129.14.53; RoE mục ${i + 1} giới hạn 500 gói/giây nên luồng quét phải phân mảnh theo thời gian, ưu tiên cổng dịch vụ phổ biến (22/80/443/445/3389) trước khi mở rộng, mọi phát hiện phải được ghi vào nhật ký bằng chứng kèm timestamp trước khi chuyển bước, và các kết luận chưa kiểm chứng được đánh dấu "cần xác nhận" thay vì đưa vào kết luận.`).join('\n\n')

const MEDIUM_REASONING = 'Người vận hành vừa chốt phạm vi và ngôn ngữ. Trước khi chuyển sang giai đoạn khai thác cần: (1) xác nhận cửa sổ bảo trì để tránh ảnh hưởng dịch vụ thật; (2) rà lại danh mục công cụ đã được duyệt; (3) nếu vượt phạm vi phát hiện thêm host mới thì dừng và hỏi lại. Chuẩn bị câu hỏi xác nhận thời gian trước khi tiếp tục.'

const ANSWERED_1 = card({ id: 'q-hist-1', kind: 'question', questionId: 'q-hist-1', header: 'Phạm vi', question: 'Phạm vi hoạt động giới hạn trong dải 10.129.14.0/24?', options: [{ label: 'Có (Recommended)', description: 'Chỉ hoạt động trong dải đã phê duyệt' }, { label: 'Mở rộng', description: 'Cần phê duyệt bổ sung' }], multiSelect: false, allowOther: true, answer: 'Có — chỉ dải 10.129.14.0/24, loại trừ dải cổng khách' })

const BASE_ITEMS: ConsoleItem[] = [
  card({ id: 'op-1', kind: 'operator', text: 'Briefing: đánh giá an ninh mạng lab nội bộ demo.internal.lab. Ưu tiên phát hiện lỗ hổng web và dịch vụ exposed; RoE và scope xem trong tài liệu đính kèm dự án.' }),
  card({ id: 'ag-1', kind: 'agent', agent: 'soundwave', reasoning: LONG_REASONING, text: 'Đã nhận briefing. Tôi sẽ bắt đầu bằng khảo sát cấu trúc mạng lab, sau đó đặt các câu hỏi cấu hình cần thiết trước khi soạn kế hoạch chi tiết.' }),
  card({ id: 'inv-1', kind: 'invocation', agent: 'recon', sessionId: 'sess-demo-recon-01', status: 'success', elapsedSeconds: 8.4, text: 'Khảo sát mạng lab: 1 host sống trong dải 10.129.14.0/24.' }),
  card({ id: 'tool-1', kind: 'tool', tool: 'nmap', argsPreview: '{"target":"10.129.14.53","ports":"1-1024","flags":"-sV -T3"}', status: 'success', content: 'PORT     STATE  SERVICE\n22/tcp   open   ssh      OpenSSH 8.9p1\n80/tcp   open   http     nginx 1.24.0\n443/tcp  open   ssl/https nginx 1.24.0\n445/tcp  open   smb      Samba 4.15.13' }),
  card({ id: 'tool-2', kind: 'tool', tool: 'nikto', argsPreview: '{"target":"https://10.129.14.53/"}', status: 'success', content: '- Nikto v2.5.0\n+ Target IP: 10.129.14.53\n+ GET /admin: Directory indexing found (INFO)\n+ GET /login.php: Login page detected' }),
  card({ id: 'tool-3', kind: 'tool', tool: 'read_file', argsPreview: '{"path":"/workspace/corporate-03/plan/roe.json"}', status: 'success', content: '{\n  "client": "Corporate-03",\n  "testing_window": "2026-10-12T00:00:00Z/2026-10-19T23:59:59Z",\n  "scope": [{ "target": "https://10.129.14.53/", "type": "web", "notes": "HTB lab host — duy nhất" }]\n}' }),
  ANSWERED_1,
  card({ id: 'ag-2', kind: 'agent', agent: 'soundwave', reasoning: MEDIUM_REASONING, text: 'Phạm vi đã rõ. Tiếp theo là liệt kê dịch vụ web và xác nhận các tuỳ chọn báo cáo trước khi khoá kế hoạch.\n\n| Hạng mục | Giá trị |\n|---|---|\n| **Host đích** | `10.129.14.53` |\n| **Dịch vụ phát hiện** | ssh · http · https · smb |\n| **Ưu tiên** | web enum trước, service scan sau |\n\nKiểm tra lại **RoE** trước khi quét: `rate <= 500 pkt/s`.' }),
  card({ id: 'q-hist-2', kind: 'question', questionId: 'q-hist-2', header: 'Quét cổng', question: 'Được phép quét toàn bộ 65535 cổng trên host đích?', options: [{ label: 'Có (Recommended)', description: 'Quét đầy đủ, tốc độ giới hạn 500 gói/giây' }, { label: 'Không', description: 'Chỉ top 1024 cổng phổ biến' }], multiSelect: false, allowOther: true, answer: 'Có, nhưng giới hạn 500 gói/giây' }),
  card({ id: 'int-1', kind: 'interrupt', interruptId: 'demo-interrupt-round-1' }),
]

const HANDOFF: ConsoleItem = card({ id: 'hand-1', kind: 'handoff', agent: 'soundwave' })

const chunkText = (text: string, size: number): string[] => {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts
}

export default function ConsoleUxDemo({ project }: { project: { displayName: string } }) {
  const [items, setItems] = useState<ConsoleItem[]>(() => groupToolRuns(BASE_ITEMS))
  const [pending, setPending] = useState<PendingInterruptView[]>([
    question('q-live-1', 'Scope', 'Xác nhận phạm vi kỹ thuật: launcher ghi nhận mục tiêu là https://10.129.14.53/ — giới hạn mọi kiểm thử vào host này?', [
      { label: 'Chỉ 10.129.14.53 (Recommended)', description: 'Không mở rộng sang host khác trong dải' },
      { label: 'Mở rộng dải /24', description: 'Cho phép kiểm tra các host lân cận đã phát hiện' },
    ]),
    question('q-live-2', 'Ngôn ngữ', 'Ngôn ngữ cho báo cáo và trao đổi kết quả?', [
      { label: 'Tiếng Việt', description: 'Báo cáo và trao đổi bằng tiếng Việt' },
      { label: 'English', description: 'Report and communication in English' },
    ], false, false),
    question('q-live-3', 'Công cụ', 'Nhóm công cụ nào được phép trong giai đoạn thu thập thông tin?', [
      { label: 'Service scan', description: 'nmap, enumerating dịch vụ và phiên bản' },
      { label: 'Web enumeration', description: 'nikto, gobuster, dirb trên dịch vụ web' },
      { label: 'SMB/NetBIOS enum', description: 'enumclient, smbclient, crackmapexec (read-only)' },
    ], true, true),
  ])
  const [answered, setAnswered] = useState<readonly string[]>(['q-hist-1', 'q-hist-2'])
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [round, setRound] = useState(1)
  const [draft, setDraft] = useState('')
  // Demo-only streaming tick: keeps the timeline pinned to the bottom while
  // the simulated agent response "types" itself out.
  const [streamTick, setStreamTick] = useState(0)
  const timelineEnd = useRef<HTMLDivElement>(null)
  const timelineScroll = useRef<HTMLDivElement>(null)
  // Sticky-bottom auto-scroll, same as the real console: never yank the
  // reviewer back down while they scroll up during the simulated streaming.
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  const onTimelineScroll = (): void => {
    const el = timelineScroll.current
    if (!el) return
    setPinnedToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById('raptix-console-pulse')) {
      const style = document.createElement('style')
      style.id = 'raptix-console-pulse'
      style.textContent = PULSE_CSS
      document.head.appendChild(style)
    }
  }, [])
  useEffect(() => { if (pinnedToBottom) timelineEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [items.length, streamTick, pinnedToBottom])

  const thread: ThreadBindingView = { engagementId: 'demo', threadId: 'demo-thread', assistantId: 'soundwave', kind: 'planning', createdAt: '2026-10-12T00:00:00.000Z', updatedAt: new Date().toISOString() }
  const run: ScopedRunView = { engagementId: 'demo', threadId: 'demo-thread', runId: RUN_ID, requestId: 'demo-request', rawStatus: 'interrupted', createdAt: '2026-10-12T00:00:00.000Z', updatedAt: new Date().toISOString(), source: 'runtime' }

  const allItems = useMemo<ConsoleItem[]>(() => [
    ...items,
    ...pending.map(q => card({ id: `pending-q-${q.questionId}`, kind: 'question', questionId: q.questionId, header: q.header, question: q.question, options: q.options, multiSelect: q.multiSelect, allowOther: q.allowOther })),
  ], [items, pending])

  const session: ConsoleSession = useMemo(() => ({
    status: 'ready', error: null, threads: [thread], activeThreadId: thread.threadId,
    stream: null, run, transport: 'connected', recoveryRequired: false,
    submitting: false, creating: false, submitError: null,
    pendingQuestions: pending, answered, answering, answerError,
    cancelling: false, cancelError: null,
    approvals: { list: [], loading: false, error: null, decidingId: null, decideError: null },
    createThread: async () => true,
    selectThread: () => {},
    send: async text => {
      setItems(previous => [...previous, card({ id: `op-${Date.now()}`, kind: 'operator', text })])
      window.setTimeout(() => setItems(previous => [...previous, card({ id: `ag-${Date.now()}`, kind: 'agent', agent: 'soundwave', text: 'Đã ghi nhận tin nhắn của bạn (mô phỏng). Trong demo này luồng gửi tin chỉ để cảm nhận giao diện.' })]), 900)
    },
    answerQuestion: async answers => {
      setAnswering(true)
      setAnswerError(null)
      window.setTimeout(() => {
        setAnswering(false)
        const ids = answers.map(a => a.questionId)
        setAnswered(previous => [...previous, ...ids.filter(id => !previous.includes(id))])
        setPending(previous => previous.filter(q => !ids.includes(q.questionId)))
        // Answered questions stay on the timeline as ANSWER cards, like the
        // real console renders them from the ask_user_question tool results.
        const answeredCards = answers.map(a => {
          const q = pending.find(p => p.questionId === a.questionId)
          return card({
            id: `q-ans-${a.questionId}`, kind: 'question', questionId: a.questionId,
            header: q?.header ?? '', question: q?.question ?? '', options: q?.options ?? [],
            multiSelect: q?.multiSelect ?? false, allowOther: q?.allowOther ?? false,
            answer: Array.isArray(a.value) ? a.value.join(', ') : a.value,
          })
        })
        setItems(previous => [
          ...previous.map(item => {
            const match = answers.find(a => a.questionId === item.questionId)
            if (!match) return item
            const answer = Array.isArray(match.value) ? match.value.join(', ') : match.value
            return { ...item, answer }
          }),
          ...answeredCards,
          card({ id: 'ag-ack-slot', kind: 'agent', agent: 'soundwave', reasoning: '', text: '' }),
        ])
        // Simulated agent turn: the reasoning trace and the visible reply
        // "type" themselves out so the reviewer sees the agent thinking.
        const ackId = 'ag-ack-slot'
        const summary = answers.map(a => Array.isArray(a.value) ? a.value.join(', ') : a.value).join(' · ')
        const reasonParts = chunkText(MEDIUM_REASONING, 110)
        const textParts = [`Đã ghi nhận: ${summary}. `, 'Tiếp tục soạn kế hoạch theo cấu hình vừa chốt. ', 'Rà lại các điều kiện thực thi trước khi chuyển sang vòng kế hoạch kế tiếp. ']
        let step = 0
        const timer = window.setInterval(() => {
          step += 1
          setStreamTick(value => value + 1)
          setItems(previous => previous.map(item => item.id === ackId
            ? { ...item, reasoning: reasonParts.slice(0, step).join(''), text: textParts.slice(0, step).join('') }
            : item))
          if (step >= Math.max(reasonParts.length, textParts.length)) {
            window.clearInterval(timer)
            if (round === 1) {
              setRound(2)
              setPending([question('q-live-4', 'Thời gian', 'Thực thi trong cửa sổ bảo trì 22:00–04:00 để giảm rủi ro ảnh hưởng dịch vụ?', [
                { label: 'Đúng khung 22:00–04:00 (Recommended)', description: 'Chạy theo lịch bảo trì đã duyệt' },
                { label: 'Linh hoạt', description: 'Cho phép chạy bất cứ lúc nào trong ngày' },
              ])])
              setItems(previous => [...previous, card({ id: 'int-2', kind: 'interrupt', interruptId: 'demo-interrupt-round-2' })])
            } else {
              setItems(previous => [...previous, HANDOFF])
            }
          }
        }, 160)
      }, 1400)
    },
    cancelRun: async () => {}, decideApproval: async () => {}, refreshApprovals: () => {}, refresh: () => {},
  }), [answered, answering, answerError, pending, round, run, thread])

  // opencode behavior: the panel only holds questions that still need an
  // answer; submitted ones stay on the timeline as ANSWER records.
  const questionCards = allItems.filter(item =>
    item.kind === 'question' && typeof item.questionId === 'string' && !answered.includes(item.questionId) && pending.some(q => q.questionId === item.questionId))
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  const seenQuestionCount = useRef(0)
  useEffect(() => {
    // A newly arrived batch always opens on the FIRST question.
    if (questionCards.length > seenQuestionCount.current) setActiveQuestionIndex(0)
    seenQuestionCount.current = questionCards.length
    setActiveQuestionIndex(value => Math.min(Math.max(value, 0), questionCards.length - 1))
  }, [questionCards.length])
  const activeCard = questionCards[Math.min(Math.max(activeQuestionIndex, 0), questionCards.length - 1)]
  const activeAnswerable = activeCard !== undefined && typeof activeCard.questionId === 'string' && !answered.includes(activeCard.questionId) && pending.some(q => q.questionId === activeCard.questionId)

  const inputStyle: CSSProperties = { flex: 1, fontFamily: MONO, fontSize: 13, color: C.ink, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', outline: 'none' }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: C.page, overflow: 'hidden' }}>
      <div style={{ width: '65%', minWidth: 360, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, padding: '10px 18px', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Execution Timeline</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: '#DDD6FE', color: '#6D28D9', padding: '2px 8px', borderRadius: 10 }}>UX DEMO · MOCK DATA</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: '#FEF2F2', color: C.red, padding: '2px 8px', borderRadius: 10 }}>RUN INTERRUPTED</span>
          <button onClick={() => window.location.reload()}
            style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            ↺ Reset demo
          </button>
        </div>
        <div ref={timelineScroll} onScroll={onTimelineScroll} style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '18px 24px 18px 32px' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 1, background: C.border }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allItems.map(item => <Card key={item.id} item={item} session={session} />)}
              <div ref={timelineEnd} />
            </div>
          </div>
          {!pinnedToBottom && (
            <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
              <button onClick={() => { setPinnedToBottom(true); timelineEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }}
                style={{ pointerEvents: 'auto', fontSize: 11, fontWeight: 700, color: '#FFFFFF', background: '#334155', border: 'none', borderRadius: 10, padding: '5px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,23,42,0.25)' }}>
                ↓ Jump to latest
              </button>
            </div>
          )}
        </div>
        {questionCards.length > 0 && (
          <ComposerQuestionPanel questions={questionCards} index={activeQuestionIndex} setIndex={setActiveQuestionIndex} session={session} />
        )}
        {!activeAnswerable && (
          <div style={{ flexShrink: 0, background: '#FFFFFF', borderTop: `1px solid ${C.border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontFamily: MONO, color: C.red, fontWeight: 700, whiteSpace: 'nowrap' }}>[planning] &gt;</span>
            <input value={draft} onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && draft.trim() && !answering) {
                  const text = draft
                  setDraft('')
                  void session.send(text)
                }
              }}
              placeholder={answering ? 'Đang resume run (mô phỏng)…' : 'Thử gửi tin nhắn (mô phỏng)…'}
              style={inputStyle} />
            <button disabled={!draft.trim() || answering}
              onClick={() => { const text = draft; setDraft(''); void session.send(text) }}
              style={{ background: draft.trim() && !answering ? C.red : '#E2E8F0', color: draft.trim() && !answering ? '#FFFFFF' : '#94A3B8', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600 }}>
              Send
            </button>
          </div>
        )}
      </div>
      <div style={{ width: '35%', minWidth: 280, display: 'flex', flexDirection: 'column', background: '#FFFFFF', overflowY: 'auto' }}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.ink }}>Hướng dẫn trải nghiệm</p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.body, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Chuỗi tool call liên tiếp gộp thành <b>MỘT khung ACTION</b> với toggle TOOL CALLS — mở ra xem từng tool (ARGS/OUTPUT thu gọn riêng).</li>
            <li>Text của AGENT render <b>markdown</b> chuẩn: bảng, chữ đậm, code inline/block.</li>
            <li><b>THINKING</b> trên card AGENT: bấm để mở/đóng; khung nội dung cuộn được trong chiều cao cố định (thẻ dài nhất ~3.200 ký tự để thử scroll).</li>
            <li><b>Câu hỏi pending</b>: hiện ngay trên vùng nhập prompt. Bấm ‹ › (hoặc phím ←/→) để chuyển giữa các câu hỏi.</li>
            <li>Trả lời đủ cả 3 câu (câu cuối là multi-select + cho nhập "Other") — nút <b>Send answers &amp; resume run</b> chỉ bật khi đủ.</li>
            <li>Submit một lần → các câu đã trả lời <b>ẩn khỏi panel</b> (còn lại trên timeline với khối ANSWER) → agent mô phỏng "suy nghĩ tiếp": chữ trả lời type dần và số ký tự THINKING tăng liên tục.</li>
            <li>Sau đó vòng hỏi mới xuất hiện (câu 4) → trả lời tiếp → handoff hoàn tất. Panel chỉ giữ câu <b>chưa trả lời</b>.</li>
          </ol>
          <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
            Trang dùng đúng component thật của console ({project.displayName ? 'dự án' : ''} demo). Toàn bộ dữ liệu là mock; không có request nào gửi tới API. Khi chốt, cơ chế này gắn thẳng vào luồng run thật.
          </p>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 11, color: C.muted }}>
            <div style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Trạng thái demo</div>
            <div>Đã trả lời: {answered.length} câu · Đang chờ: {pending.length} câu · Vòng hỏi: {round}/2</div>
            {answering && <div className="raptix-pulse-green" style={{ marginTop: 4, color: '#16A34A', fontWeight: 700 }}>● RESUMING RUN (mô phỏng)…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
