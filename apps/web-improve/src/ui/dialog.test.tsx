/**
 * Focused accessible-widget tests for the extracted dialog, drawer and menu
 * primitives (ticket 11). Interaction/behavior per the existing semantics —
 * Escape and backdrop dismissal, topmost-layer arbitration, focus-in/focus-
 * restore, Tab wrap, menu trigger/item/outside-click interaction — not render
 * snapshots. Imports go through the `../ui` compatibility barrel to pin the
 * forwarding surface that all screens still use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Copy, MoreHorizontal } from 'lucide-react'
import { Button, Drawer, Menu, Modal } from '../ui'

afterEach(cleanup)

function ConfirmHost({ danger }: { danger?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button onClick={() => setOpen(true)}>Delete project</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Confirm deletion" danger={danger}>
      This removes the project and all of its operations.
    </Modal>
  </>
}

describe('modal primitive', () => {
  it('renders nothing while closed and a labelled dialog with default width when open', async () => {
    render(<ConfirmHost danger />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    const dlg = screen.getByRole('dialog', { name: 'Confirm deletion' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.style.maxWidth).toBe('520px')
    expect(dlg.className).toContain('border-bad/50')
    expect(screen.getByText('This removes the project and all of its operations.')).toBeInTheDocument()
  })

  it('closes via Escape and via backdrop click', async () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Confirm deletion">body copy</Modal>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    const dlg = screen.getByRole('dialog')
    await userEvent.click(dlg.previousElementSibling as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves focus to the first focusable control on open and restores it to the trigger on close', async () => {
    render(<ConfirmHost />)
    const trigger = screen.getByRole('button', { name: 'Delete project' })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('wraps Tab at both ends of the focusable set', async () => {
    render(<Modal open onClose={vi.fn()} title="Wrap" footer={<Button>Footer action</Button>}>body</Modal>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
    await userEvent.keyboard('{Tab}')
    expect(screen.getByRole('button', { name: 'Footer action' })).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab/}')
    expect(screen.getByRole('button', { name: 'Footer action' })).toHaveFocus()
  })

  it('lets only the topmost dialog layer handle Escape, without duplicate close callbacks', async () => {
    const closeOuter = vi.fn()
    function Stacked() {
      const [innerOpen, setInnerOpen] = useState(true)
      return (
        <Modal open onClose={closeOuter} title="Outer">
          <Button onClick={() => setInnerOpen(true)}>Open inner</Button>
          <Modal open={innerOpen} onClose={() => { setInnerOpen(false) }} title="Inner">inner body</Modal>
        </Modal>
      )
    }
    render(<Stacked />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    await userEvent.keyboard('{Escape}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument()
    expect(closeOuter).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(closeOuter).toHaveBeenCalledTimes(1)
  })
})

describe('drawer primitive', () => {
  it('renders a side panel dialog with the wide width and closes via Escape, close button and backdrop', async () => {
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} width={640} title="Event details" footer={<Button>View channels</Button>}>details body</Drawer>)
    const dlg = screen.getByRole('dialog', { name: 'Event details' })
    expect(dlg.tagName).toBe('ASIDE')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.style.maxWidth).toBe('640px')
    expect(screen.getByText('details body')).toBeInTheDocument()
    expect(screen.getByText('View channels')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(dlg.previousElementSibling as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('renders nothing while closed', () => {
    render(<Drawer open={false} onClose={vi.fn()} title="Event details">body</Drawer>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('menu primitive', () => {
  function MenuHost({ onPick, align }: { onPick: (label: string) => void; align?: 'left' | 'right' }) {
    return (
      <Menu align={align} trigger={<Button size="sm" icon={MoreHorizontal}>Actions</Button>} items={[
        { label: 'Duplicate agent', icon: Copy, onClick: () => onPick('duplicate') },
        { label: 'Delete agent', danger: true, disabled: true, hint: 'Read-only project', onClick: () => onPick('delete') },
      ]} />
    )
  }

  it('opens via trigger click and via Enter on the focused button trigger, and closes on outside click', async () => {
    render(<MenuHost onPick={vi.fn()} />)
    expect(screen.queryByRole('menu')).toBeNull()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens via ArrowDown on the focused trigger, moves focus to the first enabled item and conveys state on the trigger (ticket 64)', async () => {
    render(<MenuHost onPick={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Duplicate agent' })).toHaveFocus())
    // The disabled item is skipped by the focus-in, never auto-focused.
    expect(screen.getByRole('menuitem', { name: 'Delete agent' })).not.toHaveFocus()
  })

  it('closes via Escape and restores focus to the trigger (dialog focus-restore semantics, ticket 64)', async () => {
    render(<MenuHost onPick={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Duplicate agent' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('activates items with closing, ignores disabled items and contains clicks', async () => {
    const onPick = vi.fn()
    const onRow = vi.fn()
    render(<div onClick={onRow}><MenuHost onPick={onPick} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0].querySelector('svg')).not.toBeNull()
    expect(items[1]).toBeDisabled()
    expect(items[1].getAttribute('title')).toBe('Read-only project')
    expect(items[1].className).toContain('text-bad')
    await userEvent.click(items[1])
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.click(items[0])
    expect(onPick).toHaveBeenCalledWith('duplicate')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('aligns the panel left or right of the trigger, portals it to body and clamps to the viewport (ticket 62)', async () => {
    const left = render(<MenuHost onPick={vi.fn()} align="left" />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('max-w-[calc(100vw-1.5rem)]')
    expect(menu.style.left).not.toBe('')
    expect(menu.style.right).toBe('')
    left.unmount()
    render(<MenuHost onPick={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('menu').style.right).not.toBe('')
    // The panel escapes overflow containers: it renders into document.body.
    expect(screen.getByRole('menu').parentElement).toBe(document.body)
  })
})
