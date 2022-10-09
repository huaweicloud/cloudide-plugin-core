/* eslint-disable no-unused-vars */
/********************************************************************************
 * Copyright (C) 2022. Huawei Technologies Co., Ltd. All rights reserved.
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cloudide from '@codearts/plugin';
import * as path from 'path';
import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as ejs from 'ejs';
import * as pug from 'pug';
import { v4 as uuid } from 'uuid';
import { IframeLike, exposable, Deferred, expose, call, Messaging } from '@cloudide/messaging';
import { WebviewOptions, EventType, LogLevel } from '../common/plugin-common';
import { CloudIDENlsConfig, nlsConfig, initNlsConfig } from '@cloudide/nls';
import { format } from '@cloudide/nls/lib/common/common';

/**
 * Defines abstract backend class that all backend must extend.
 * A backend is a program that runs within a nodejs environment.
 * Backend expose and receive remote call from other scope.
 */
export abstract class AbstractBackend {
    protected plugin: Plugin;
    protected context: cloudide.ExtensionContext;

    /**
     * When constructed, parameters are plugin objet and plugin context.
     * @param plugin Plugin Object that provides API to call function exposed by other scope
     * @param context Plugin context private to a plugin
     */
    constructor(plugin: Plugin, context: cloudide.ExtensionContext) {
        this.plugin = plugin;
        this.context = context;
    }

    /**
     * Called by Plugin after the backend is constructed.
     * Function call to the backend will wait until init() to be resolved.
     * Do not make remote call in this function.
     */
    abstract init(): Promise<void>;

    /**
     * Called after the returned Promise of init() is resolved.
     * In this function you can call function exposed by fronted.
     * Implementation your business logic in this function.
     */
    abstract run(): void;

    /**
     * Called when plugin stops.
     */
    abstract stop(): void;
}

const beforeUninstallEventType = 'cloudide.plugin.beforeUninstall';

interface IBackendConstructor<T> extends Function {
    new (plugin: Plugin, context: cloudide.ExtensionContext): T;
}

const backendClientIdentifier = 'backend';
Messaging.init(backendClientIdentifier);

/**
 * Defines an object to provide CloudIDE backend API.
 * Plugin is a singleton.
 */
export class Plugin {
    public readonly manifest: any = {};
    private static instance: Plugin;
    readonly context: cloudide.ExtensionContext;
    private _container: Map<string, BaseWebviewContainer>;
    private backends: Map<IBackendConstructor<AbstractBackend>, AbstractBackend>;
    private i18n: CloudIDENlsConfig = nlsConfig;
    private _outputChannel?: cloudide.OutputChannel;

    private constructor(context: cloudide.ExtensionContext, backends?: IBackendConstructor<AbstractBackend>[]) {
        this.context = context;
        const manifestPath = path.join(context.extensionPath, 'package.json');
        // remove duplicates from the backend list
        backends = [...new Set(backends)];
        try {
            if (fs.existsSync(manifestPath)) {
                this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            }
        } catch (e) {
            console.error(e);
        }

        // compatiable with plugin generated with generator of previous version (version < 0.2.3)
        if (!this.i18n.l10n) {
            initNlsConfig(context.extensionPath);
            this.i18n = nlsConfig;
        }

        this._container = new Map();
        this.backends = new Map<IBackendConstructor<AbstractBackend>, AbstractBackend>();
        if (backends && backends.length > 0) {
            this.initApi(this, context, backends);
        }
    }

    private async initApi(
        plugin: Plugin,
        context: cloudide.ExtensionContext,
        backendClasses: IBackendConstructor<AbstractBackend>[]
    ): Promise<void> {
        backendClasses.push(DefaultPluginApiHost);
        backendClasses.forEach((backendClass) => {
            if (!this.backends.get(backendClass)) {
                const backendInstance = new backendClass(plugin, context);
                this.backends.set(backendClass, backendInstance);
            }
        });
        const initPromises = [];
        const iterator = this.backends.values();
        let backendInstance: IteratorResult<AbstractBackend>;
        while (((backendInstance = iterator.next()), !backendInstance.done)) {
            initPromises.push(backendInstance.value.init());
        }
        await Promise.all(initPromises);
        //await plugin.ready();
        this.backends.forEach((backendInstance) => {
            backendInstance.run();
        });
    }

