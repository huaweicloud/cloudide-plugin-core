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
