const { Plugin, ItemView, PluginSettingTab, Setting, Notice, addIcon } = require("obsidian");
const { exec, execFile } = require("child_process");
const path = require("path");
const os = require("os");
const net = require("net");

const VIEW_TYPE_BB = "bb-ai-agent-view";
const BB_ICON_ID = "bb-logo";
const BB_BUNDLE_ID = "dev.bb.desktop";
const BB_DB_PATH = path.join(os.homedir(), ".bb", "bb.db");
const PERMISSION_MODES = ["full", "auto", "accept-edits"];

const BB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="4" y2="19"></line><circle cx="8" cy="14.5" r="4"></circle><line x1="15" y1="4" x2="15" y2="19"></line><circle cx="19" cy="14.5" r="4"></circle></svg>`;

addIcon(BB_ICON_ID, BB_ICON_SVG);

const DEFAULT_SETTINGS = {
	url: "http://localhost:38886",
	autoLaunch: true,
	autoSetDefaults: true,
	defaultProvider: "claude-code",
	defaultModel: "claude-sonnet-5",
	defaultPermissionMode: "full",
	zoomFactor: 1,
	openLocation: "tab",
	alwaysNewTab: true,
};

const OPEN_LOCATIONS = [
	{ value: "tab", label: "Main area (tab)" },
	{ value: "right", label: "Right sidebar" },
	{ value: "left", label: "Left sidebar" },
];

function sqlEscape(value) {
	return String(value).replace(/'/g, "''");
}

class BBView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_BB;
	}

	getDisplayText() {
		return "bb";
	}

	getIcon() {
		return BB_ICON_ID;
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("bb-view-container");

		const webview = document.createElement("webview");
		webview.setAttribute("src", this.plugin.settings.url);
		webview.setAttribute("allowpopups", "true");
		webview.addClass("bb-webview");
		webview.addEventListener("dom-ready", () => {
			this.applyZoom();
		});
		container.appendChild(webview);
		this.webview = webview;
	}

	async onClose() {}

	reload() {
		if (this.webview) {
			this.webview.setAttribute("src", this.plugin.settings.url);
		}
	}

	applyZoom() {
		if (this.webview && this.webview.setZoomFactor) {
			this.webview.setZoomFactor(this.plugin.settings.zoomFactor || 1);
		}
	}
}

class BBSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "bb - AI agentic IDE" });

		new Setting(containerEl)
			.setName("bb URL")
			.setDesc("Local address of the bb desktop app's web interface")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:38886")
					.setValue(this.plugin.settings.url)
					.onChange(async (value) => {
						this.plugin.settings.url = value.trim() || DEFAULT_SETTINGS.url;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-launch bb.app")
			.setDesc("If the bb server isn't responding, launch bb.app in the background without opening or focusing its window")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoLaunch).onChange(async (value) => {
					this.plugin.settings.autoLaunch = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Set project defaults on open")
			.setDesc("When the bb tab opens, set provider/model/permission mode for the bb project matching this vault (only if that project already exists in bb)")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSetDefaults).onChange(async (value) => {
					this.plugin.settings.autoSetDefaults = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Always open a new tab")
			.setDesc("If off, clicking the bb icon/command reuses and reloads the existing bb tab instead of opening a new one")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.alwaysNewTab).onChange(async (value) => {
					this.plugin.settings.alwaysNewTab = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Where to open the bb tab")
			.addDropdown((dropdown) => {
				OPEN_LOCATIONS.forEach((loc) => dropdown.addOption(loc.value, loc.label));
				dropdown.setValue(this.plugin.settings.openLocation).onChange(async (value) => {
					this.plugin.settings.openLocation = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("provider_id, e.g. claude-code or codex")
			.addText((text) =>
				text
					.setPlaceholder("claude-code")
					.setValue(this.plugin.settings.defaultProvider)
					.onChange(async (value) => {
						this.plugin.settings.defaultProvider = value.trim() || DEFAULT_SETTINGS.defaultProvider;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("E.g. claude-sonnet-5, claude-opus-5, claude-haiku-4-5, gpt-5.6-sol")
			.addText((text) =>
				text
					.setPlaceholder("claude-sonnet-5")
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value.trim() || DEFAULT_SETTINGS.defaultModel;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Permission mode")
			.addDropdown((dropdown) => {
				PERMISSION_MODES.forEach((mode) => dropdown.addOption(mode, mode));
				dropdown.setValue(this.plugin.settings.defaultPermissionMode).onChange(async (value) => {
					this.plugin.settings.defaultPermissionMode = value;
					await this.plugin.saveSettings();
				});
			});

		const zoomSetting = new Setting(containerEl)
			.setName("Font size (zoom)")
			.setDesc(`${Math.round(this.plugin.settings.zoomFactor * 100)}%`);

		zoomSetting.addSlider((slider) => {
			slider
				.setLimits(0.5, 2, 0.1)
				.setValue(this.plugin.settings.zoomFactor)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.zoomFactor = value;
					await this.plugin.saveSettings();
					this.plugin.applyZoomToAllViews();
					zoomSetting.setDesc(`${Math.round(value * 100)}%`);
				});
		});
	}
}

module.exports = class BBPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_BB, (leaf) => new BBView(leaf, this));

		this.addRibbonIcon(BB_ICON_ID, "Open bb", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-bb",
			name: "Open bb",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new BBSettingTab(this.app, this));
	}

	onunload() {}

	async activateView() {
		if (this.settings.autoLaunch) {
			this.ensureBbRunning();
		}

		if (this.settings.autoSetDefaults) {
			this.ensureBbDefaults();
		}

		const { workspace } = this.app;
		let leaf = this.settings.alwaysNewTab ? null : workspace.getLeavesOfType(VIEW_TYPE_BB)[0];

		if (!leaf) {
			leaf = this.getTargetLeaf(workspace);
			await leaf.setViewState({ type: VIEW_TYPE_BB, active: true });
		} else {
			const view = leaf.view;
			if (view && view.reload) view.reload();
		}

		workspace.revealLeaf(leaf);
	}

	getTargetLeaf(workspace) {
		if (this.settings.openLocation === "right") {
			return workspace.getRightLeaf(false);
		}
		if (this.settings.openLocation === "left") {
			return workspace.getLeftLeaf(false);
		}
		return workspace.getLeaf("tab");
	}

	applyZoomToAllViews() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_BB).forEach((leaf) => {
			if (leaf.view && leaf.view.applyZoom) leaf.view.applyZoom();
		});
	}

	ensureBbRunning() {
		const socket = net.createConnection({ host: "127.0.0.1", port: this.getPort(), timeout: 500 });

		const cleanup = () => {
			socket.removeAllListeners();
			socket.destroy();
		};

		socket.on("connect", () => {
			cleanup();
		});

		socket.on("timeout", () => {
			cleanup();
			this.launchBbInBackground();
		});

		socket.on("error", () => {
			cleanup();
			this.launchBbInBackground();
		});
	}

	getPort() {
		const match = String(this.settings.url).match(/:(\d+)/);
		return match ? Number(match[1]) : 38886;
	}

	launchBbInBackground() {
		exec(`open -g -b ${BB_BUNDLE_ID}`, (error) => {
			if (error) {
				this.notifyNotInstalled();
			}
		});
	}

	notifyNotInstalled() {
		const installCmd = "npx bb-app@latest";
		const fragment = document.createDocumentFragment();
		fragment.appendText("bb not found — install it by running ");
		const code = fragment.createEl("code", {
			text: installCmd,
			attr: { title: "Click to copy" },
		});
		code.style.cursor = "pointer";
		code.style.textDecoration = "underline dotted";
		code.addEventListener("click", (event) => {
			event.stopPropagation();
			navigator.clipboard.writeText(installCmd).then(() => {
				new Notice("Command copied to clipboard");
			});
		});
		fragment.appendText(" in your terminal, then reopen the bb tab.");
		new Notice(fragment, 10000);
	}

	ensureBbDefaults() {
		const adapter = this.app.vault.adapter;
		const vaultPath = adapter && adapter.getBasePath ? adapter.getBasePath() : null;
		if (!vaultPath) return;

		const sqliteArgs = ["-batch", "-cmd", ".timeout 3000", BB_DB_PATH];
		const findSql = `SELECT project_id FROM project_sources WHERE path = '${sqlEscape(vaultPath)}' LIMIT 1;`;

		execFile("sqlite3", [...sqliteArgs, findSql], (err, stdout) => {
			if (err) return;
			const projectId = String(stdout).trim();
			if (!projectId) return;

			const now = Date.now();
			const provider = sqlEscape(this.settings.defaultProvider || DEFAULT_SETTINGS.defaultProvider);
			const model = sqlEscape(this.settings.defaultModel || DEFAULT_SETTINGS.defaultModel);
			const permissionMode = sqlEscape(this.settings.defaultPermissionMode || DEFAULT_SETTINGS.defaultPermissionMode);
			const upsertSql = `INSERT INTO project_execution_defaults (project_id, provider_id, model, service_tier, reasoning_level, permission_mode, updated_at)
VALUES ('${sqlEscape(projectId)}', '${provider}', '${model}', 'default', 'medium', '${permissionMode}', ${now})
ON CONFLICT(project_id) DO UPDATE SET
	provider_id = excluded.provider_id,
	model = excluded.model,
	permission_mode = excluded.permission_mode,
	updated_at = excluded.updated_at;`;

			execFile("sqlite3", [...sqliteArgs, upsertSql], (err2) => {
				if (err2) {
					new Notice("bb: failed to set default provider/model");
				}
			});
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
};
