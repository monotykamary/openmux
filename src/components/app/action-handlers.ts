/**
 * App Action Handlers - callbacks for App component actions
 */
import type { Accessor, Setter } from 'solid-js'
import type { ConfirmationType } from '../../core/types'

export interface ConfirmationState {
  visible: boolean
  type: ConfirmationType
}

export interface ActionHandlersDeps {
  confirmationState: Accessor<ConfirmationState>
  setConfirmationState: Setter<ConfirmationState>
  pendingKillPtyId: Accessor<string | null>
  setPendingKillPtyId: Setter<string | null>
  closePane: () => void
  getFocusedPtyId: () => string | undefined
  destroyPTY: (ptyId: string) => Promise<void>
  enterConfirmMode: () => void
  exitConfirmMode: () => void
  saveSession: () => Promise<void>
  destroyRenderer: () => void
  newPane: (type?: 'shell') => void
  pasteToFocused: () => Promise<void>
  togglePicker: () => void
  toggleConsole: () => void
  openAggregateView: () => void
  enterSearchMode: (ptyId: string) => Promise<void>
  clearAllSelections: () => void
  getFocusedCwd: () => Promise<string | null>
  disposeRuntime: () => Promise<void>
}

export interface ActionHandlers {
  handleNewPane: () => void
  handlePaste: () => void
  handleQuit: () => Promise<void>
  handleRequestQuit: () => void
  handleRequestClosePane: () => void
  handleRequestKillPty: (ptyId: string) => void
  handleConfirmAction: () => Promise<void>
  handleCancelConfirmation: () => void
  handleToggleSessionPicker: () => void
  handleToggleConsole: () => void
  handleToggleAggregateView: () => void
  handleEnterSearch: () => Promise<void>
  pendingCwdRef: string | null
}

export function createActionHandlers(deps: ActionHandlersDeps): ActionHandlers {
  // Ref for passing CWD to effect (avoids closure issues)
  let pendingCwdRef: string | null = null

  const handleNewPane = () => {
    const start = performance.now()

    // Fire off CWD retrieval in background (don't await - takes ~21ms)
    deps.getFocusedCwd().then(cwd => {
      if (cwd) pendingCwdRef = cwd
    })

    // Create pane immediately (shows border instantly)
    deps.newPane()
    console.log(`[NEW_PANE] pane created: ${(performance.now() - start).toFixed(2)}ms`)
  }

  const handlePaste = () => {
    deps.pasteToFocused()
  }

  const handleQuit = async () => {
    await deps.saveSession()
    await deps.disposeRuntime()
    deps.destroyRenderer()
    process.exit(0)
  }

  const handleRequestQuit = () => {
    deps.enterConfirmMode()
    deps.setConfirmationState({ visible: true, type: 'exit' })
  }

  const handleRequestClosePane = () => {
    deps.enterConfirmMode()
    deps.setConfirmationState({ visible: true, type: 'close_pane' })
  }

  const handleRequestKillPty = (ptyId: string) => {
    deps.setPendingKillPtyId(ptyId)
    deps.enterConfirmMode()
    deps.setConfirmationState({ visible: true, type: 'kill_pty' })
  }

  const handleConfirmAction = async () => {
    const state = deps.confirmationState()
    deps.exitConfirmMode()
    deps.setConfirmationState({ visible: false, type: state.type })

    if (state.type === 'exit') {
      await handleQuit()
    } else if (state.type === 'close_pane') {
      const focusedPtyId = deps.getFocusedPtyId()
      if (focusedPtyId) {
        await deps.destroyPTY(focusedPtyId)
      }
      deps.closePane()
    } else if (state.type === 'kill_pty') {
      const ptyId = deps.pendingKillPtyId()
      if (ptyId) {
        await deps.destroyPTY(ptyId)
        deps.setPendingKillPtyId(null)
      }
    }
  }

  const handleCancelConfirmation = () => {
    deps.exitConfirmMode()
    deps.setConfirmationState({ visible: false, type: deps.confirmationState().type })
    deps.setPendingKillPtyId(null)
  }

  const handleToggleSessionPicker = () => {
    deps.togglePicker()
  }

  const handleToggleConsole = () => {
    deps.toggleConsole()
  }

  const handleToggleAggregateView = () => {
    deps.openAggregateView()
  }

  const handleEnterSearch = async () => {
    deps.clearAllSelections()
    const focusedPtyId = deps.getFocusedPtyId()
    if (focusedPtyId) {
      await deps.enterSearchMode(focusedPtyId)
    }
  }

  return {
    handleNewPane,
    handlePaste,
    handleQuit,
    handleRequestQuit,
    handleRequestClosePane,
    handleRequestKillPty,
    handleConfirmAction,
    handleCancelConfirmation,
    handleToggleSessionPicker,
    handleToggleConsole,
    handleToggleAggregateView,
    handleEnterSearch,
    get pendingCwdRef() { return pendingCwdRef },
    set pendingCwdRef(v: string | null) { pendingCwdRef = v },
  }
}
