import { compareVersions, isVersion, MIN_BASE_VERSION } from '../version';

const RELEASES_URL = 'https://api.github.com/repos/hansjlachmann/goeasyerp/releases?per_page=100';

interface Release {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/** The versions a development container can run, newest first. */
export function usableVersions(releases: Release[]): string[] {
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => String(release.tag_name).replace(/^v/, ''))
    .filter((version) => isVersion(version) && compareVersions(version, MIN_BASE_VERSION) >= 0)
    .sort((a, b) => compareVersions(b, a));
}

export async function fetchVersions(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'goeasyerp-vscode' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return usableVersions((await response.json()) as Release[]);
}
