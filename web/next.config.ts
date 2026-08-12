import type { NextConfig } from "next";

/**
 * wagmi only publishes `wagmi/connectors` as a single barrel, so importing
 * `injected` also drags in the MetaMask, WalletConnect and Base connectors —
 * and with them a pile of dependencies that are optional to those connectors
 * and irrelevant to us. We register the injected connector and nothing else,
 * so none of this is reachable at runtime; webpack just has to resolve the
 * specifiers, and they aren't installed.
 *
 *   @x402/*        payment schemes, via @coinbase/cdp-sdk
 *   @solana/kit    same subtree
 *   pino-pretty    pino only loads it when pretty-printing is on
 *   async-storage  React Native storage, via @metamask/sdk
 *
 * IgnorePlugin drops them from the graph. Note that resolve.alias:false is not
 * enough for the x402 ones — those are dynamic imports, and webpack still
 * reports each as a build error even when the page renders fine.
 *
 * Revisit if we ever offer a connector that genuinely needs one of these.
 */
const UNREACHABLE_OPTIONAL_DEPS =
  /^(@x402(\/|$)|@solana\/kit$|pino-pretty$|@react-native-async-storage\/async-storage$)/;

const config: NextConfig = {
  // The SDK is a workspace package shipped as ESM; let Next compile it rather
  // than requiring a build step before `next dev` will start.
  transpilePackages: ["@parley/sdk"],

  // `webpack` comes in on the context so we don't take a direct dependency on
  // it just to reach IgnorePlugin.
  webpack: (webpackConfig, { webpack }) => {
    webpackConfig.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: UNREACHABLE_OPTIONAL_DEPS }),
    );
    return webpackConfig;
  },
};

export default config;
