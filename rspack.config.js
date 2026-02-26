const path = require('path');
const { rspack } = require('@rspack/core');

module.exports = (env, options) => {
  const { mode = 'development' } = options;
  const prod = mode === 'production';

  const rules = [
    // TypeScript/TSX files - Custom JSX loader + SWC
    {
      test: /\.tsx?$/,
      exclude: /node_modules/,
      use: [
        {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: {
                syntax: 'typescript',
                tsx: false,
              },
              transform: {
                // react: {
                //   pragma: 'tag',
                //   pragmaFrag: 'Array',
                //   throwIfNamespace: false,
                //   development: false,
                //   useBuiltins: false,
                //   runtime: 'classic',
                // },
              },
              target: 'es2015',
            },
          },
        },
        path.resolve(__dirname, 'utils/custom-loaders/html-tag-jsx-loader.js'),
      ],
    },
    // JavaScript files
    {
      test: /\.m?js$/,
      oneOf: [
        // Node modules - use builtin:swc-loader only
        {
          include: /node_modules/,
          use: [
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  parser: {
                    syntax: 'ecmascript',
                  },
                  target: 'es2015',
                },
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
                  target: 'es2015',
                },
              },
            },
            path.resolve(__dirname, 'utils/custom-loaders/html-tag-jsx-loader.js'),
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
    // Asset files
    {
      test: /\.(png|svg|jpg|jpeg|ico|ttf|webp|eot|woff|webm|mp4|wav)(\?.*)?$/,
      type: 'asset/resource',
    },
    // Regular CSS/SCSS files
    {
      test: /(?<!\.m)\.(sa|sc|c)ss$/,
      use: [
        rspack.CssExtractRspackPlugin.loader,
        'css-loader',
        'postcss-loader',
        'sass-loader',
      ],
      type: 'javascript/auto',
    },
  ];

  const main = {
    mode,
    entry: {
      main: './src/main.js',
      console: './src/lib/console.js',
      searchInFilesWorker: './src/sidebarApps/searchInFiles/worker.js',
    },
    output: {
      path: path.resolve(__dirname, 'www/build/'),
      filename: '[name].js',
      chunkFilename: '[name].chunk.js',
      assetModuleFilename: '[name][ext]',
      publicPath: '/build/',
      clean: true,
    },
    module: {
      rules,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      fallback: {
        path: require.resolve('path-browserify'),
        crypto: false,
      },
      modules: ['node_modules', 'src'],
    },
    plugins: [
      new rspack.CssExtractRspackPlugin({
        filename: '[name].css',
      }),
    ],
  };

  return [main];
};
