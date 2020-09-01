/********************************************************************************
 * Copyright (C) 2020. Huawei Technologies Co., Ltd. All rights reserved.
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
declare let acquireVsCodeApi: any;
declare let acquireCloudidePluginApi: any;
import { Deferred, IframeLike, exposable, expose, messaging, Messaging } from '@cloudide/messaging';
import { WebviewOptions, LogLevel } from '../common/plugin-common';

/**
 * Default API declaration of plugin page
 */
interface CloudidePluginApi {
    getViewType: () => any;
    getExtData: () => any;
}

const cloudidePluginApi: CloudidePluginApi = acquireCloudidePluginApi();

/**
 * Defines abstract frontend class that all frontend must extend.
 * A frontend is a program that runs within a web browser.
 * Frontend expose and receive remote call from other scope.
 */
export abstract class AbstractFrontend {
    protected plugin: PluginPage;

    /**
     * When constructed, parameter 'plugin' is the PluginPage object.
     * @param plugin plugin page that provide CloudIDE api
     */
    constructor(plugin: PluginPage) {
        this.plugin = plugin;
    }

    /**
     * Called by PluginPage after the frontend is constructed.
     * Function call to the frontend will wait until init() to be resolved.
     * Do not make remote call in this function.
     */
    abstract async init(): Promise<void>;

    /**
     * Called after the returned Promise of init() is resolved.
     * In this function you can call function exposed by backend or other scope.
     * Implementation your front logic in this function.
     */
    abstract run(): void;

    /**
     * Called before plugin stops.
     */
    abstract stop(): void;
}

interface IFrontendConstructor<T> extends Function {
    new (plugin: PluginPage): T;
}

const backendClientIdentifier = 'backend';

/**
 * Defines an object to provide CloudIDE API.
 * PluginPage is a singleton in a webview page.
 */
export class PluginPage {
    private static instance: PluginPage;
    public readonly backendInitialized: Deferred<boolean> = new Deferred<boolean>();
    public readonly cloudidePluginApi: CloudidePluginApi;
    private readonly domInitialized: Deferred<boolean> = new Deferred<boolean>();
    private readonly isReady: Deferred<boolean> = new Deferred<boolean>();
    private pluginPageContext: PluginPageContext;
    private registeredEventHandlers: Map<string, ((eventType: string, event: any) => void)[]> = new Map();
    private extensionPath?: string;
    private frontends: Map<IFrontendConstructor<AbstractFrontend>, AbstractFrontend> = new Map();
    private constructor(pluginPageContext: PluginPageContext, frontends: IFrontendConstructor<AbstractFrontend>[]) {
        this.pluginPageContext = pluginPageContext;
        this.cloudidePluginApi = cloudidePluginApi;
        const doc = this.pluginPageContext.window.document;
        doc.addEventListener('keydown', (event: KeyboardEvent) => {
            switch (event.keyCode) {
                case 112:
                case 116:
                    event.preventDefault();
                    break;
            }
        });
        if (doc.readyState === 'loading') {
            doc.addEventListener('DOMContentLoaded', () => {
                this.domInitialized.resolve(true);
            });
        } else {
            this.domInitialized.resolve(true);
        }

        this.initApi(this, frontends);
    }

    /**
     * Notify backend that webview page is loaded and all frontend classes have been initialized.
     */
    private async ready(): Promise<boolean> {
        const domInitialized = await this.domInitialized.promise;
        if (domInitialized) {
            this.syncInitializedStatus();
        }
        return this.isReady.promise;
    }

    private async syncInitializedStatus() {
        this._call('plugin.onPageInit', true)
            .then((value) => {
                this.isReady.resolve(value);
            })
            .catch((err) => {
                console.error(err);
                this.isReady.resolve(false);
            });
    }

    private async _call(func: string, ...args: any[]): Promise<any> {
        const messageInstance = Messaging.getInstance();
        if (!messageInstance) {
            return false;
        }
        func = func.indexOf('::') >= 0 ? func : `${backendClientIdentifier}::${func}`;
        return messageInstance.call(func, ...args);
    }

