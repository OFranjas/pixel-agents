import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { removeAgent, sendLayout, getProjectDirPath } from './agentManager.js';
import { ensureProjectScan } from './fileWatcher.js';
import {
	loadFurnitureAssets,
	sendAssetsToWebview,
	loadFloorTiles,
	sendFloorTilesToWebview,
	loadWallTiles,
	sendWallTilesToWebview,
	loadCharacterSprites,
	sendCharacterSpritesToWebview,
	loadDefaultLayout,
} from './assetLoader.js';
import {
	WORKSPACE_KEY_AGENT_SEATS,
	GLOBAL_KEY_SOUND_ENABLED,
} from './constants.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { ClaudeJsonlRuntime } from './runtime/claudeJsonlRuntime.js';
import { CodexAppServerRuntime } from './codex/runtime.js';
import {
	loadPersistedAgentsV2,
	readRuntimeSettings,
	removePersistedAgent,
	savePersistedAgentsV2,
	upsertPersistedCodexAgent,
	type RuntimeMode,
} from './runtime/runtimeManager.js';
import type { PersistedRuntimeAgentV2, RuntimeEvent } from './runtime/types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
	nextAgentId = { current: 1 };
	nextTerminalIndex = { current: 1 };
	agents = new Map<number, AgentState>();
	webviewView: vscode.WebviewView | undefined;

	// Per-agent timers
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

	// /clear detection: project-level scan for new JSONL files
	activeAgentId = { current: null as number | null };
	knownJsonlFiles = new Set<string>();
	projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

	// Bundled default layout (loaded from assets/default-layout.json)
	defaultLayout: Record<string, unknown> | null = null;

	// Cross-window layout sync
	layoutWatcher: LayoutWatcher | null = null;

	private readonly codexOutput = vscode.window.createOutputChannel('Codex Diagnostics');
	private runtimeMode: RuntimeMode = 'claude';
	private persistedAgentsV2: PersistedRuntimeAgentV2[] = [];
	private readonly claudeRuntime: ClaudeJsonlRuntime;
	private codexRuntime: CodexAppServerRuntime | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.claudeRuntime = new ClaudeJsonlRuntime({
			context: this.context,
			nextAgentId: this.nextAgentId,
			nextTerminalIndex: this.nextTerminalIndex,
			agents: this.agents,
			activeAgentId: this.activeAgentId,
			knownJsonlFiles: this.knownJsonlFiles,
			fileWatchers: this.fileWatchers,
			pollingTimers: this.pollingTimers,
			waitingTimers: this.waitingTimers,
			permissionTimers: this.permissionTimers,
			jsonlPollTimers: this.jsonlPollTimers,
			projectScanTimer: this.projectScanTimer,
			getWebview: () => this.webview,
			onPersist: () => {
				void this.syncPersistedAgentsV2FromClaude();
			},
		});
	}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	private get webview(): vscode.Webview | undefined {
		return this.webviewView?.webview;
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		webviewView.webview.onDidReceiveMessage(async (message: any) => {
			if (message.type === 'openClaude') {
				if (this.runtimeMode === 'codex') {
					await this.createCodexAgent(message.folderPath as string | undefined);
				} else {
					await this.claudeRuntime.createAgent(message.folderPath as string | undefined);
				}
			} else if (message.type === 'openCodex') {
				await this.createCodexAgent(message.folderPath as string | undefined);
			} else if (message.type === 'focusAgent') {
				const agentId = Number(message.id);
				if (!Number.isFinite(agentId)) return;
				if (!this.claudeRuntime.focusAgent(agentId)) {
					this.codexRuntime?.focusAgent(agentId);
				}
			} else if (message.type === 'closeAgent') {
				const agentId = Number(message.id);
				if (!Number.isFinite(agentId)) return;
				if (!this.claudeRuntime.closeAgent(agentId)) {
					await this.codexRuntime?.closeAgent(agentId);
					this.persistedAgentsV2 = removePersistedAgent(this.persistedAgentsV2, agentId);
					await savePersistedAgentsV2(this.context, this.persistedAgentsV2);
				}
			} else if (message.type === 'sendAgentPrompt') {
				const agentId = Number(message.id);
				const text = typeof message.text === 'string' ? message.text.trim() : '';
				if (!Number.isFinite(agentId) || !text) return;
				if (!this.claudeRuntime.sendPrompt(agentId, text)) {
					await this.codexRuntime?.sendPrompt(agentId, text);
				}
			} else if (message.type === 'submitApprovalDecision') {
				if (message.requestId === undefined) return;
				await this.codexRuntime?.submitApprovalDecision(
					message.requestId,
					message.decision,
				);
			} else if (message.type === 'saveAgentSeats') {
				// Store seat assignments in a separate key (never touched by runtime persistence)
				console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
				this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
			} else if (message.type === 'saveLayout') {
				this.layoutWatcher?.markOwnWrite();
				writeLayoutToFile(message.layout as Record<string, unknown>);
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
			} else if (message.type === 'webviewReady') {
				await this.handleWebviewReady();
			} else if (message.type === 'openSessionsFolder') {
				if (this.runtimeMode === 'codex') {
					const codexSessions = path.join(os.homedir(), '.codex', 'sessions');
					if (fs.existsSync(codexSessions)) {
						vscode.env.openExternal(vscode.Uri.file(codexSessions));
					}
				} else {
					const projectDir = getProjectDirPath();
					if (projectDir && fs.existsSync(projectDir)) {
						vscode.env.openExternal(vscode.Uri.file(projectDir));
					}
				}
			} else if (message.type === 'exportLayout') {
				const layout = readLayoutFromFile();
				if (!layout) {
					vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
					return;
				}
				const uri = await vscode.window.showSaveDialog({
					filters: { 'JSON Files': ['json'] },
					defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
				});
				if (uri) {
					fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
					vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
				}
			} else if (message.type === 'importLayout') {
				const uris = await vscode.window.showOpenDialog({
					filters: { 'JSON Files': ['json'] },
					canSelectMany: false,
				});
				if (!uris || uris.length === 0) return;
				try {
					const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
					const imported = JSON.parse(raw) as Record<string, unknown>;
					if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
						vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
						return;
					}
					this.layoutWatcher?.markOwnWrite();
					writeLayoutToFile(imported);
					this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
				}
			}
		});

		vscode.window.onDidChangeActiveTerminal((terminal: vscode.Terminal | undefined) => {
			this.activeAgentId.current = null;
			if (!terminal) return;
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === terminal) {
					this.activeAgentId.current = id;
					webviewView.webview.postMessage({ type: 'agentSelected', id });
					break;
				}
			}
		});

		vscode.window.onDidCloseTerminal((closed: vscode.Terminal) => {
			for (const [id, agent] of this.agents) {
				if (agent.terminalRef === closed) {
					if (this.activeAgentId.current === id) {
						this.activeAgentId.current = null;
					}
					removeAgent(
						id,
						this.agents,
						this.fileWatchers,
						this.pollingTimers,
						this.waitingTimers,
						this.permissionTimers,
						this.jsonlPollTimers,
						() => {
							void this.syncPersistedAgentsV2FromClaude();
						},
					);
					webviewView.webview.postMessage({ type: 'agentClosed', id });
				}
			}
		});
	}

	private async handleWebviewReady(): Promise<void> {
		this.runtimeMode = readRuntimeSettings().mode;
		this.persistedAgentsV2 = await loadPersistedAgentsV2(this.context);

		// Send persisted settings to webview.
		const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
		this.webview?.postMessage({
			type: 'settingsLoaded',
			soundEnabled,
			runtimeMode: this.runtimeMode,
		});

		// Send workspace folders to webview (only when multi-root).
		const wsFolders = vscode.workspace.workspaceFolders;
		if (wsFolders && wsFolders.length > 1) {
			this.webview?.postMessage({
				type: 'workspaceFolders',
				folders: wsFolders.map((f: vscode.WorkspaceFolder) => ({ name: f.name, path: f.uri.fsPath })),
			});
		}

		if (this.runtimeMode === 'claude' || this.runtimeMode === 'mixed') {
			this.claudeRuntime.restore();
		}

		let codexReady = false;
		if (this.runtimeMode === 'codex' || this.runtimeMode === 'mixed') {
			try {
				await this.ensureCodexRuntimeInitialized();
				await this.restoreCodexAgents();
				codexReady = true;
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				this.codexOutput.appendLine(`[codex] startup failed: ${detail}`);
				this.codexRuntime = null;
				if (this.runtimeMode === 'codex') {
					vscode.window.showErrorMessage(`Pixel Agents: Codex startup failed. ${detail}`);
				} else {
					vscode.window.showWarningMessage(`Pixel Agents: Codex startup failed in mixed mode. ${detail}`);
				}
			}
		}

		this.loadAssetsAndLayout();

		if (this.runtimeMode === 'claude' || this.runtimeMode === 'mixed') {
			this.claudeRuntime.sendExistingAgents();
		}
		if (codexReady) {
			this.sendExistingCodexAgents();
		}
	}

	private async ensureCodexRuntimeInitialized(): Promise<void> {
		if (this.codexRuntime?.isInitialized()) {
			return;
		}
		const settings = readRuntimeSettings();
		this.runtimeMode = settings.mode;
		this.codexRuntime = new CodexAppServerRuntime({
			command: settings.codexCommand,
			experimentalApi: settings.codexExperimentalApi,
			autoRestart: settings.codexAutoRestart,
			outputChannel: this.codexOutput,
			onEvent: (event) => this.handleCodexRuntimeEvent(event),
			allocateAgentId: () => this.nextAgentId.current++,
		});
		await this.codexRuntime.initialize();
	}

	private handleCodexRuntimeEvent(event: RuntimeEvent): void {
		const post = (payload: Record<string, unknown>) => this.webview?.postMessage(payload);
		switch (event.type) {
			case 'agentCreated':
				post({ type: 'agentCreated', id: event.id, folderName: event.folderName });
				break;
			case 'agentClosed':
				post({ type: 'agentClosed', id: event.id });
				break;
			case 'agentSelected':
				post({ type: 'agentSelected', id: event.id });
				break;
			case 'agentStatus':
				post({ type: 'agentStatus', id: event.id, status: event.status });
				break;
			case 'agentToolStart':
				post({ type: 'agentToolStart', id: event.id, toolId: event.toolId, status: event.status });
				break;
			case 'agentToolDone':
				post({ type: 'agentToolDone', id: event.id, toolId: event.toolId });
				break;
			case 'agentToolsClear':
				post({ type: 'agentToolsClear', id: event.id });
				break;
			case 'agentToolPermission':
				post({ type: 'agentToolPermission', id: event.id });
				break;
			case 'agentToolPermissionClear':
				post({ type: 'agentToolPermissionClear', id: event.id });
				break;
			case 'agentMessageStart':
				post({ type: 'agentMessageStart', id: event.id, itemId: event.itemId });
				break;
			case 'agentMessageDelta':
				post({ type: 'agentMessageDelta', id: event.id, itemId: event.itemId, delta: event.delta });
				break;
			case 'agentMessageDone':
				post({ type: 'agentMessageDone', id: event.id, itemId: event.itemId });
				break;
			case 'agentCommandOutputDelta':
				post({ type: 'agentCommandOutputDelta', id: event.id, itemId: event.itemId, delta: event.delta });
				break;
			case 'agentFileChangeOutputDelta':
				post({ type: 'agentFileChangeOutputDelta', id: event.id, itemId: event.itemId, delta: event.delta });
				break;
			case 'agentDiffUpdated':
				post({ type: 'agentDiffUpdated', id: event.id, turnId: event.turnId, diff: event.diff });
				break;
			case 'agentApprovalRequested':
				post({
					type: 'agentApprovalRequested',
					id: event.id,
					requestId: event.requestId,
					method: event.method,
					payload: event.payload,
					availableDecisions: event.availableDecisions,
				});
				break;
			case 'agentApprovalResolved':
				post({ type: 'agentApprovalResolved', id: event.id, requestId: event.requestId });
				break;
			case 'spawnedAgent': {
				this.persistedAgentsV2 = upsertPersistedCodexAgent(
					this.persistedAgentsV2,
					event.id,
					event.threadId,
					undefined,
					event.parentAgentId,
					event.parentRuntimeRefId,
				);
				void savePersistedAgentsV2(this.context, this.persistedAgentsV2);
				post({
					type: 'subagentLinked',
					id: event.id,
					parentAgentId: event.parentAgentId,
					parentRuntimeRefId: event.parentRuntimeRefId,
				});
				break;
			}
		}
	}

	private async createCodexAgent(folderPath?: string): Promise<void> {
		await this.ensureCodexRuntimeInitialized();
		if (!this.codexRuntime) return;

		const cwd = folderPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const isMultiRoot = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1);
		const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;

		const id = this.nextAgentId.current++;
		try {
			const { threadId } = await this.codexRuntime.createAgent(id, cwd, folderName);
			this.persistedAgentsV2 = upsertPersistedCodexAgent(
				this.persistedAgentsV2,
				id,
				threadId,
				folderName,
			);
			await savePersistedAgentsV2(this.context, this.persistedAgentsV2);
		} catch (error) {
			this.nextAgentId.current = Math.max(1, this.nextAgentId.current - 1);
			const detail = error instanceof Error ? error.message : String(error);
			this.codexOutput.appendLine(`[codex] failed to create agent: ${detail}`);
			vscode.window.showErrorMessage(`Pixel Agents: Failed to create Codex agent. ${detail}`);
		}
	}

	private async restoreCodexAgents(): Promise<void> {
		if (!this.codexRuntime) return;
		const codexAgents = this.persistedAgentsV2.filter((entry) => entry.runtime === 'codex' && entry.codex?.threadId);
		for (const entry of codexAgents) {
			this.nextAgentId.current = Math.max(this.nextAgentId.current, entry.id + 1);
			try {
				await this.codexRuntime.restoreAgent(
					entry.id,
					entry.codex!.threadId,
					undefined,
					entry.folderName,
				);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				this.codexOutput.appendLine(
					`[codex] failed to restore thread ${entry.codex?.threadId} for agent ${entry.id}: ${detail}`,
				);
			}
		}
	}

	private sendExistingCodexAgents(): void {
		if (!this.webview) return;
		if (!this.codexRuntime) return;
		const codexAgents = this.codexRuntime.listAgentStates();
		if (codexAgents.length === 0) return;

		const meta = this.context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(
			WORKSPACE_KEY_AGENT_SEATS,
			{},
		);
		const folderNames: Record<number, string> = {};
		for (const agent of codexAgents) {
			if (agent.folderName) {
				folderNames[agent.agentId] = agent.folderName;
			}
		}
		this.webview.postMessage({
			type: 'existingAgents',
			agents: codexAgents.map((agent) => agent.agentId).sort((a, b) => a - b),
			agentMeta: meta,
			folderNames,
		});
	}

	private async syncPersistedAgentsV2FromClaude(): Promise<void> {
		const codexEntries = this.persistedAgentsV2.filter((entry) => entry.runtime === 'codex');
		const claudeEntries: PersistedRuntimeAgentV2[] = [...this.agents.values()].map((agent) => ({
			id: agent.id,
			runtime: 'claude',
			folderName: agent.folderName,
			claude: {
				terminalName: agent.terminalRef.name,
				jsonlFile: agent.jsonlFile,
				projectDir: agent.projectDir,
			},
		}));
		this.persistedAgentsV2 = [...claudeEntries, ...codexEntries].sort((a, b) => a.id - b.id);
		await savePersistedAgentsV2(this.context, this.persistedAgentsV2);
	}

	private loadAssetsAndLayout(): void {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const projectDir = getProjectDirPath();
		console.log('[Extension] workspaceRoot:', workspaceRoot);
		console.log('[Extension] projectDir:', projectDir);

		if ((this.runtimeMode === 'claude' || this.runtimeMode === 'mixed') && projectDir) {
			ensureProjectScan(
				projectDir,
				this.knownJsonlFiles,
				this.projectScanTimer,
				this.activeAgentId,
				this.nextAgentId,
				this.agents,
				this.fileWatchers,
				this.pollingTimers,
				this.waitingTimers,
				this.permissionTimers,
				this.webview,
				() => {
					void this.syncPersistedAgentsV2FromClaude();
				},
			);
		}

		(async () => {
			try {
				console.log('[Extension] Loading furniture assets...');
				const extensionPath = this.extensionUri.fsPath;
				console.log('[Extension] extensionPath:', extensionPath);

				// Check bundled location first: extensionPath/dist/assets/
				const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
				let assetsRoot: string | null = null;
				if (fs.existsSync(bundledAssetsDir)) {
					console.log('[Extension] Found bundled assets at dist/');
					assetsRoot = path.join(extensionPath, 'dist');
				} else if (workspaceRoot) {
					// Fall back to workspace root (development or external assets)
					console.log('[Extension] Trying workspace for assets...');
					assetsRoot = workspaceRoot;
				}

				if (!assetsRoot) {
					console.log('[Extension] ⚠️  No assets directory found');
					if (this.webview) {
						sendLayout(this.context, this.webview, this.defaultLayout);
						this.startLayoutWatcher();
					}
					return;
				}

				console.log('[Extension] Using assetsRoot:', assetsRoot);

				// Load bundled default layout
				this.defaultLayout = loadDefaultLayout(assetsRoot);

				// Load character sprites
				const charSprites = await loadCharacterSprites(assetsRoot);
				if (charSprites && this.webview) {
					console.log('[Extension] Character sprites loaded, sending to webview');
					sendCharacterSpritesToWebview(this.webview, charSprites);
				}

				// Load floor tiles
				const floorTiles = await loadFloorTiles(assetsRoot);
				if (floorTiles && this.webview) {
					console.log('[Extension] Floor tiles loaded, sending to webview');
					sendFloorTilesToWebview(this.webview, floorTiles);
				}

				// Load wall tiles
				const wallTiles = await loadWallTiles(assetsRoot);
				if (wallTiles && this.webview) {
					console.log('[Extension] Wall tiles loaded, sending to webview');
					sendWallTilesToWebview(this.webview, wallTiles);
				}

				const assets = await loadFurnitureAssets(assetsRoot);
				if (assets && this.webview) {
					console.log('[Extension] ✅ Assets loaded, sending to webview');
					sendAssetsToWebview(this.webview, assets);
				}
			} catch (err) {
				console.error('[Extension] ❌ Error loading assets:', err);
			}
			if (this.webview) {
				console.log('[Extension] Sending saved layout');
				sendLayout(this.context, this.webview, this.defaultLayout);
				this.startLayoutWatcher();
			}
		})();
	}

	/** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[Pixel Agents] External layout change — pushing to webview');
			this.webview?.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	dispose() {
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		void this.claudeRuntime.dispose();
		void this.codexRuntime?.dispose();
		if (this.projectScanTimer.current) {
			clearInterval(this.projectScanTimer.current);
			this.projectScanTimer.current = null;
		}
		this.codexOutput.dispose();
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
