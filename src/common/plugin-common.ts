/********************************************************************************
 * Copyright (C) 2020. Huawei Technologies Co., Ltd. All rights reserved.
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

export enum LogLevel {
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR'
}

export interface WebviewOptions {
    /**
     * The unique type identifier of the plugin view, which is determined by yourself.
     */
    viewType: string;

    /**
     * The title of the plugin page, which is displayed at the very top of the plugin.
     */
    title: string;

    /**
     * The default view area of the plugin view.
     * Supports left ('left'), right'right', main editing area ('main'), bottom ('bottom').
     */
    targetArea: string;

    /**
     * Plugin icon displayed on the panel.
     * The icon in svg format can automatically adapt to the theme color.
     */
    iconPath: { light: string; dark: string } | string;

    /**
     * The path of the page to be displayed.
     * Local page resources are placed under "resources" by default, and starting with "local:".
     * Remote page cannot interact with the plugin backend.
     */
    viewUrl: string;

    /**
     * when true, on main area the webview will not take focus, on left and right panel the webview will not be expanded.
     */
    preserveFocus?: boolean;

    /**
     * Extra data passed to the view.
     * Getting extra data using 'plugin.cloudidePluginApi.getExtData()' in frontend.
     */
    extData?: any;
}

export enum EventType {
    // events from workspace module
    CLOUDIDE_WORKSPACE_ONDIDCHANGECONFIGURATION = 'cloudide.workspace.onDidChangeConfiguration',
    CLOUDIDE_WORKSPACE_ONDIDCHANGETEXTDOCUMENT = 'cloudide.workspace.onDidChangeTextDocument',
    CLOUDIDE_WORKSPACE_ONDIDCHANGEWORKSPACEFOLDERS = 'cloudide.workspace.onDidChangeWorkspaceFolders',
    CLOUDIDE_WORKSPACE_ONDIDCLOSETEXTDOCUMENT = 'cloudide.workspace.onDidCloseTextDocument',
    CLOUDIDE_WORKSPACE_ONDIDCREATEFILES = 'cloudide.workspace.onDidCreateFiles',
    CLOUDIDE_WORKSPACE_ONDIDDELETEFILES = 'cloudide.workspace.onDidDeleteFiles',
    CLOUDIDE_WORKSPACE_ONDIDOPENTEXTDOCUMENT = 'cloudide.workspace.onDidOpenTextDocument',
    CLOUDIDE_WORKSPACE_ONDIDRENAMEFILES = 'cloudide.workspace.onDidRenameFiles',
    CLOUDIDE_WORKSPACE_ONDIDSAVETEXTDOCUMENT = 'cloudide.workspace.onDidSaveTextDocument',
    CLOUDIDE_WORKSPACE_ONWILLCREATEFILES = 'cloudide.workspace.onWillCreateFiles',
    CLOUDIDE_WORKSPACE_ONWILLDELETEFILES = 'cloudide.workspace.onWillDeleteFiles',
    CLOUDIDE_WORKSPACE_ONWILLRENAMEFILES = 'cloudide.workspace.onWillRenameFiles',
    CLOUDIDE_WORKSPACE_ONWILLSAVETEXTDOCUMENT = 'cloudide.workspace.onWillSaveTextDocument',
    // events from debug module
    CLOUDIDE_DEBUG_ONDIDCHANGEACTIVEDEBUGSESSION = 'cloudide.debug.onDidChangeActiveDebugSession',
    CLOUDIDE_DEBUG_ONDIDCHANGEBREAKPOINTS = 'cloudide.debug.onDidChangeBreakpoints',
    CLOUDIDE_DEBUG_ONDIDRECEIVEDEBUGSESSIONCUSTOMEVENT = 'cloudide.debug.onDidReceiveDebugSessionCustomEvent',
    CLOUDIDE_DEBUG_ONDIDSTARTDEBUGSESSION = 'cloudide.debug.onDidStartDebugSession',
    CLOUDIDE_DEBUG_ONDIDTERMINATEDEBUGSESSION = 'cloudide.debug.onDidTerminateDebugSession',
    // events from languages module
    CLOUDIDE_LANGUAGES_ONDIDCHANGEDIAGNOSTICS = 'cloudide.languages.onDidChangeDiagnostics',
    // events from plugins module
    CLOUDIDE_EXTENSIONS_ONDIDCHANGE = 'cloudide.plugins.onDidChange',
    // events from tasks module
    CLOUDIDE_TASKS_ONDIDENDTASK = 'cloudide.tasks.onDidEndTask',
    CLOUDIDE_TASKS_ONDIDENDTASKPROCESS = 'cloudide.tasks.onDidEndTaskProcess',
    CLOUDIDE_TASKS_ONDIDSTARTTASK = 'cloudide.tasks.onDidStartTask',
    CLOUDIDE_TASKS_ONDIDSTARTTASKPROCESS = 'cloudide.tasks.onDidStartTaskProcess',
    // events from window module
    CLOUDIDE_WINDOW_ONDIDCHANGEACTIVETERMINAL = 'cloudide.window.onDidChangeActiveTerminal',
    CLOUDIDE_WINDOW_ONDIDCHANGEACTIVETEXTEDITOR = 'cloudide.window.onDidChangeActiveTextEditor',
    CLOUDIDE_WINDOW_ONDIDCHANGETEXTEDITOROPTIONS = 'cloudide.window.onDidChangeTextEditorOptions',
    CLOUDIDE_WINDOW_ONDIDCHANGETEXTEDITORSELECTION = 'cloudide.window.onDidChangeTextEditorSelection',
    CLOUDIDE_WINDOW_ONDIDCHANGETEXTEDITORVIEWCOLUMN = 'cloudide.window.onDidChangeTextEditorViewColumn',
    CLOUDIDE_WINDOW_ONDIDCHANGETEXTEDITORVISIBLERANGES = 'cloudide.window.onDidChangeTextEditorVisibleRanges',
    CLOUDIDE_WINDOW_ONDIDCHANGEVISIBLETEXTEDITORS = 'cloudide.window.onDidChangeVisibleTextEditors',
    CLOUDIDE_WINDOW_ONDIDCHANGEWINDOWSTATE = 'cloudide.window.onDidChangeWindowState',
    CLOUDIDE_WINDOW_ONDIDCLOSETERMINAL = 'cloudide.window.onDidCloseTerminal',
    CLOUDIDE_WINDOW_ONDIDOPENTERMINAL = 'cloudide.window.onDidOpenTerminal'
}
