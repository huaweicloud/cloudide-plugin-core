/********************************************************************************
 * Copyright (C) 2020. Huawei Technologies Co., Ltd. All rights reserved.
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as cloudide from '@cloudide/plugin';
import * as path from 'path';
import * as fs from "fs";
import * as cheerio from 'cheerio';
import { v4 as uuid } from 'uuid';
import { IframeLike, messaging, exposable, Deferred, expose, call, Messaging } from '@cloudide/messaging';
const packageJson = require('../../package.json');

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
     * Remote page cannot interact with the IDE backend.
     */
    viewUrl: string;

    /**
     * when true, on main area the webview will not take focus, on left and right panel the webview will not be expanded.
     */
    preserveFocus?: boolean;

    /**
     * extra data passed to the view.
     * get extra data using 'plugin.cloudidePluginApi.getExtData()' in frontend.
     */
    extData?: any;

}

export abstract class AbstractBackend {
    protected plugin: Plugin;
    protected context: cloudide.ExtensionContext;
    constructor(plugin: Plugin, context: cloudide.ExtensionContext) {
        this.plugin = plugin;
        this.context = context;
    }
    abstract init(): void;
    abstract run(): void;
    abstract stop(): void;
}

const beforeUninstallEventType = 'cloudide.plugin.beforeUninstall';

interface IBackendConstructor<T> extends Function {
    new(plugin: Plugin, context: cloudide.ExtensionContext): T;
}

export class Plugin {
    private static instance: Plugin;
    readonly pageInitialized: Deferred<boolean> = new Deferred<boolean>();
    private readonly isReady: Deferred<boolean> = new Deferred<boolean>();
    private _container: PluginContainerPanel;
    private _options: WebviewOptions;
    private backends: Map<IBackendConstructor<AbstractBackend>, AbstractBackend>;

    private constructor(pluginContainerPanel: PluginContainerPanel, backends: IBackendConstructor<AbstractBackend>[]) {
        this._container = pluginContainerPanel;
        this._options = pluginContainerPanel.opts;
        this.backends = new Map<IBackendConstructor<AbstractBackend>, AbstractBackend>();
        this.initApi(this, pluginContainerPanel.context, backends);
    }

    private async initApi(plugin: Plugin, context: cloudide.ExtensionContext, backendClasses: IBackendConstructor<AbstractBackend>[]): Promise<void> {
        backendClasses.push(DefaultPluginApiHost);
        backendClasses.forEach(backendClass => {
            if (!this.backends.get(backendClass)) {
                const backendInstance = new backendClass(plugin, context);
                this.backends.set(backendClass, backendInstance);
            }
        });
        this.backends.forEach(backendInstance => {
            backendInstance.init();
        });
        await plugin.ready();
        this.backends.forEach(backendInstance => {
            backendInstance.run();
        });
    }

    public static createOrShow(context: cloudide.ExtensionContext, opts: WebviewOptions, backends: IBackendConstructor<AbstractBackend>[]) {
        if (Plugin.instance && !Plugin.instance.container.isDisposed()) {
            Plugin.instance.container.defaultPluginPanel.reveal(opts.targetArea, Plugin.instance.container.defaultPluginPanel.viewColumn, opts.preserveFocus);
            return Plugin.instance;
        }
        this.instance = new Plugin(new PluginContainerPanel(context, opts), backends);
        return Plugin.instance;
    }

    public static getInstance() {
        return Plugin.instance;
    }

    public async ready() {
        await this.pageInitialized.promise;
        this.call('cloudide.page.onBackendInitialized', true).then(result => {
            if (result) {
                this.isReady.resolve(true);
            } else {
                this.isReady.resolve(false);
            }
        });
        return this.isReady.promise;
    }

    public async call(identifier: string, ...args: any[]) {
        await this.pageInitialized.promise;
        const messagingInstance = Messaging.getInstance();
        if (messagingInstance) {
            return messagingInstance.call(identifier, ...args);
        }
        return Promise.resolve(false);
    }

    public log(level: string, message: string) {
        (this.backends.get(DefaultPluginApiHost) as DefaultPluginApiHost).log(level, message);
    }

