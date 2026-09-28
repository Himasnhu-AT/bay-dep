/**
 * `/download`: a 302 to the newest notarized disk image. The site links here (product.download)
 * rather than to GitHub, so where the file is hosted can change without a copy edit.
 *
 * The file is a release asset on the owner's public profile repo, uploaded by hand after review;
 * no source from the app's repository is published there. `releases/latest/download/<name>` always
 * resolves to the newest non-draft, non-prerelease release, and `script/release-signed` writes a
 * copy of each DMG under this fixed name beside the versioned one for exactly this link.
 *
 * A navigation the visitor asked for, not a request the page makes: nothing is fetched until the
 * button is pressed, and then the browser goes to GitHub itself.
 */
const LATEST_DMG = "https://github.com/Himasnhu-AT/Himasnhu-AT/releases/latest/download/bay-mac-arm64.dmg";

// Prerendered like every other route: the answer is the same for every visitor.
export const dynamic = "force-static";

export function GET() {
  return new Response(null, { status: 302, headers: { Location: LATEST_DMG } });
}
