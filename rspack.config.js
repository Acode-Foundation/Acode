const path = require('path');
const { rspack } = require('@rspack/core');
const { getAppConfig, getWebBundlePath, getAdConfig } = require('./dev/config');
const StripSourceMapCommentsPlugin = require('./dev/stripSourceMapComments');

module.exports = (env, options) => {
  const { mode = 'development' } = options;
  const prod = mode === 'production';
  const platform = process.env.ACODE_PLATFORM || 'android';
  const { variant } = getAppConfig(platform);
  const ads = getAdConfig(platform, prod ? 'Release' : 'Debug');
  const isDev = process.env.DEV_MODE === 'true';
  const devHost = process.env.DEV_HOST || '';
  const devPort = process.env.DEV_PORT || '';
  const devProto = isDev ? (process.env.DEV_PROTO || '') : '';

  // Match the oldest engine each platform supports (MIN_WEBVIEW_MAJOR in
  // src/index.html, IPHONEOS_DEPLOYMENT_TARGET in Xcode) instead of plain
  // ES2015, so native async/await, classes and spread are kept. `entry` mode
  // rewrites `import "core-js/stable"` to only the polyfills that engine still
  // needs, so plugins keep every global they could rely on.
  const swcEnv = {
    targets: platform === 'ios' ? 'ios_saf >= 18' : 'chrome >= 67',
    mode: 'entry',
    coreJs: require('core-js/package.json').version,
    // core-js replaces the native Array.prototype.push below Chrome 122, for
    // edge cases (lengths past 2^32 - 1, push() with no arguments on an array
    // with a read-only length) nothing relies on. Its JS version is ~8x
    // slower, and the parser, CodeMirror and the renderer push constantly.
    exclude: ['es.array.push'],
  };
  const typescriptLoader = {
    loader: 'builtin:swc-loader',
    options: { jsc: { parser: { syntax: 'typescript', tsx: false } }, env: swcEnv },
  };
  const rules = [
    {
      test: /typescript[\\/]lib[\\/]lib\..*\.d\.ts$/,
      type: 'asset/source',
    },
    // Native APIs are plain TypeScript; only editor sources use the JSX loader.
    {
      test: /\.tsx?$/,
      exclude: /node_modules/,
      oneOf: [
        { include: /[\\/]src[\\/](?:native|platforms)[\\/]/, use: [typescriptLoader] },
        { use: [typescriptLoader, path.resolve(__dirname, 'dev/custom-loaders/html-tag-jsx-loader.js')] },
      ],
    },
    // JavaScript files
    {
      test: /\.m?js$/,
      oneOf: [
        // Node modules - use builtin:swc-loader only
        // The codemirror-lsp-client submodule is installed through a "file:"
        // dependency, so it resolves to its real path outside node_modules. It
        // still ships pre-built code and must not go through the source loaders.
        {
          include: /[\\/](?:node_modules|codemirror-lsp-client)[\\/]/,
          use: [
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  parser: {
                    syntax: 'ecmascript',
                  },
                },
                env: swcEnv,
              },
            },
          ],
        },
        // Source JS files - Custom JSX loader + SWC (JSX will be removed first)
        {
          use: [
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  parser: {
                    syntax: 'ecmascript',
                    jsx: false,
                  },
                },
                env: swcEnv,
              },
            },
            path.resolve(__dirname, 'dev/custom-loaders/html-tag-jsx-loader.js'),
          ],
        },
      ],
    },
    // Handlebars and Markdown files
    {
      test: /\.(hbs|md)$/,
      type: 'asset/source',
    },
    // Module CSS/SCSS (with .m prefix)
    {
      test: /\.m\.(sa|sc|c)ss$/,
      use: [
        'raw-loader',
        'postcss-loader',
        'sass-loader',
      ],
      type: 'javascript/auto',
    },
    {
      test: /\.svg$/,
      resourceQuery: /raw/,
      type: 'asset/source',
    },
    {
      test: /\.(png|svg|jpg|jpeg|ico|webp)(\?.*)?$/,
      resourceQuery: /inline/,
      type: 'asset/inline',
    },
    // Asset files
    {
      test: /\.(png|svg|jpg|jpeg|ico|ttf|webp|eot|woff|webm|mp4|wav)(\?.*)?$/,
      resourceQuery: { not: [/raw/, /inline/] },
      type: 'asset/resource',
    },
    // Regular CSS files do not need Sass processing. Passing icon CSS through
    // Sass converts escaped private-use code points into literal characters in
    // production, which Android's asset WebView renders as missing glyphs.
    {
      test: /(?<!\.m)\.css$/,
      type: 'javascript/auto',
      use: [
        rspack.CssExtractRspackPlugin.loader,
        'css-loader',
        'postcss-loader',
      ],
    },
    // Regular Sass/SCSS files
    {
      test: /\.(?<!\.m\.)(sa|sc)ss$/,
      type: 'javascript/auto',
      use: [
        rspack.CssExtractRspackPlugin.loader,
        'css-loader',
        'postcss-loader',
        'sass-loader',
      ],
    },
  ];

  const main = {
    mode,
    node: {
      __dirname: false,
      __filename: false,
    },
    entry: {
      boot: './src/boot.js',
      native: './src/native/index.ts',
      main: './src/main.js',
      console: './src/lib/console.js',
      consoleWorker: './src/lib/consoleWorker.js',
      searchInFilesWorker: './src/sidebarApps/searchInFiles/worker.js',
      searchIndexWorker: './src/sidebarApps/searchInFiles/indexWorker.js',
      htmlLspWorker: './src/cm/lsp/workers/html.worker.ts',
      cssLspWorker: './src/cm/lsp/workers/css.worker.ts',
      jsonLspWorker: './src/cm/lsp/workers/json.worker.ts',
      typescriptLspWorker: './src/cm/lsp/workers/typescript.worker.ts',
    },
    output: {
      path: getWebBundlePath(),
      filename: 'build/[name].js',
      chunkFilename: 'build/[name].chunk.js',
      assetModuleFilename: 'build/[name][ext]',
      publicPath: 'auto',
      clean: !isDev,
    },
    // TypeScript's Node-only plugin loader uses a dynamic require. It is never
    // reached by the browser worker, but Rspack cannot prove that statically.
    ignoreWarnings: [
      {
        module: /typescript[\\/]lib[\\/]typescript\.js$/,
        message: /Critical dependency/,
      },
    ],
    module: {
      rules,
      exprContextCritical: false,
      parser: {
        javascript: {
          exportsPresence: 'error',
          requireAlias: false,
        },
      },
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      fallback: {
        path: require.resolve('path-browserify'),
        crypto: false,
      },
      modules: ['node_modules', 'src'],
      roots: [],
    },
    plugins: [
      new StripSourceMapCommentsPlugin(),
      new rspack.CopyRspackPlugin({
        patterns: [
          { from: 'src/index.html', to: 'index.html' },
          { from: 'src/res/logo.svg', to: 'logo.svg' },
          { from: 'src/res/favicon.ico', to: 'favicon.ico' },
          { from: 'src/res/icons/*.svg', to: 'icons/[name][ext]' },
        ],
      }),
      ...(variant === 'paid' ? [new rspack.NormalModuleReplacementPlugin(
        /^(?:\.\/|lib\/)(startAd|rewardedAd)(?:\.js)?$/,
        (resource) => {
          const name = path.basename(resource.request).replace(/\.js$/, '');
          resource.request = path.resolve(__dirname, 'src/lib/paid', `${name}.js`);
        },
      )] : []),
      new rspack.DefinePlugin({
        __FREE__: JSON.stringify(variant === 'free'),
        IS_IOS: JSON.stringify(platform === 'ios'),
        IS_ANDROID: JSON.stringify(platform === 'android'),
        PLATFORM: JSON.stringify(platform),
        ADMOB_APP_ID: JSON.stringify(ads.appId),
        ADMOB_BANNER_ID: JSON.stringify(ads.banner),
        ADMOB_INTERSTITIAL_ID: JSON.stringify(ads.interstitial),
        ADMOB_REWARDED_ID: JSON.stringify(ads.rewarded),
        ADMOB_APP_OPEN_ID: JSON.stringify(ads.appOpen),
        __FDROID__: JSON.stringify(process.env.ACODE_FDROID === 'true'),
        __DEV_MODE__: JSON.stringify(isDev),
        __DEV_HOST__: JSON.stringify(devHost),
        __DEV_PORT__: JSON.stringify(devPort),
        __DEV_PROTO__: JSON.stringify(devProto),
      }),
      new rspack.CssExtractRspackPlugin({
        filename: 'build/[name].css',
      }),
    ],
  };

  return [main];
};