    revive(panel: cloudide.WebviewPanel, context: cloudide.ExtensionContext, opts: WebviewOptions, state: any) {
        if (this.container && this.container.isDisposed()) {
            if (typeof panel.showOptions === 'object') {
                panel.reveal(panel.showOptions!.area, panel.viewColumn, opts.preserveFocus);
            } else {
                panel.reveal(panel.viewColumn, opts.preserveFocus);
            }

        } else {
            // dispose webview if already revealed in case plugin is registered to start on event "*"
            panel.dispose();
        }
    }

    dispose() {
        this.container.dispose();
    }

    get container() {
        return this._container;
    }

    get options() {
        return this._options;
    }

    public stop() {
        this.backends.forEach(backendInstance => {
            backendInstance.stop();
        });
        this.dispose();
        this.container.context.subscriptions.forEach(disposable => {
            disposable.dispose();
        });
    }

}

const backendClientIdentifier = 'backend';

/**
 * Plugin Container Panel to host html loaded from plugin
 */
@messaging(backendClientIdentifier)
class PluginContainerPanel implements IframeLike {

    readonly context: cloudide.ExtensionContext;
    readonly defaultPluginPanel: cloudide.WebviewPanel;
    private dispossed: boolean = false;
    private options: WebviewOptions;
    private messageHandler?: ((message: any) => void);
    private disposedEventHandler?: (...args: any[]) => void;
    private revealingDynamicWebview: cloudide.WebviewPanel[] = [];