    /**
     * Initialize plugin and backend classes.
     * @param context plugin context private to plugin.
     * @param opts plugin main page options, create a webview panel when plugin start.
     * @param backends all backends that need to be initialized, notice that backends can only be initialized once.
     */
    public static create(
        context: cloudide.ExtensionContext,
        opts?: WebviewOptions,
        backends?: IBackendConstructor<AbstractBackend>[]
    ): Plugin {
        if (Plugin.instance && opts) {
            const webviewPanel = Plugin.instance.container.get(opts.viewType);
            if (webviewPanel && webviewPanel instanceof BaseWebviewPanel && !webviewPanel.disposed) {
                webviewPanel.pluginPanel.reveal(
                    opts.targetArea,
                    webviewPanel.pluginPanel.viewColumn,
                    opts.preserveFocus
                );
            } else {
                Plugin.instance.createWebviewPanel(opts);
            }
            return Plugin.instance;
        }
        this.instance = new Plugin(context, backends);
        if (opts) {
            Plugin.instance.createWebviewPanel(opts);
        }
        return Plugin.instance;
    }

    /**
     * Return the plugin instance
     */
    public static getInstance(): Plugin {
        return Plugin.instance;
    }

    /**
     * create a webview panel with messaging protocol support
     * @param opts create webview by WebviewOptions
     * @returns webviewpanel with messaging support
     */
    public createWebviewPanel(opts: WebviewOptions, override?: boolean): BaseWebviewPanel | undefined {
        if (override) {
            const curWebviewPanel = this.container.get(opts.viewType);
            if (curWebviewPanel && curWebviewPanel instanceof BaseWebviewPanel) {
                curWebviewPanel.pluginPanel.title = opts.title;
                curWebviewPanel.pluginPanel.iconPath = opts.iconPath
                    ? cloudide.Uri.file(
                          path.join(
                              this.context.extensionPath,
                              typeof opts.iconPath === 'object' ? opts.iconPath.light : opts.iconPath
                          )
                      )
                    : undefined;
                curWebviewPanel.pluginPanel.webview.html = curWebviewPanel.renderHtml(
                    opts.viewType,
                    opts.viewUrl,
                    opts.extData
                );
                if (!opts.preserveFocus) {
                    curWebviewPanel.pluginPanel.reveal();
                }
                return curWebviewPanel;
            }
        }
        const newIncomingWebview = new BaseWebviewPanel(this.context, opts);
        Messaging.bind(newIncomingWebview, backendClientIdentifier);
        this.container.set(opts.viewType, newIncomingWebview);
        return newIncomingWebview;
    }

    /**
     * Create dialog that contains a webview with messaging protocol support
     * @param opts dialog options
     * @returns cloudide.Disposable
     */
    public createWebviewViewDialog(opts: WebviewOptions & cloudide.DialogOptions): cloudide.Disposable {
        const provider = new BaseWebviewDialogProvider(this.context, opts);
        Messaging.bind(provider, backendClientIdentifier);
        const dialog = (cloudide.window as any).createWebviewViewDialog(provider, opts);
        this.container.set(opts.viewType, provider);
        provider.onDispose(dialog.dispose.bind(dialog));
        return dialog;
    }

    public dispatchMessage(sourceViewType: string, message: any): void {
        this.container.forEach(async (webviewContainer, viewType) => {
            if (viewType !== sourceViewType) {
                await webviewContainer.pageInitialized.promise;
                webviewContainer.postMessage(message);
            }
        });
    }

    /**
     * Return the backend object initialized by plugin
     * @param backendClass Class definition of the backend
     */
    public getBackend(backendClass: IBackendConstructor<AbstractBackend>): AbstractBackend | undefined {
        return this.backends.get(backendClass);
    }

    /**
     * Return all backends
     */
    public getAllBackends(): Map<IBackendConstructor<AbstractBackend>, AbstractBackend> {
        return this.backends;
    }

