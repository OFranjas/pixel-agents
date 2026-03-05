import { useState, useCallback, useRef } from 'react'
import { OfficeState } from './office/engine/officeState.js'
import { OfficeCanvas } from './office/components/OfficeCanvas.js'
import { ToolOverlay } from './office/components/ToolOverlay.js'
import { EditorToolbar } from './office/editor/EditorToolbar.js'
import { EditorState } from './office/editor/editorState.js'
import { EditTool } from './office/types.js'
import { isRotatable } from './office/layout/furnitureCatalog.js'
import { vscode } from './vscodeApi.js'
import { useExtensionMessages } from './hooks/useExtensionMessages.js'
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js'
import { useEditorActions } from './hooks/useEditorActions.js'
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js'
import { ZoomControls } from './components/ZoomControls.js'
import { BottomToolbar } from './components/BottomToolbar.js'
import { DebugView } from './components/DebugView.js'

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null }
const editorState = new EditorState()

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState()
  }
  return officeStateRef.current
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
}

function defaultApprovalDecisions(method: string): unknown[] {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    return ['accept', 'acceptForSession', 'decline', 'cancel']
  }
  return ['accept', 'decline']
}

function approvalMethodLabel(method: string): string {
  if (method === 'item/commandExecution/requestApproval') return 'Command approval'
  if (method === 'item/fileChange/requestApproval') return 'File change approval'
  return method
}

