/**
 * Open state of the real "New project" popup. Any real-mode entry point
 * (portfolio, overview, project switcher) opens the same dialog, so creating a
 * project never leaves the page the operator is on.
 */
import { create } from 'zustand'

interface CreateProjectDialogState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useCreateProjectDialog = create<CreateProjectDialogState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

export const showCreateProject = (): void => useCreateProjectDialog.getState().show()