    private async initApi(plugin: PluginPage, frontends: IFrontendConstructor<AbstractFrontend>[]) {
        frontends.push(DefaultPageApi);
        frontends.forEach((frontendClass) => {
            if (!this.frontends.get(frontendClass)) {
                const frontendInstance = new frontendClass(plugin);
                this.frontends.set(frontendClass, frontendInstance);
            }
        });
        const initPromises = [];
        const iterator = this.frontends.values();
        let frontendInstance: IteratorResult<AbstractFrontend>;
        while (((frontendInstance = iterator.next()), !frontendInstance.done)) {
            initPromises.push(frontendInstance.value.init());
        }
        await Promise.all(initPromises);
        await this.ready();
        this.pluginPageContext.window.document.addEventListener('mousemove', () => {
            this.fireEventToPlugins('plugin.activity.occur', undefined);
        });
        this.pluginPageContext.window.document.addEventListener('keypress', () => {
            this.fireEventToPlugins('plugin.activity.occur', undefined);
        });
        this.frontends.forEach((frontendInstance) => {
            frontendInstance.run();
        });
    }

    /**
     * Initialize plugin page API and frontend classes
     * @param frontends All frontend classes that need to be created.
     */
    public static create(frontends: IFrontendConstructor<AbstractFrontend>[]): void {
        if (this.instance && this.instance.pluginPageContext) {
            return;
        }
        this.instance = new PluginPage(new PluginPageContext(window), frontends);
    }

    /**
     * Return plugin page API object
     */
    public static getInstance(): PluginPage {
        return this.instance;
    }

    /**
     * Return frontend object initialized by plugin
     * @param frontendClass Class definition of front class
     */
    public getFrontend(frontendClass: IFrontendConstructor<AbstractFrontend>): AbstractFrontend | undefined {
        return this.frontends.get(frontendClass);
    }

    /**
     * Return all frontends
     */
    public getAllFrontend(): Map<IFrontendConstructor<AbstractFrontend>, AbstractFrontend> {
        return this.frontends;
    }

    /**
     * pass events to registeredEventHandlers
     * @param eventType unique type of event
     * @param event event object
     */
    public onEvent(eventType: string, event: any): void {
        const eventHandlers = this.registeredEventHandlers.get(eventType);
        if (eventHandlers) {
            eventHandlers.forEach((eventHandler) => {
                eventHandler(eventType, event);
            });
        }
    }

    /**
     * broadcast event to plugins
     * @param eventType unique type of event
     * @param event event object
     */
    public async fireEventToPlugins(eventType: string, event: any): Promise<void> {
        this.call('plugin.fireEvent', eventType, event);
    }

    /**
     * call remote function exposed on backend
     * @param func function name of remote function
     * @param args arguments passed to remote function
     * @returns Promise<any>
     */
    public async call(func: any, ...args: any[]): Promise<any> {
        await this.backendInitialized.promise;
        let funcName = func as string;
        if (typeof func !== 'string') {
            funcName = func.name as string;
        }
        if (funcName.startsWith('theia') || funcName.startsWith('cloudide')) {
            const funcCallArry = funcName.split('.');
            const argsForTheia = funcCallArry.slice(1);
            argsForTheia.push(...args);
            return this._call('cloudide', ...argsForTheia);
        }
        return this._call(funcName, ...args);
    }

    /**
     * subscribe to event fired from backend plugin
     * @param eventType unique type of event
     * @param eventHandler callback function to execute when event fired
     */
    public async subscribeEvent(
        eventType: string,
        eventHandler: (eventType: string, event: any) => void
    ): Promise<void> {
        await this.call('plugin.subscribeEvent', eventType);
        const eventHandlers = this.registeredEventHandlers.get(eventType);
        if (eventHandlers) {
            eventHandlers.push(eventHandler);
        } else {
            const handlers = [eventHandler];
            this.registeredEventHandlers.set(eventType, handlers);
        }
    }

