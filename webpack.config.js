const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => ({
  entry: { hub: "./src/hub/hub.tsx" },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name]/[name].js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    // SDK'nın tek bir kopyasının yüklenmesini garanti eder.
    alias: {
      "azure-devops-extension-sdk": path.resolve(__dirname, "node_modules/azure-devops-extension-sdk"),
    },
  },
  module: {
    rules: [
      { test: /\.tsx?$/, loader: "ts-loader", options: { transpileOnly: true } },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
      { test: /\.(woff2?|ttf|eot|png|svg)$/, type: "asset/inline" },
    ],
  },
  plugins: [new CopyPlugin({ patterns: [{ from: "src/hub/hub.html", to: "hub/hub.html" }] })],
  devtool: argv.mode === "development" ? "inline-source-map" : false,
  devServer: { port: 3001, hot: false },
  performance: { hints: false },
  stats: "errors-warnings",
});