function approvalDecisionLabel(decision: unknown): string {
  if (typeof decision === 'string') {
    if (decision === 'accept') return 'Accept'
    if (decision === 'acceptForSession') return 'Accept for session'
    if (decision === 'decline') return 'Decline'
    if (decision === 'cancel') return 'Cancel turn'
    return decision
  }
  if (decision && typeof decision === 'object') {
    const keys = Object.keys(decision as Record<string, unknown>)
    if (keys.length > 0) {
      if (keys[0] === 'acceptWithExecpolicyAmendment') return 'Accept + remember command rule'
      if (keys[0] === 'applyNetworkPolicyAmendment') return 'Apply network policy rule'
      return keys[0]
    }
  }
  return 'decision'
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function payloadCommandActions(payload: Record<string, unknown>): Array<{ type: string; command: string }> {
  const actions = payload.commandActions
  if (!Array.isArray(actions)) return []
  return actions
    .filter((action): action is Record<string, unknown> => !!action && typeof action === 'object')
    .map((action) => ({
      type: typeof action.type === 'string' ? action.type : 'unknown',
      command: typeof action.command === 'string' ? action.command : '',
    }))
    .filter((action) => action.command.length > 0)
}

function EditActionBar({ editor, editorState: es }: { editor: ReturnType<typeof useEditorActions>; editorState: EditorState }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const undoDisabled = es.undoStack.length === 0
  const redoDisabled = es.redoStack.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button
        style={actionBarBtnStyle}
        onClick={editor.handleSave}
        title="Save layout"
      >
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => { setShowResetConfirm(false); editor.handleReset() }}
          >
            Yes
          </button>
          <button
            style={actionBarBtnStyle}
            onClick={() => setShowResetConfirm(false)}
          >
            No
          </button>
        </div>
      )}
    </div>
  )
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState)

  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty])

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    agentMessages,
    commandOutputs,
    fileChangeOutputs,
    agentDiffs,
    pendingApprovals,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    workspaceFolders,
    runtimeMode,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty)

  const [isDebugMode, setIsDebugMode] = useState(false)
  const [expandedMessageByAgent, setExpandedMessageByAgent] = useState<Record<number, boolean>>({})

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), [])

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id })
  }, [])

  const handleOpenCodex = useCallback((folderPath?: string) => {
    vscode.postMessage({ type: 'openCodex', folderPath })
  }, [])

  const handleSendPrompt = useCallback((text: string) => {
    if (selectedAgent === null) return
    vscode.postMessage({ type: 'sendAgentPrompt', id: selectedAgent, text })
  }, [selectedAgent])

  const handleSubmitApproval = useCallback((requestId: string | number, decision: unknown) => {
    vscode.postMessage({ type: 'submitApprovalDecision', requestId, decision })
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0)
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  )

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id })
  }, [])

  const handleClick = useCallback((agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState()
    const meta = os.subagentMeta.get(agentId)
    const focusId = meta ? meta.parentAgentId : agentId
    vscode.postMessage({ type: 'focusAgent', id: focusId })
  }, [])

  const officeState = getOfficeState()
  const selectedMessage = selectedAgent !== null ? agentMessages[selectedAgent]?.text ?? '' : ''
  const isSelectedMessageExpanded = selectedAgent !== null ? !!expandedMessageByAgent[selectedAgent] : false

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint = editor.isEditMode && (() => {
    if (editorState.selectedFurnitureUid) {
      const item = officeState.getLayout().furniture.find((f) => f.uid === editorState.selectedFurnitureUid)
      if (item && isRotatable(item.type)) return true
    }
    if (editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType)) {
      return true
    }
    return false
  })()

  if (!layoutReady) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--vscode-foreground)' }}>
        Loading...
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
      `}</style>

      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--pixel-vignette)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onOpenClaude={editor.handleOpenClaude}
        onOpenCodex={handleOpenCodex}
        onToggleEditMode={editor.handleToggleEditMode}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        workspaceFolders={workspaceFolders}
        runtimeMode={runtimeMode}
        selectedAgent={selectedAgent}
        onSendPrompt={handleSendPrompt}
      />

      {editor.isEditMode && editor.isDirty && (
        <EditActionBar editor={editor} editorState={editorState} />
      )}

      {showRotateHint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: editor.isDirty ? 'translateX(calc(-50% + 100px))' : 'translateX(-50%)',
            zIndex: 49,
            background: 'var(--pixel-hint-bg)',
            color: '#fff',
            fontSize: '20px',
            padding: '3px 8px',
            borderRadius: 0,
            border: '2px solid var(--pixel-accent)',
            boxShadow: 'var(--pixel-shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Press <b>R</b> to rotate
        </div>
      )}

      {editor.isEditMode && (() => {
        // Compute selected furniture color from current layout
        const selUid = editorState.selectedFurnitureUid
        const selColor = selUid
          ? officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null
          : null
        return (
          <EditorToolbar
            activeTool={editorState.activeTool}
            selectedTileType={editorState.selectedTileType}
            selectedFurnitureType={editorState.selectedFurnitureType}
            selectedFurnitureUid={selUid}
            selectedFurnitureColor={selColor}
            floorColor={editorState.floorColor}
            wallColor={editorState.wallColor}
            onToolChange={editor.handleToolChange}
            onTileTypeChange={editor.handleTileTypeChange}
            onFloorColorChange={editor.handleFloorColorChange}
            onWallColorChange={editor.handleWallColorChange}
            onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={editor.handleFurnitureTypeChange}
            loadedAssets={loadedAssets}
          />
        )
      })()}

      <ToolOverlay
        officeState={officeState}
        agents={agents}
        agentTools={agentTools}
        agentMessages={agentMessages}
        subagentCharacters={subagentCharacters}
        containerRef={containerRef}
        zoom={editor.zoom}
        panRef={editor.panRef}
        onCloseAgent={handleCloseAgent}
      />

      {selectedAgent !== null && pendingApprovals[selectedAgent] && pendingApprovals[selectedAgent].length > 0 && (
        <div
          style={{
            position: 'absolute',
            right: 10,
            top: 10,
            width: 480,
            maxHeight: '55%',
            overflow: 'auto',
            zIndex: 90,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            boxShadow: 'var(--pixel-shadow)',
            padding: 8,
          }}
        >
          <div style={{ fontSize: '22px', marginBottom: 8 }}>Pending approvals</div>
          {pendingApprovals[selectedAgent].map((req) => {
            const available = req.availableDecisions && req.availableDecisions.length > 0
              ? req.availableDecisions
              : defaultApprovalDecisions(req.method)
            const reason = payloadString(req.payload, 'reason')
            const command = payloadString(req.payload, 'command')
            const cwd = payloadString(req.payload, 'cwd')
            const itemId = payloadString(req.payload, 'itemId')
            const turnId = payloadString(req.payload, 'turnId')
            const commandActions = payloadCommandActions(req.payload)
            return (
              <div
                key={String(req.requestId)}
                style={{ marginBottom: 12, border: '1px solid var(--pixel-border)', padding: 8, background: 'var(--pixel-btn-bg)' }}
              >
                <div style={{ fontSize: '20px', marginBottom: 6 }}>{approvalMethodLabel(req.method)}</div>
                {reason && (
                  <div style={{ fontSize: '16px', marginBottom: 6, color: 'var(--pixel-text)' }}>
                    {reason}
                  </div>
                )}
                {command && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: '14px', opacity: 0.8, marginBottom: 2 }}>Command</div>
                    <pre
                      style={{
                        fontSize: '13px',
                        whiteSpace: 'pre-wrap',
                        margin: 0,
                        background: 'var(--vscode-editor-background)',
                        border: '1px solid var(--pixel-border)',
                        padding: 6,
                      }}
                    >
                      {command}
                    </pre>
                  </div>
                )}
                {cwd && (
                  <div style={{ fontSize: '14px', marginBottom: 6, opacity: 0.85 }}>
                    cwd: <code>{cwd}</code>
                  </div>
                )}
                {commandActions.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: '14px', opacity: 0.8, marginBottom: 2 }}>Detected actions</div>
                    {commandActions.map((action, idx) => (
                      <div key={`${String(req.requestId)}-action-${idx}`} style={{ fontSize: '14px', opacity: 0.9 }}>
                        {action.type}: {action.command}
                      </div>
                    ))}
                  </div>
                )}
                {(itemId || turnId) && (
                  <div style={{ fontSize: '13px', opacity: 0.75, marginBottom: 6 }}>
                    {itemId ? `item: ${itemId}` : ''}
                    {itemId && turnId ? ' • ' : ''}
                    {turnId ? `turn: ${turnId}` : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {available.map((decision, idx) => (
                    <button
                      key={`${String(req.requestId)}-${idx}`}
                      style={{ fontSize: '16px', padding: '4px 8px' }}
                      onClick={() => handleSubmitApproval(req.requestId, decision)}
                    >
                      {approvalDecisionLabel(decision)}
                    </button>
                  ))}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: '13px', opacity: 0.8, cursor: 'pointer' }}>Raw payload</summary>
                  <pre style={{ fontSize: '12px', marginTop: 4, whiteSpace: 'pre-wrap', opacity: 0.8 }}>
                    {JSON.stringify(req.payload, null, 2)}
                  </pre>
                </details>
              </div>
            )
          })}
        </div>
      )}

      {selectedAgent !== null && selectedMessage.trim().length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: isDebugMode ? '42%' : 60,
            width: 460,
            maxHeight: isSelectedMessageExpanded ? '45%' : 180,
            overflow: 'auto',
            zIndex: 85,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            boxShadow: 'var(--pixel-shadow)',
            padding: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: '22px' }}>Agent message</div>
            <button
              style={{ fontSize: '14px', padding: '2px 8px' }}
              onClick={() => {
                if (selectedAgent === null) return
                setExpandedMessageByAgent((prev) => ({ ...prev, [selectedAgent]: !prev[selectedAgent] }))
              }}
            >
              {isSelectedMessageExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontSize: '15px',
              color: 'var(--pixel-text)',
              maxHeight: isSelectedMessageExpanded ? 'none' : 112,
              overflow: isSelectedMessageExpanded ? 'visible' : 'hidden',
            }}
          >
            {selectedMessage}
          </pre>
        </div>
      )}

      {selectedAgent !== null && agentDiffs[selectedAgent] && (
        <div
          style={{
            position: 'absolute',
            right: 10,
            bottom: isDebugMode ? '42%' : 60,
            width: 460,
            maxHeight: isDebugMode ? '35%' : '40%',
            overflow: 'auto',
            zIndex: 85,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            boxShadow: 'var(--pixel-shadow)',
            padding: 8,
          }}
        >
          <div style={{ fontSize: '22px', marginBottom: 6 }}>Turn diff</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '16px', color: 'var(--pixel-text)' }}>
            {agentDiffs[selectedAgent].diff || '(empty diff)'}
          </pre>
        </div>
      )}

      {isDebugMode && (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          commandOutputs={commandOutputs}
          fileChangeOutputs={fileChangeOutputs}
          onSelectAgent={handleSelectAgent}
        />
      )}
    </div>
  )
}

export default App
