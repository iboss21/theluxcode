// RegesCore // Fable 5 for LM Studio.
//
// Brand and engineering by davidio.dev
// https://davidio.dev  -  https://github.com/iboss21  -  https://likeakinginc.com
//
// Models: https://huggingface.co/iBossonline/RegesCore-1.0-35
//         https://huggingface.co/iBossonline/RegesCore-1.0-9B-GGUF

import { type PluginContext } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { preprocess } from "./promptPreprocessor";

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withGlobalConfigSchematics(globalConfigSchematics);
  context.withPromptPreprocessor(preprocess);
}
