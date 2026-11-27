"use strict";

const vscode = require("vscode");
const { Router001Controller } = require("./src/controller");

class Router001SidebarProvider {
  /**
   * @param {Router001Controller} controller
   */
  constructor(controller) {
    this.controller = controller;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.controller.context.extensionUri, "media")]
    };
    this.controller.sidebarView = webviewView;
    webviewView.webview.html = this.controller.getWebviewHtml(webviewView.webview, "sidebar");
    this.controller.bindWebviewMessages(webviewView.webview);
    webviewView.onDidDispose(() => {
      if (this.controller.sidebarView === webviewView) {
        this.controller.sidebarView = null;
      }
    });
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const controller = new Router001Controller(context);
  const sidebarProvider = new Router001SidebarProvider(controller);

  controller.collectEditorContext();
  controller.autoSyncEnvironment(true).catch(() => {});

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("001router.chatView", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => controller.scheduleEditorContextPush(60)),
    vscode.window.onDidChangeTextEditorSelection(() => controller.scheduleEditorContextPush(150)),
    vscode.window.tabGroups.onDidChangeTabs(() => controller.scheduleEditorContextPush(100)),
    vscode.languages.onDidChangeDiagnostics(() => controller.scheduleEditorContextPush(350)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(80);
    }),
    vscode.workspace.onDidCreateFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.workspace.onDidDeleteFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.workspace.onDidRenameFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.commands.registerCommand("001router.openPanel", () => controller.openEditorTab()),
    vscode.commands.registerCommand("001router.newChat", () => controller.createNewChat()),
    vscode.commands.registerCommand("001router.syncEnv", async () => {
      await controller.autoSyncEnvironment(false);
      await controller.syncStateToWebviews();
      vscode.window.showInformationMessage(
        `001Router đã đồng bộ (${controller.envSync.ideName} · ${controller.connected ? "Connected" : "Offline"}).`
      );
    }),
    vscode.commands.registerCommand("001router.connect", () => {
      controller.postToAll({ type: "openAuthModal" });
      if (!controller.sidebarView && !controller.editorPanel) {
        controller.openEditorTab();
      }
    }),
    vscode.commands.registerCommand("001router.focus", () => {
      if (controller.editorPanel) {
        controller.editorPanel.reveal(undefined, false);
      } else if (controller.sidebarView) {
        controller.sidebarView.show(false);
      } else {
        vscode.commands.executeCommand("001router.chatView.focus");
      }
      controller.postToAll({ type: "focusInput" });
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
