export interface ReleaseArtifact {
  available: boolean;
  distribution: string;
  version: string | null;
  build: string | null;
  commit: string | null;
  urls: Record<string, string>;
  checksum: string | null;
}

export interface ReleaseManifest {
  schema: 1;
  version: string;
  build: string;
  commit: string;
  platforms: {
    web: ReleaseArtifact;
    android: ReleaseArtifact;
    iosWeb: ReleaseArtifact;
    ios: ReleaseArtifact;
    windows: ReleaseArtifact;
  };
}

export function compareSemanticVersions(left: string, right: string): -1 | 0 | 1 {
  const normalize = (version: string) => version.split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

export function shouldOfferUpdate(
  remoteVersion: string,
  currentVersion: string,
  remoteBuild: string,
  currentBuild: string,
): boolean {
  const versionOrder = compareSemanticVersions(remoteVersion, currentVersion);
  if (versionOrder > 0) return true;
  if (versionOrder < 0) return false;
  return remoteBuild !== currentBuild;
}

export function isCurrentArtifact(
  artifact: ReleaseArtifact,
  currentVersion: string,
  currentBuild: string,
): boolean {
  return artifact.available
    && artifact.version === currentVersion
    && artifact.build === currentBuild;
}
