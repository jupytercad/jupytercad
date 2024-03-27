import { PageConfig, URLExt } from '@jupyterlab/coreutils';
(window as any).__webpack_public_path__ = URLExt.join(
  PageConfig.getBaseUrl(),
  'cad/'
);

import { App } from './app/app';

import '@jupyter/collaboration/style/index.js';
import '@jupyterlab/application/style/index.js';
import '@jupyterlab/filebrowser/style/index.js';
import '@jupyterlab/ui-components/style/index.js';
import '@jupyterlab/launcher/style/index.js';
import '../style/index.css';
import './sharedscope';

function loadScript(url: string) {
  return new Promise((resolve, reject) => {
    const newScript = document.createElement('script');
    newScript.onerror = reject;
    newScript.onload = resolve;
    newScript.async = true;
    document.head.appendChild(newScript);
    newScript.src = url;
  });
}

async function loadComponent(url: string, scope: string) {
  await loadScript(url);

  // From MIT-licensed https://github.com/module-federation/module-federation-examples/blob/af043acd6be1718ee195b2511adf6011fba4233c/advanced-api/dynamic-remotes/app1/src/App.js#L6-L12
  // eslint-disable-next-line no-undef
  // @ts-ignore
  await __webpack_init_sharing__('default');
  // @ts-ignore
  const container = window._JUPYTERLAB[scope];
  // Initialize the container, it may provide shared modules and may need ours
  // eslint-disable-next-line no-undef
  // @ts-ignore
  await container.init(__webpack_share_scopes__.default);
}

async function createModule(scope: string, module: string) {
  try {
    // @ts-ignore
    const factory = await window._JUPYTERLAB[scope].get(module);
    return factory();
  } catch (e) {
    console.warn(
      `Failed to create module: package: ${scope}; module: ${module}`
    );
    throw e;
  }
}

/**
 * The main function
 */
async function main(): Promise<void> {
  // Inject some packages in the shared scope

  const app = new App();
  // populate the list of disabled extensions
  const disabled: any[] = [
    'jupytercad:serverInfoPlugin',
    'jupytercad:yjswidget-plugin'
  ];

  /**
   * Iterate over active plugins in an extension.
   *
   * #### Notes
   * This also populates the disabled
   */
  function* activePlugins(extension) {
    // Handle commonjs or es2015 modules
    let exports;
    if (Object.prototype.hasOwnProperty.call(extension, '__esModule')) {
      exports = extension.default;
    } else {
      // CommonJS exports.
      exports = extension;
    }

    const plugins = Array.isArray(exports) ? exports : [exports];
    for (const plugin of plugins as any[]) {
      if (PageConfig.Extension.isDisabled(plugin.id)) {
        disabled.push(plugin.id);
        continue;
      }
      yield plugin;
    }
  }

  const mods = [
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@jupyterlab/application-extension').default.filter((m: any) =>
      [
        '@jupyterlab/application-extension:router',
        '@jupyterlab/application-extension:layout',
        '@jupyterlab/application-extension:shell',
        '@jupyterlab/application-extension:context-menu'
      ].includes(m.id)
    ),
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@jupyterlab/apputils-extension').default.filter((m: any) =>
      [
        '@jupyterlab/apputils-extension:state',
        '@jupyterlab/apputils-extension:settings',
        '@jupyterlab/apputils-extension:themes',
        '@jupyterlab/apputils-extension:toolbar-registry'
      ].includes(m.id)
    ),
    require('@jupyterlab/theme-light-extension'),
    require('@jupyterlab/theme-dark-extension'),
    require('@jupyterlab/translation-extension'),
    require('@jupyterlab/codemirror-extension'),
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@jupyterlab/filebrowser-extension').default.filter(
      (m: any) => !['@jupyterlab/filebrowser-extension:widget'].includes(m.id)
    ),
    require('@jupyterlab/docmanager-extension'),
    require('@jupyterlab/launcher-extension'),
    require('./app/plugins/paths'),
    require('./app/plugins/mainmenu'),
    require('./app/plugins/browser'),
    require('./app/plugins/launcher')
  ];

  const federatedExtensionPromises: Promise<any>[] = [];
  const federatedStylePromises: Promise<any>[] = [];

  const extension_data = JSON.parse(
    PageConfig.getOption('federated_extensions')
  );

  const extensions = await Promise.allSettled(
    extension_data.map(async data => {
      await loadComponent(
        `${URLExt.join(
          PageConfig.getOption('fullLabextensionsUrl'),
          data.name,
          data.load
        )}`,
        data.name
      );
      return data;
    })
  );

  extensions.forEach(p => {
    if (p.status === 'rejected') {
      // There was an error loading the component
      console.error(p.reason);
      return;
    }

    const data = p.value;
    if (data.extension) {
      federatedExtensionPromises.push(createModule(data.name, data.extension));
    }
    if (data.mimeExtension) {
      // TODO Do we need mime extensions?
      return;
    }
    if (data.style && !PageConfig.Extension.isDisabled(data.name)) {
      federatedStylePromises.push(createModule(data.name, data.style));
    }
  });

  // Add the federated extensions.
  const federatedExtensions = await Promise.allSettled(
    federatedExtensionPromises
  );
  federatedExtensions.forEach(p => {
    if (p.status === 'fulfilled') {
      for (const plugin of activePlugins(p.value)) {
        if (!disabled.includes(plugin.id)) {
          mods.push(plugin);
        }
      }
    } else {
      console.error(p.reason);
    }
  });

  // Load all federated component styles and log errors for any that do not
  (await Promise.allSettled(federatedStylePromises))
    .filter(({ status }) => status === 'rejected')
    .forEach(e => {
      console.error((e as any).reason);
    });

  app.registerPluginModules(mods);

  await app.start();
}

window.addEventListener('load', main);
