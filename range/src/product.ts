/**
 * product.ts — what this software is called and who publishes it.
 *
 * Distinct from world/company.ts, which is the fictional hospital inside the
 * simulation. This is the real product: the window title, the installer, the
 * lock screen badge and the landing page. electron/main.cjs and site/ keep
 * their own copies; tests/branding.test.ts checks they agree with this file.
 */
export const PRODUCT = {
  name: 'Meridian IAM Range',
  windowTitle: 'Meridian IAM Range: Healthcare Identity Operations Workstation',
  publisher: 'Erick Omari',
  tagline: 'Practise hospital identity and access management on a workstation that behaves like the real one.',
  /** Installed copies check this repository's releases for updates, so it must not change. */
  repo: 'pitchiluxe/identityforge-iam-lab',
} as const;

export const PRODUCT_REPO_URL = `https://github.com/${PRODUCT.repo}`;
export const PRODUCT_RELEASES_URL = `${PRODUCT_REPO_URL}/releases/latest`;
