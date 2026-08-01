// RegesCore gateway for LM Studio.
//
// Brand and engineering by davidio.dev
// https://davidio.dev  -  https://github.com/iboss21  -  https://likeakinginc.com
//
// A plugin that registers a generator does not appear in the plugin list; it
// appears in the model dropdown and behaves as a model. That is why the
// doctrine preprocessor lives in the separate `regescore` plugin: a
// preprocessor bundled here would only ever run when this gateway is selected.

import { type PluginContext } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { generate } from "./generator";

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withGlobalConfigSchematics(globalConfigSchematics);
  context.withGenerator(generate);
}