    constructor(context: cloudide.ExtensionContext, opts: WebviewOptions) {
        this.context = context;
        this.options = opts;
        // create default plugin page webview panel
        this.defaultPluginPanel = this.createWebviewPanel(this.options);
        this.update(this.options.viewType, this.options.viewUrl);
        this.defaultPluginPanel.onDidDispose(() => this.dispose());
        this.defaultPluginPanel.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });
    }

    private handleMessage(message: any) {
        // Only handle the message from the hosted page
        if (!message.from || !message.func) {
            return;
        }
        // may cause performance problem
        this.postMessage(message);

        if (this.messageHandler) {
            this.messageHandler(message);
        }
    }

    private createWebviewPanel(opts: WebviewOptions): cloudide.WebviewPanel {
        this.options = opts;
        const panel = cloudide.window.createCloudWebviewPanel(opts.viewType, opts.title, {
            area: opts.targetArea,
            preserveFocus: opts.preserveFocus ? opts.preserveFocus : false
        }, {
            enableScripts: true,
            localResourceRoots: [
                cloudide.Uri.file(path.join(this.context.extensionPath, 'resources'))
            ],
            retainContextWhenHidden: true
        });
        const lightIconUri = cloudide.Uri.file(path.join(this.context.extensionPath, typeof opts.iconPath === 'object' ? opts.iconPath.light : opts.iconPath));
        const darkIconUri = cloudide.Uri.file(path.join(this.context.extensionPath, typeof opts.iconPath === 'object' ? opts.iconPath.dark : opts.iconPath));
        panel.iconPath = { light: lightIconUri, dark: darkIconUri };
        return panel;
    }

    public isDynamicWebviewPanelRevealing(panel: cloudide.WebviewPanel): boolean {
        return !!this.revealingDynamicWebview.find(panel => panel.viewType === panel.viewType);
    }

    public createDynamicWebviewPanel(opts: WebviewOptions, override?: boolean) {
        // return webview if already revealed
        let dynamicWebviewPanel = this.revealingDynamicWebview.find(panel => panel.viewType === opts.viewType);
        if (dynamicWebviewPanel) {
            if (override) {
                dynamicWebviewPanel.title = opts.title;
                dynamicWebviewPanel.iconPath = opts.iconPath as any;
                dynamicWebviewPanel.webview.html = this.renderHtml(opts.viewType, opts.viewUrl, opts.extData);
            }
            if (!opts.preserveFocus) {
                dynamicWebviewPanel.reveal();
            }

            return dynamicWebviewPanel;
        }

        dynamicWebviewPanel = this.createWebviewPanel(opts);
        dynamicWebviewPanel.webview.html = this.renderHtml(opts.viewType, opts.viewUrl, opts.extData);
        dynamicWebviewPanel.onDidDispose(() => {
            this.revealingDynamicWebview = this.revealingDynamicWebview.filter(panel => {
                return !panel.dispose && panel.viewType !== dynamicWebviewPanel!.viewType;
            });
        });
        dynamicWebviewPanel.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });
        this.revealingDynamicWebview.push(dynamicWebviewPanel);
    }

    public disposeDynamicWebviewPanel(viewType: string) {
        let dynamicWebviewPanel = this.revealingDynamicWebview.find(panel => panel.viewType === viewType);
        if (dynamicWebviewPanel) {
            dynamicWebviewPanel.dispose();
        }
    }

    registerMessageHandler(messageHandler: (message: any) => void): void {
        this.messageHandler = messageHandler;
    }

    postMessage(message: any) {
        this.defaultPluginPanel.webview.postMessage(message);
        this.revealingDynamicWebview.forEach(panel => {
            panel.webview.postMessage(message);
        });
    }

    get opts() {
        return this.options;
    }

    public dispose() {
        this.dispossed = true;
        this.defaultPluginPanel.dispose();

        this.revealingDynamicWebview.forEach(webview => {
            webview.dispose();
        });

        // fire event
        if (this.disposedEventHandler) {
            this.disposedEventHandler();
        }
    }

    onDispose(disposedEventHandler: (...args: any[]) => void) {
        this.disposedEventHandler = disposedEventHandler;
    }

    public isDisposed() {
        return this.dispossed;
    }

    private update(viewType: string, webviewUrl: string, extData?: any) {
        this.defaultPluginPanel.webview.html = this.renderHtml(viewType, webviewUrl);
    }

    private renderHtml(viewType: string, webviewUrl: string, extData?: any) {
        if (!this.defaultPluginPanel || !this.options || !this.context.extensionPath) {
            return '';
        }
        const extensionPath = this.context.extensionPath;
        let iframeHtmlUri = cloudide.Uri.file(path.join(extensionPath, 'resources/page', 'index.html')).with({ scheme: 'theia-resource' }).toString();
        if (webviewUrl.startsWith('local:')) {
            const localEntryPoint = webviewUrl.replace('local:', '');
            const pathPrefix = localEntryPoint.substring(0, localEntryPoint.lastIndexOf('/'));
            const localEntryPath = path.join(extensionPath, localEntryPoint);
            const data = fs.readFileSync(localEntryPath, 'utf8');
            const $ = cheerio.load(data);
            $('head').prepend(`<script>
                const acquireCloudidePluginApi = (function() {
                    let acquired = false;
                    let extData = ${extData ? `JSON.parse(${JSON.stringify(JSON.stringify(extData))})` : undefined};
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
                            }
                        });
                    };
                })();
            </script>`);
            $("[href], [src]").each((index, HtmlElement) => {
                const originSrc = $(HtmlElement).attr('src');
                const originHref = $(HtmlElement).attr('href');
                if (originSrc && !originSrc.startsWith('http')) {
                    $(HtmlElement).attr('src', cloudide.Uri.file(path.join(extensionPath, `${pathPrefix}/${originSrc}`)).with({ scheme: 'theia-resource' }).toString());
                } else if (originHref && !originHref.startsWith('http')) {
                    $(HtmlElement).attr('href', cloudide.Uri.file(path.join(extensionPath, `${pathPrefix}/${originHref}`)).with({ scheme: 'theia-resource' }).toString());
                }
            });

            return $.html();
        } else {
            webviewUrl = new URL(this.options.viewUrl).origin;
            iframeHtmlUri = this.options.viewUrl;
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

/**
 * default plugin backend api exposed to frontend page
 */
@exposable
export class DefaultPluginApiHost extends AbstractBackend {
    readonly subscribedEvents: string[] = [];
    readonly supportedEventTypes: Map<string, cloudide.Event<any>> = new Map()
        // events from workspace module
        .set('theia.workspace.onDidChangeConfiguration', cloudide.workspace.onDidChangeConfiguration)
        .set('theia.workspace.onDidChangeTextDocument', cloudide.workspace.onDidChangeTextDocument)
        .set('theia.workspace.onDidChangeWorkspaceFolders', cloudide.workspace.onDidChangeWorkspaceFolders)
        .set('theia.workspace.onDidCloseTextDocument', cloudide.workspace.onDidCloseTextDocument)
        .set('theia.workspace.onDidOpenTextDocument', cloudide.workspace.onDidOpenTextDocument)
        // .set('theia.workspace.onDidRenameFile', theia.workspace.onDidRenameFile) //removed
        .set('theia.workspace.onDidSaveTextDocument', cloudide.workspace.onDidSaveTextDocument)
        // .set('theia.workspace.onWillRenameFile', theia.workspace.onWillRenameFile) //removed
        .set('theia.workspace.onWillSaveTextDocument', cloudide.workspace.onWillSaveTextDocument)
        // events from debug module
        .set('theia.debug.onDidChangeActiveDebugSession', cloudide.debug.onDidChangeActiveDebugSession)
        .set('theia.debug.onDidChangeBreakpoints', cloudide.debug.onDidChangeBreakpoints)
        .set('theia.debug.onDidReceiveDebugSessionCustomEvent', cloudide.debug.onDidReceiveDebugSessionCustomEvent)
        .set('theia.debug.onDidStartDebugSession', cloudide.debug.onDidStartDebugSession)
        .set('theia.debug.onDidTerminateDebugSession', cloudide.debug.onDidTerminateDebugSession)
        // events from languages module
        .set('theia.languages.onDidChangeDiagnostics', cloudide.languages.onDidChangeDiagnostics)
        // events from plugins module
        .set('theia.plugins.onDidChange', cloudide.extensions.onDidChange)
        // events from tasks module
        .set('theia.tasks.onDidEndTask', cloudide.tasks.onDidEndTask)
        .set('theia.tasks.onDidEndTaskProcess', cloudide.tasks.onDidEndTaskProcess)
        .set('theia.tasks.onDidStartTask', cloudide.tasks.onDidStartTask)
        .set('theia.tasks.onDidStartTaskProcess', cloudide.tasks.onDidStartTaskProcess)
        // events from window module
        .set('theia.window.onDidChangeActiveTerminal', cloudide.window.onDidChangeActiveTerminal)
        .set('theia.window.onDidChangeActiveTextEditor', cloudide.window.onDidChangeActiveTextEditor)
        .set('theia.window.onDidChangeTextEditorOptions', cloudide.window.onDidChangeTextEditorOptions)
        .set('theia.window.onDidChangeTextEditorSelection', cloudide.window.onDidChangeTextEditorSelection)
        .set('theia.window.onDidChangeTextEditorViewColumn', cloudide.window.onDidChangeTextEditorViewColumn)
        .set('theia.window.onDidChangeTextEditorVisibleRanges', cloudide.window.onDidChangeTextEditorVisibleRanges)
        .set('theia.window.onDidChangeVisibleTextEditors', cloudide.window.onDidChangeVisibleTextEditors)
        .set('theia.window.onDidChangeWindowState', cloudide.window.onDidChangeWindowState)
        .set('theia.window.onDidCloseTerminal', cloudide.window.onDidCloseTerminal)
        .set('theia.window.onDidOpenTerminal', cloudide.window.onDidOpenTerminal);

    private huaweiCommonApi?: any;

    public init(): void {

    }

    public run(): void {
        this.registerEventListener();
    }

    public stop(): void {
        this.subscribedEvents.length = 0;
    }

    private registerEventListener() {

        this.supportedEventTypes.forEach((onEvent, eventType) => {
            this.context.subscriptions.push(onEvent(event => {
                if (this.subscribedEvents.indexOf(eventType) >= 0) {
                    this.fireTheiaEvent(eventType, event);
                }
            }));
        });
    }

    // get plugin package.json
    @expose('cloudide.plugin')
    public getPackageJson() {
        return packageJson;
    }

    @expose('cloudide.plugin.onPageInit')
    public onPageInit(success?: boolean): boolean {
        if (!Plugin.getInstance().pageInitialized.isPending) {
            Plugin.getInstance().call('cloudide.page.onBackendInitialized', true).then(result => {
                if (result) {
                    console.log('backend already initialized, renotify plugin frontend success.');
                }
            });
        }

        const huaweiCommon = cloudide.extensions.getExtension('huawei-builtin.huawei-cloudide-common');
        this.huaweiCommonApi = huaweiCommon ? huaweiCommon.exports : this.huaweiCommonApi;

        Plugin.getInstance().pageInitialized.resolve(!!success);

        this.subscribeEvent(beforeUninstallEventType);

        return !!success;
    }

    @expose('cloudide.plugin.createDynamicWebview')
    public createDynamicWebview(opts: WebviewOptions, override?: boolean) {
        Plugin.getInstance().container.createDynamicWebviewPanel(opts, override);
    }

    @expose('cloudide.plugin.disposeDynamicWebview')
    public disposeDynamicWebview(viewType: string) {
        Plugin.getInstance().container.disposeDynamicWebviewPanel(viewType);
    }

    @expose('cloudide.api')
    public getTheiaApi(...property: string[]) {
        const properties = {};
        if (!property || property.length === 0) {

            Object.keys(cloudide).forEach(key => {
                const value = String((cloudide as any)[key]);
                (properties as any)[key] = {
                    value: value,
                    type: typeof (cloudide as any)[key]
                };
            });
            return properties;
        }
        let currentPro: any;
        property.forEach(pro => {
            currentPro = (cloudide as any)[pro] ? (cloudide as any)[pro] : undefined;
        });
        if (!currentPro) {
            return undefined;
        }
        const currentProChildren = Object.keys(currentPro);
        if (!currentProChildren) {
            return undefined;
        }
        currentProChildren.forEach(key => {
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

    @expose('cloudide.plugin.getSupportedEventTypes')
    public getSupportedEventTypes() {
        const retEventTypes = {};
        this.supportedEventTypes.forEach((value, key) => {
            (retEventTypes as any)[key] = value.toString();
        });
        return retEventTypes;
    }

    @expose('cloudide.plugin.subscribeEvent')
    public subscribeEvent(eventType: string) {
        if (this.supportedEventTypes.get(eventType) && this.subscribedEvents.indexOf(eventType) < 0) {
            this.subscribedEvents.push(eventType);
        } else {
            if (this.huaweiCommonApi) {
                this.huaweiCommonApi.onEvent(eventType, (eventType: string, event: any) => {
                    this.fireTheiaEvent(eventType, event);
                });
            }
        }
    }

    @expose('cloudide.plugin.unsubscribeEvent')
    public unsubscribeEvent(eventType: string) {
        this.subscribedEvents.splice(this.subscribedEvents.indexOf(eventType), 1);
    }

    @expose('cloudide.plugin.fireEvent')
    public fireEventToPlugins(eventType: string, event: any) {
        if (this.huaweiCommonApi) {
            this.huaweiCommonApi.fireEvent(eventType, event);
        }
    }

    @expose('cloudide.plugin.getExtensionPath')
    public getExtensionPath() {
        return Plugin.getInstance().container.context.extensionPath;
    }

    @expose('theia')
    public theiaWindowApi(module: string, property: string, ...args: any[]) {
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

    @expose('cloudide.log')
    public log(level: string, message: string) {
        const currentTime = new Date().toISOString().replace('T', ' ').substr(0, 19);
        console.log(`[${level}][${currentTime}][plugin][${Plugin.getInstance().options.viewType}] ${message}`);
    }

    @call('cloudide.page.onEvent')
    public fireTheiaEvent(type: string, event: any) {
        // console.log(`firevent: ${type}`);
        if (type === beforeUninstallEventType && event && (event.pluginId as string).toLowerCase() === `${packageJson.publisher}.${packageJson.name}`.toLowerCase()) {
            Plugin.getInstance().stop();
        }
    }

}
