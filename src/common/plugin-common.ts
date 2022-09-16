/********************************************************************************
 * Copyright (C) 2022. Huawei Technologies Co., Ltd. All rights reserved.
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
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
     * Supports left ('left'), right('right'), main editing area ('main'), bottom ('bottom').
     */
    targetArea?: string;

    /**
     * Plugin icon displayed on the panel.
     * The icon in svg format can automatically adapt to the theme color.
     */
    iconPath?: { light: string; dark: string } | string;

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
     * extData will be passed to the templateEngine if enabled
     * Getting extra data using 'plugin.cloudidePluginApi.getExtData()' in frontend.
     */
    extData?: any;

    /**
     * Template engine to render the html, if undefined, only pure html is supported.
     * l10n and extData are built-in variables.
     * l10n stores all locialization items of specific locale
     */
    templateEngine?: 'ejs' | 'pug';
}

export enum EventType {
    // events from workspace module
    WORKSPACE_ONDIDCHANGEWORKSPACEFOLDERS = 'codearts.workspace.onDidChangeWorkspaceFolders',
    WORKSPACE_ONDIDOPENTEXTDOCUMENT = 'codearts.workspace.onDidOpenTextDocument',
    WORKSPACE_ONDIDCLOSETEXTDOCUMENT = 'codearts.workspace.onDidCloseTextDocument',
    WORKSPACE_ONDIDCHANGETEXTDOCUMENT = 'codearts.workspace.onDidChangeTextDocument',
    WORKSPACE_ONWILLSAVETEXTDOCUMENT = 'codearts.workspace.onWillSaveTextDocument',
    WORKSPACE_ONDIDSAVETEXTDOCUMENT = 'codearts.workspace.onDidSaveTextDocument',
    WORKSPACE_ONDIDCHANGENOTEBOOKDOCUMENT = 'codearts.workspace.onDidChangeNotebookDocument',
    WORKSPACE_ONDIDSAVENOTEBOOKDOCUMENT = 'codearts.workspace.onDidSaveNotebookDocument',
    WORKSPACE_ONDIDOPENNOTEBOOKDOCUMENT = 'codearts.workspace.onDidOpenNotebookDocument',
    WORKSPACE_ONDIDCLOSENOTEBOOKDOCUMENT = 'codearts.workspace.onDidCloseNotebookDocument',
    WORKSPACE_ONWILLCREATEFILES = 'codearts.workspace.onWillCreateFiles',
    WORKSPACE_ONDIDCREATEFILES = 'codearts.workspace.onDidCreateFiles',
    WORKSPACE_ONWILLDELETEFILES = 'codearts.workspace.onWillDeleteFiles',
    WORKSPACE_ONDIDDELETEFILES = 'codearts.workspace.onDidDeleteFiles',
    WORKSPACE_ONWILLRENAMEFILES = 'codearts.workspace.onWillRenameFiles',
    WORKSPACE_ONDIDRENAMEFILES = 'codearts.workspace.onDidRenameFiles',
    WORKSPACE_ONDIDCHANGECONFIGURATION = 'codearts.workspace.onDidChangeConfiguration',

    // events from debug module
    DEBUG_ONDIDCHANGEACTIVEDEBUGSESSION = 'codearts.debug.onDidChangeActiveDebugSession',
    DEBUG_ONDIDSTARTDEBUGSESSION = 'codearts.debug.onDidStartDebugSession',
    DEBUG_ONDIDRECEIVEDEBUGSESSIONCUSTOMEVENT = 'codearts.debug.onDidReceiveDebugSessionCustomEvent',
    DEBUG_ONDIDTERMINATEDEBUGSESSION = 'codearts.debug.onDidTerminateDebugSession',
    DEBUG_ONDIDCHANGEBREAKPOINTS = 'codearts.debug.onDidChangeBreakpoints',
    // events from languages module
    LANGUAGES_ONDIDCHANGEDIAGNOSTICS = 'codearts.languages.onDidChangeDiagnostics',
    // events from plugins module
    EXTENSIONS_ONDIDCHANGE = 'codearts.extensions.onDidChange',
    // events from tasks module
    TASKS_ONDIDSTARTTASK = 'codearts.tasks.onDidStartTask',
    TASKS_ONDIDENDTASK = 'codearts.tasks.onDidEndTask',
    TASKS_ONDIDSTARTTASKPROCESS = 'codearts.tasks.onDidStartTaskProcess',
    TASKS_ONDIDENDTASKPROCESS = 'codearts.tasks.onDidEndTaskProcess',
    // events from window module
    WINDOW_ONDIDCHANGEACTIVETEXTEDITOR = 'codearts.window.onDidChangeActiveTextEditor',
    WINDOW_ONDIDCHANGEVISIBLETEXTEDITORS = 'codearts.window.onDidChangeVisibleTextEditors',
    WINDOW_ONDIDCHANGETEXTEDITORSELECTION = 'codearts.window.onDidChangeTextEditorSelection',
    WINDOW_ONDIDCHANGETEXTEDITORVISIBLERANGES = 'codearts.window.onDidChangeTextEditorVisibleRanges',
    WINDOW_ONDIDCHANGETEXTEDITOROPTIONS = 'codearts.window.onDidChangeTextEditorOptions',
    WINDOW_ONDIDCHANGETEXTEDITORVIEWCOLUMN = 'codearts.window.onDidChangeTextEditorViewColumn',
    WINDOW_ONDIDCHANGEVISIBLENOTEBOOKEDITORS = 'codearts.window.onDidChangeVisibleNotebookEditors',
    WINDOW_ONDIDCHANGEACTIVENOTEBOOKEDITOR = 'codearts.window.onDidChangeActiveNotebookEditor',
    WINDOW_ONDIDCHANGENOTEBOOKEDITORSELECTION = 'codearts.window.onDidChangeNotebookEditorSelection',
    WINDOW_ONDIDCHANGENOTEBOOKEDITORVISIBLERANGES = 'codearts.window.onDidChangeNotebookEditorVisibleRanges',
    WINDOW_ONDIDCHANGEACTIVETERMINAL = 'codearts.window.onDidChangeActiveTerminal',
    WINDOW_ONDIDOPENTERMINAL = 'codearts.window.onDidOpenTerminal',
    WINDOW_ONDIDCLOSETERMINAL = 'codearts.window.onDidCloseTerminal',
    WINDOW_ONDIDCHANGETERMINALSTATE = 'codearts.window.onDidChangeTerminalState',
    WINDOW_ONDIDCHANGEWINDOWSTATE = 'codearts.window.onDidChangeWindowState'
}
