import { act, render } from '@testing-library/react'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { StoreProvider, useStore, type Store } from '../store'

// eslint-disable-next-line react-refresh/only-export-components
function Probe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}

/**
 * Mounts the legacy store with a probe capturing the latest context value.
 * `run` wraps store mutations in act(); `as` switches the demo persona.
 * Fake timers (where needed) must be installed before importing this module —
 * `../store` captures its simulated clock anchor at module evaluation.
 */
export function mountStore(me = 'Alex Morgan') {
  let store!: Store
  const view = render(
    <StoreProvider>
      <Probe ready={(s) => (store = s)} />
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') {
    act(() => {
      store.setMe(me)
    })
  }
  return {
    store: () => store,
    as(name: string) {
      act(() => {
        store.setMe(name)
      })
    },
    run(fn: () => unknown) {
      act(fn)
    },
    unmount: view.unmount,
  }
}

/** Mounts a screen (component or element) inside the store provider. Set window.location.hash before calling for route-driven screens. */
export function mountScreen(ui: ComponentType | ReactNode, me = 'Alex Morgan') {
  let store!: Store
  const node = typeof ui === 'function' ? createElement(ui) : ui
  const view = render(
    <StoreProvider>
      <Probe ready={(s) => (store = s)} />
      {node}
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') {
    act(() => {
      store.setMe(me)
    })
  }
  return Object.assign(view, { store: () => store })
}