    /**
     * cancel event subscription
     * @param eventType unique type of event
     * @param eventHandler callback function registered
     */
    public async unsubscribeEvent(
        eventType: string,
        eventHandler: (eventType: string, event: any) => void
    ): Promise<void> {
        await this.call('plugin.unsubscribeEvent', eventType);
        const eventHandlers = this.registeredEventHandlers.get(eventType);
        if (eventHandlers) {
            eventHandlers.splice(eventHandlers.indexOf(eventHandler), 1);
        }
    }

    /**
     * cancel all event subscription
     * @param eventType unique type of event
     * @param eventHandler callback function registered
     */
    public async unsubscribeAllEvents(): Promise<void> {
        for (const eventType of this.registeredEventHandlers.keys()) {
            await this.call('plugin.unsubscribeEvent', eventType);
        }
        this.registeredEventHandlers.clear();
    }

    /**
     * log to backend
     * @param level log level
     * @param message log message
     */
    public async log(level: LogLevel, message: string): Promise<void> {
        this.call('plugin.log', level.valueOf(), message);
    }

    /**
     * convert local resource path to webview path
     * @param path relative path to the plugin root directory
     */
    public async toWebviewResource(path: string): Promise<string> {
        if (!this.extensionPath) {
            this.extensionPath = await this.call('plugin.getExtensionPath');
        }
        return `theia-resource/file${this.extensionPath}/${path}`.split(/\/+/).join('/');
    }

    /**
     * create webview on the IDE workbench
     * @param opts options to configure the dynamic webview
     * @param override replace the dynamic webview with the same viewType
     */
    public async createDynamicWebview(opts: WebviewOptions, override?: boolean): Promise<void> {
        return this.call('plugin.createDynamicWebview', opts, override);
    }

    /**
     * dispose webview with specific viewType
     * @param viewType view type of the dynamic webview
     */
    public async disposeDynamicWebview(viewType: string): Promise<void> {
        return this.call('plugin.disposeDynamicWebview', viewType);
    }

    /**
     * execute command registered to IDE
     * @param id command id
     */
    public async executeCommand(id: string, ...args: any[]): Promise<any> {
        return this.call('cloudide.commands.executeCommand', id, ...args);
    }
}

/**
 * Defines a set of methods that used to communicate between PluginPage and other scope.
 */
@messaging(cloudidePluginApi.getViewType())
class PluginPageContext implements IframeLike {
    readonly window: Window;
    private handleMessage?: (message: any) => void;
    private disposedEventHandler?: (...args: any[]) => void;
    readonly initialized: Deferred<boolean> = new Deferred<boolean>();
    private vscodeApi: {
        postMessage: (msg: any) => any;
        setState: (newState: any) => any;
        getState: () => any;
    };

    constructor(window: Window) {
        this.window = window;
        this.window.onunload = (evt: Event) => {
            if (this.disposedEventHandler) {
                this.disposedEventHandler(evt);
            }
        };

        this.vscodeApi = acquireVsCodeApi();
    }

    onDispose(disposedEventHandler: (...args: any[]) => void) {
        this.disposedEventHandler = disposedEventHandler;
    }

    registerMessageHandler(handleMessage: (message: any) => void): void {
        this.handleMessage = handleMessage;
        const handlePluginMessage = this.handleMessage;
        this.window.addEventListener('message', (event) => {
            handlePluginMessage(event.data);
        });
    }

    postMessage(message: any) {
        if (this.vscodeApi) {
            this.vscodeApi.postMessage(message);
        } else {
            this.window.parent.postMessage(message, '*');
        }
    }
}

/**
 * Provides Default CloudIDE API.
 */
@exposable
class DefaultPageApi extends AbstractFrontend {
    async init(): Promise<void> {
        // do nothing
    }

    run(): void {
        // do nothing
    }

    stop(): void {
        // do nothing
    }

    @expose('cloudide.page.onBackendInitialized')
    public onBackendInitialized(result: boolean) {
        this.plugin.backendInitialized.resolve(result);
        return result;
    }

    @expose('plugin.page.onEvent')
    public onEvent(eventType: string, event: any) {
        this.plugin.onEvent(eventType, event);
    }
}
