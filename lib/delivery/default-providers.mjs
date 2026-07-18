import { createProviderRegistry } from "./provider-registry.mjs";
import { createGitRemoteProvider } from "./providers/git-remote.mjs";
import { createGitHubCliProvider } from "./providers/github-cli.mjs";
import { createLocalFilesystemProvider } from "./providers/local-filesystem.mjs";

export const DEFAULT_DELIVERY_PROVIDER_SELECTION = Object.freeze({
  git_push: "git-remote",
  pull_request: "github-cli",
  local_release: "local-filesystem",
});

/**
 * Built-ins are observers only. Applications can construct their own registry
 * with the same SPI; the CLI deliberately never loads an executable or module
 * path from project configuration.
 */
export function createDefaultDeliveryProviderRegistry(options = {}) {
  return createProviderRegistry([
    createGitRemoteProvider(options.git_remote),
    createGitHubCliProvider(options.github_cli),
    createLocalFilesystemProvider(options.local_filesystem),
  ]);
}