    /**
     * Make a function call to frontend.
     * @param identifier remote function with the format of 'viewType::function-id'
     * @param args parameters pass to remote function
     * @returns Promise<any>
     */
    public async call(identifier: string, ...args: any[]): Promise<any> {
        const viewType = identifier.indexOf('::') >= 0 ? identifier.substring(0, identifier.indexOf('::')) : '';
        const viewContainer =
            this._container.size === 1 ? this._container.values().next().value : this._container.get(viewType);
        if (!viewContainer) {
            this.log(LogLevel.ERROR, `target view not exist: ${viewType}`);
            return Promise.reject(`target view not exist: ${viewType}`);
        }
        await viewContainer.pageInitialized.promise;
        const messagingInstance = Messaging.getInstance();
        if (messagingInstance) {
            return messagingInstance.call(identifier, ...args);
        }
        return Promise.resolve();
    }

    /**
     * Log to backend console.
     * @param level log level.
     * @param message log message.
     */
    public log(level: LogLevel, message: string): void {
        // create output channel when log is called
        if (!this._outputChannel) {
            this._outputChannel = cloudide.window.createOutputChannel(this.context.extension.id);
        }

        const currentTime = new Date().toISOString().replace('T', ' ').substr(0, 19);
        const logMessage = `[${level}][${currentTime}]${message}`;
        this._outputChannel.appendLine(logMessage);
    }

    /**
     * Emit event to plugin page
     * @param eventType event type.
     * @param event event object.
     */
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public fireEvent(eventType: string, event: any): void {
        (this.backends.get(DefaultPluginApiHost) as DefaultPluginApiHost).fireTheiaEvent(eventType, event);
    }

    public localize(key: string, ...args: any[]): string {
        const message = this.i18n.l10n[key];
        if (!message) {
            return '';
        }
        return format(message, args);
    }

    revive(panel: cloudide.WebviewPanel, context: cloudide.ExtensionContext, opts: WebviewOptions, state: any): void {
        const webviewContainer = this._container.get(opts.viewType);
        if (webviewContainer && webviewContainer.disposed) {
            if (typeof panel.showOptions === 'object') {
                panel.reveal(panel.showOptions.area, panel.viewColumn, opts.preserveFocus);
            } else {
                panel.reveal(panel.viewColumn, opts.preserveFocus);
            }
        } else {
            // dispose webview if already revealed in case plugin is registered to start on event "*"
            panel.dispose();
        }
    }

    dispose(viewType?: string): void {
        if (viewType) {
            const webviewContainer = this._container.get(viewType);
            if (webviewContainer && !webviewContainer.disposed) {
                webviewContainer.dispose();
            }
            this._container.delete(viewType);
            return;
        }
        this._container.forEach((webviewContainer: BaseWebviewContainer) => {
            webviewContainer.dispose();
            this._container.clear();
        });
    }

    get container(): Map<string, BaseWebviewContainer> {
        return this._container;
    }

    public stop(): void {
        this.backends.forEach((backendInstance) => {
            backendInstance.stop();
        });
        this.dispose();
        this.context.subscriptions.forEach((disposable: any) => {
            disposable.dispose();
        });
    }
}

abstract class BaseWebviewContainer implements IframeLike {
    readonly context: cloudide.ExtensionContext;
    readonly pageInitialized: Deferred<boolean> = new Deferred<boolean>();
    protected i18n: CloudIDENlsConfig = nlsConfig;
    protected _options: WebviewOptions;
    protected _disposed: boolean;
    protected webview?: cloudide.Webview;
    protected messageHandler?: (message: any) => void;
    protected disposedEventHandlers: ((...args: any[]) => void)[] = [];

    constructor(context: cloudide.ExtensionContext, opts: WebviewOptions) {
        this._disposed = false;
        this.context = context;
        this._options = opts;
    }

    get disposed() {
        return this._disposed;
    }

    get options(): WebviewOptions {
        return this._options;
    }

    handleMessage(message: any) {
        // Only handle the message from the hosted page
        if (!message.from || !message.func) {
            return;
        }
        Plugin.getInstance().dispatchMessage(this._options.viewType, message);
        if (this.messageHandler) {
            this.messageHandler(message);
        }
    }

    registerMessageHandler(messageHandler: (message: any) => void): void {
        this.messageHandler = messageHandler;
    }

    postMessage(message: any): void {
        this.webview?.postMessage(message);
    }

    onDispose(disposedEventHandler: (...args: any[]) => void) {
        this.disposedEventHandlers.push(disposedEventHandler);
    }

    public dispose() {
        this._disposed = true;
        // fire event
        if (this.disposedEventHandlers) {
            this.disposedEventHandlers.forEach(async (eventHandler) => {
                eventHandler();
            });
        }
        Plugin.getInstance().dispose(this.options.viewType);
    }

    public renderHtml(viewType: string, webviewUrl: string, extData?: any) {
        if (!this._options || !this.context.extensionPath) {
            return '';
        }
        const extensionPath = this.context.extensionPath;
        let iframeHtmlUri = cloudide.Uri.file(path.join(extensionPath, 'resources/page', 'index.html'))
            .with({ scheme: 'theia-resource' })
            .toString();
        if (webviewUrl.startsWith('local:')) {
            const localEntryPoint = webviewUrl.replace('local:', '');
            const pathPrefix = localEntryPoint.substring(0, localEntryPoint.lastIndexOf('/'));
            const localEntryPath = path.join(extensionPath, localEntryPoint);
            let htmlData = fs.readFileSync(localEntryPath, 'utf8');

            // render template to html
            if (this._options.templateEngine === 'ejs') {
                htmlData = ejs.render(htmlData, { l10n: this.i18n?.l10n, extData });
            } else if (this._options.templateEngine === 'pug') {
                htmlData = pug.render(htmlData, { l10n: this.i18n?.l10n, extData });
            }
            const $ = cheerio.load(htmlData);
            $('head').prepend(`<script>
                const acquireCloudidePluginApi = (function() {
                    let acquired = false;
                    let extData = ${extData ? `JSON.parse(${JSON.stringify(JSON.stringify(extData))})` : undefined};
                    let i18n = ${this.i18n ? `JSON.parse(${JSON.stringify(JSON.stringify(this.i18n))})` : undefined};
                    let extensionPath = '${this.context.extensionPath}';
                    return () => {
                        if (acquired) {
						    throw new Error('An instance of the CloudIDE Plugin API has already been acquired');
                        }
                        acquired = true;
                        return Object.freeze({
                            getViewType: function() {
                                return '${viewType}';
                            },
                            getExtData: function() {
                                return extData;
                            },
                            getI18n: function() {
                                return i18n;
                            },
                            getExtensionPath: function() {
                                return extensionPath;
                            }
                        });
                    };
                })();
            </script>`);
            $('[href], [src]').each((index: any, HtmlElement: any) => {
                const originSrc = $(HtmlElement).attr('src');
                const originHref = $(HtmlElement).attr('href');
                if (originSrc && !originSrc.startsWith('http')) {
                    $(HtmlElement).attr(
                        'src',
                        cloudide.Uri.file(path.join(extensionPath, `${pathPrefix}/${originSrc}`))
                            .with({ scheme: 'theia-resource' })
                            .toString()
                    );
                } else if (originHref && !originHref.startsWith('http')) {
                    $(HtmlElement).attr(
                        'href',
                        cloudide.Uri.file(path.join(extensionPath, `${pathPrefix}/${originHref}`))
                            .with({ scheme: 'theia-resource' })
                            .toString()
                    );
                }
            });

            return $.html();
        } else {
            iframeHtmlUri = webviewUrl;
            webviewUrl = new URL(webviewUrl).origin;
        }
        const nonce = uuid();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                Use a content security policy to only allow loading images from https or from our extension directory,
                scripts that have a specific nonce and only allow unsafe-inline for theme styles.
                <meta http-equiv="Content-Security-Policy" content="default-src 'self'  http://schemastore.azurewebsites.net ${webviewUrl}; style-src 'unsafe-inline';
                img-src theia-resource: https: http: data:; script-src 'nonce-${nonce}' 'self';"> -->
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Huawei cloudide plugin</title>
                <style>
                    iframe {
                        flex-grow: 1;
                        border: none;
                        margin: 0;
                        padding: 0;
                        display: block;
                        overflow: hidden;
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        visibility: visible;
                        background-color: var(--theia-layout-color1);
                    }
                </style>
            </head>
            <body style="background: var(--theia-layout-color1);margin: 0;">
                <iframe src="${iframeHtmlUri}" style="width: 100%; height: 100%;"></iframe>
            </body>
            </html>`;
    }
}

class BaseWebviewDialogProvider extends BaseWebviewContainer {
    constructor(context: cloudide.ExtensionContext, opts: WebviewOptions) {
        super(context, opts);
    }

    resolveWebviewView(
        webviewView: cloudide.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        context: cloudide.WebviewViewResolveContext<unknown>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: cloudide.CancellationToken
    ): void | Thenable<void> {
        this.webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [cloudide.Uri.file(path.join(this.context.extensionPath, 'resources'))]
        };
        webviewView.webview.html = this.renderHtml(
            this._options.viewType,
            this._options.viewUrl,
            this._options.extData
        );
        webviewView.webview.onDidReceiveMessage((message: any) => {
            this.handleMessage(message);
        });
        webviewView.onDidDispose(() => this.dispose());
    }
}

class BaseWebviewPanel extends BaseWebviewContainer {
    readonly pluginPanel: cloudide.WebviewPanel;
    protected messageHandler?: (message: any) => void;
    protected disposedEventHandlers: ((...args: any[]) => void)[] = [];

    constructor(context: cloudide.ExtensionContext, opts: WebviewOptions) {
        super(context, opts);
        // compatiable with plugin generated with generator of previous version (version < 0.2.3)
        if (!this.i18n.l10n) {
            initNlsConfig(context.extensionPath);
            this.i18n = nlsConfig;
        }

        // create default plugin page webview panel
        this.pluginPanel = this.createWebviewPanel(this._options);
        this.webview = this.pluginPanel.webview;
        this.pluginPanel.webview.html = this.renderHtml(
            this._options.viewType,
            this._options.viewUrl,
            this._options.extData
        );
        this.pluginPanel.onDidDispose(() => this.dispose());
        this.pluginPanel.webview.onDidReceiveMessage((message: any) => {
            this.handleMessage(message);
        });
    }

    public createWebviewPanel(opts: WebviewOptions): cloudide.WebviewPanel {
        this._options = opts;

        if (opts.title.startsWith('%') && opts.title.endsWith('%')) {
            const keyOfTitle = opts.title.substring(1, opts.title.length - 1);
            opts.title = this.i18n.l10n[keyOfTitle] || opts.title;
        }
        const codeartsWindowApi = cloudide.window as any;
        const createPanel = codeartsWindowApi.createCloudWebviewPanel || codeartsWindowApi.createLightWebviewPanel;
        const panel = createPanel(
            opts.viewType,
            opts.title,
            {
                area: opts.targetArea || 'main',
                preserveFocus: opts.preserveFocus ? opts.preserveFocus : false,
                iconPath: opts.iconPath
                    ? cloudide.Uri.file(
                          path.join(
                              this.context.extensionPath,
                              typeof opts.iconPath === 'object' ? opts.iconPath.light : opts.iconPath
                          )
                      )
                    : undefined
            },
            {
                enableScripts: true,
                localResourceRoots: [cloudide.Uri.file(path.join(this.context.extensionPath, 'resources'))],
                retainContextWhenHidden: true
            }
        );
        return panel;
    }

    public dispose() {
        super.dispose();
        this.pluginPanel.dispose();
    }
}

/**
 * default plugin backend api exposed to frontend page
 */
@exposable
class DefaultPluginApiHost extends AbstractBackend {
    readonly subscribedEvents: string[] = [];
    readonly supportedEventTypes: Map<string, cloudide.Event<any>> = new Map()
        // events from workspace module
        .set(EventType.WORKSPACE_ONDIDCHANGEWORKSPACEFOLDERS, cloudide.workspace.onDidChangeWorkspaceFolders)
        .set(EventType.WORKSPACE_ONDIDOPENTEXTDOCUMENT, cloudide.workspace.onDidOpenTextDocument)
        .set(EventType.WORKSPACE_ONDIDCLOSETEXTDOCUMENT, cloudide.workspace.onDidCloseTextDocument)
        .set(EventType.WORKSPACE_ONDIDCHANGETEXTDOCUMENT, cloudide.workspace.onDidChangeTextDocument)
        .set(EventType.WORKSPACE_ONWILLSAVETEXTDOCUMENT, cloudide.workspace.onWillSaveTextDocument)
        .set(EventType.WORKSPACE_ONDIDSAVETEXTDOCUMENT, cloudide.workspace.onDidSaveTextDocument)
        .set(EventType.WORKSPACE_ONDIDCHANGENOTEBOOKDOCUMENT, cloudide.workspace.onDidChangeNotebookDocument)
        .set(EventType.WORKSPACE_ONDIDSAVENOTEBOOKDOCUMENT, cloudide.workspace.onDidSaveNotebookDocument)
        .set(EventType.WORKSPACE_ONDIDOPENNOTEBOOKDOCUMENT, cloudide.workspace.onDidOpenNotebookDocument)
        .set(EventType.WORKSPACE_ONDIDCLOSENOTEBOOKDOCUMENT, cloudide.workspace.onDidCloseNotebookDocument)
        .set(EventType.WORKSPACE_ONWILLCREATEFILES, cloudide.workspace.onWillCreateFiles)
        .set(EventType.WORKSPACE_ONDIDCREATEFILES, cloudide.workspace.onDidCreateFiles)
        .set(EventType.WORKSPACE_ONWILLDELETEFILES, cloudide.workspace.onWillDeleteFiles)
        .set(EventType.WORKSPACE_ONDIDDELETEFILES, cloudide.workspace.onDidDeleteFiles)
        .set(EventType.WORKSPACE_ONWILLRENAMEFILES, cloudide.workspace.onWillRenameFiles)
        .set(EventType.WORKSPACE_ONDIDRENAMEFILES, cloudide.workspace.onDidRenameFiles)
        .set(EventType.WORKSPACE_ONDIDCHANGECONFIGURATION, cloudide.workspace.onDidChangeConfiguration)

        // events from debug module
        .set(EventType.DEBUG_ONDIDCHANGEACTIVEDEBUGSESSION, cloudide.debug.onDidChangeActiveDebugSession)
        .set(EventType.DEBUG_ONDIDSTARTDEBUGSESSION, cloudide.debug.onDidStartDebugSession)
        .set(EventType.DEBUG_ONDIDRECEIVEDEBUGSESSIONCUSTOMEVENT, cloudide.debug.onDidReceiveDebugSessionCustomEvent)
        .set(EventType.DEBUG_ONDIDTERMINATEDEBUGSESSION, cloudide.debug.onDidTerminateDebugSession)
        .set(EventType.DEBUG_ONDIDCHANGEBREAKPOINTS, cloudide.debug.onDidChangeBreakpoints)

        // events from languages module
        .set(EventType.LANGUAGES_ONDIDCHANGEDIAGNOSTICS, cloudide.languages.onDidChangeDiagnostics)

        // events from plugins module
        .set(EventType.EXTENSIONS_ONDIDCHANGE, cloudide.extensions.onDidChange)

        // events from tasks module
        .set(EventType.TASKS_ONDIDSTARTTASK, cloudide.tasks.onDidStartTask)
        .set(EventType.TASKS_ONDIDENDTASK, cloudide.tasks.onDidEndTask)
        .set(EventType.TASKS_ONDIDSTARTTASKPROCESS, cloudide.tasks.onDidStartTaskProcess)
        .set(EventType.TASKS_ONDIDENDTASKPROCESS, cloudide.tasks.onDidEndTaskProcess)

        // events from window module
        .set(EventType.WINDOW_ONDIDCHANGEACTIVETEXTEDITOR, cloudide.window.onDidChangeActiveTextEditor)
        .set(EventType.WINDOW_ONDIDCHANGEVISIBLETEXTEDITORS, cloudide.window.onDidChangeVisibleTextEditors)
        .set(EventType.WINDOW_ONDIDCHANGETEXTEDITORSELECTION, cloudide.window.onDidChangeTextEditorSelection)
        .set(EventType.WINDOW_ONDIDCHANGETEXTEDITORVISIBLERANGES, cloudide.window.onDidChangeTextEditorVisibleRanges)
        .set(EventType.WINDOW_ONDIDCHANGETEXTEDITOROPTIONS, cloudide.window.onDidChangeTextEditorOptions)
        .set(EventType.WINDOW_ONDIDCHANGETEXTEDITORVIEWCOLUMN, cloudide.window.onDidChangeTextEditorViewColumn)
        .set(EventType.WINDOW_ONDIDCHANGEVISIBLENOTEBOOKEDITORS, cloudide.window.onDidChangeVisibleNotebookEditors)
        .set(EventType.WINDOW_ONDIDCHANGEACTIVENOTEBOOKEDITOR, cloudide.window.onDidChangeActiveNotebookEditor)
        .set(EventType.WINDOW_ONDIDCHANGENOTEBOOKEDITORSELECTION, cloudide.window.onDidChangeNotebookEditorSelection)
        .set(
            EventType.WINDOW_ONDIDCHANGENOTEBOOKEDITORVISIBLERANGES,
            cloudide.window.onDidChangeNotebookEditorVisibleRanges
        )
        .set(EventType.WINDOW_ONDIDCHANGEACTIVETERMINAL, cloudide.window.onDidChangeActiveTerminal)
        .set(EventType.WINDOW_ONDIDOPENTERMINAL, cloudide.window.onDidOpenTerminal)
        .set(EventType.WINDOW_ONDIDCLOSETERMINAL, cloudide.window.onDidCloseTerminal)
        .set(EventType.WINDOW_ONDIDCHANGETERMINALSTATE, cloudide.window.onDidChangeTerminalState)
        .set(EventType.WINDOW_ONDIDCHANGEWINDOWSTATE, cloudide.window.onDidChangeWindowState);

    private huaweiCommonApi?: any;

    public async init(): Promise<void> {
        // do nothing
    }

    public run(): void {
        this.registerEventListener();
    }

    public stop(): void {
        this.subscribedEvents.length = 0;
    }

    private registerEventListener() {
        this.supportedEventTypes.forEach((onEvent, eventType) => {
            this.context.subscriptions.push(
                onEvent((event: any) => {
                    if (this.subscribedEvents.indexOf(eventType) >= 0) {
                        this.resolveEventPropertiesThenFireEvent(eventType, event);
                    }
                })
            );
        });
    }

    private async resolveEventPropertiesThenFireEvent(eventType: string, event: any) {
        switch (eventType) {
            case EventType.WINDOW_ONDIDOPENTERMINAL:
            case EventType.WINDOW_ONDIDCLOSETERMINAL:
            case EventType.WINDOW_ONDIDCHANGEACTIVETERMINAL: {
                const values = await event.processId;
                this.fireTheiaEvent(eventType, {
                    name: event.name,
                    processId: values,
                    state: event.state,
                    exitStatus: event.exitStatus
                });
                break;
            }
            default:
                this.fireTheiaEvent(eventType, event);
        }
    }

    // get plugin package.json
    @expose('plugin.packageJson')
    public getPackageJson(): any {
        return this.plugin.manifest;
    }

    @expose('plugin.onPageInit')
    public onPageInit(viewType: string, success?: boolean): boolean {
        const viewContainer = Plugin.getInstance().container.get(viewType);
        if (!viewContainer) {
            return false;
        }

        viewContainer.pageInitialized.resolve(!!success);

        return !!success;
    }

    @expose('plugin.createDynamicWebview')
    public createDynamicWebview(opts: WebviewOptions, override?: boolean): boolean {
        if (!Plugin.getInstance().createWebviewPanel(opts, override)) {
            return false;
        }
        return true;
    }

    @expose('plugin.disposeDynamicWebview')
    public disposeDynamicWebview(viewType: string): void {
        Plugin.getInstance().dispose(viewType);
    }

    @expose('plugin.createWebviewPanel')
    public createWebviewPanel(opts: WebviewOptions, override?: boolean): boolean {
        if (!Plugin.getInstance().createWebviewPanel(opts, override)) {
            return false;
        }
        return true;
    }

    @expose('plugin.disposeWebviewContainer')
    public disposeWebviewContainer(viewType: string): void {
        Plugin.getInstance().dispose(viewType);
    }

    @expose('plugin.createWebviewViewDialog')
    public createWebviewViewDialog(opts: WebviewOptions): boolean {
        if (!Plugin.getInstance().createWebviewViewDialog(opts)) {
            return false;
        }
        return true;
    }

    @expose('plugin.api')
    public getTheiaApi(...property: string[]): any {
        const properties = {};
        if (!property || property.length === 0) {
            Object.keys(cloudide).forEach((key) => {
                const value = String((cloudide as any)[key]);
                (properties as any)[key] = {
                    value: value,
                    type: typeof (cloudide as any)[key]
                };
            });
            return properties;
        }
        let currentPro: any;
        property.forEach((pro) => {
            currentPro = (cloudide as any)[pro] ? (cloudide as any)[pro] : undefined;
        });
        if (!currentPro) {
            return undefined;
        }
        const currentProChildren = Object.keys(currentPro);
        if (!currentProChildren) {
            return undefined;
        }
        currentProChildren.forEach((key) => {
            const value = currentPro[key];
            if (typeof value === 'object' || typeof value !== 'function') {
                (properties as any)[key] = {
                    value: String(value),
                    type: typeof value
                };
            } else if (typeof value === 'function') {
                (properties as any)[key] = {
                    value: value.toString(),
                    type: typeof value
                };
            }
        });
        return properties;
    }

    @expose('plugin.getSupportedEventTypes')
    public getSupportedEventTypes(): any {
        const retEventTypes = {};
        this.supportedEventTypes.forEach((value, key) => {
            (retEventTypes as any)[key] = value.toString();
        });
        return retEventTypes;
    }

    @expose('plugin.subscribeEvent')
    public subscribeEvent(eventType: string): void {
        if (this.supportedEventTypes.get(eventType) && this.subscribedEvents.indexOf(eventType) < 0) {
            this.subscribedEvents.push(eventType);
        }
    }

    @expose('plugin.unsubscribeEvent')
    public unsubscribeEvent(eventType: string): void {
        this.subscribedEvents.splice(this.subscribedEvents.indexOf(eventType), 1);
    }

    @expose('plugin.fireEvent')
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public fireEventToPlugins(eventType: string, event: any): void {
        if (this.huaweiCommonApi) {
            this.huaweiCommonApi.fireEvent(eventType, event);
        }
    }

    @expose('codearts')
    public theiaApi(module: string, property: string, ...args: any[]): any {
        if (!module || !property) {
            return Promise.reject('module or property not specified.');
        }
        const theiaModule = (cloudide as any)[module];
        const theiaModuleProp = theiaModule[property];
        if (typeof theiaModuleProp === 'function') {
            return Promise.resolve(theiaModuleProp.apply(theiaModuleProp, args));
        } else {
            return Promise.resolve(theiaModuleProp);
        }
    }

    @expose('plugin.log')
    public log(level: LogLevel, message: string): void {
        Plugin.getInstance().log(level, message);
    }

    @call('plugin.page.onEvent')
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public fireTheiaEvent(type: string, event: any): void {
        // console.log(`firevent: ${type}`);
        if (
            type === beforeUninstallEventType &&
            event &&
            (event.pluginId as string).toLowerCase() ===
                `${this.plugin.manifest?.publisher}.${this.plugin.manifest?.name}`.toLowerCase()
        ) {
            Plugin.getInstance().stop();
        }
    }
}
