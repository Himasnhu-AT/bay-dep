/**
 * `.bay` documents as they exist on users' disks, one per format version, spelled out as text.
 *
 * Test support, not app code — nothing in the bundle imports this. It lives in `shared/` because
 * both halves test against it: main loads these through the migration chain, and the renderer
 * checks that the store still *writes* every key they contain.
 *
 * **Strings, not object literals, on purpose.** An object literal typed as `Project` would be
 * renamed along with the type by any refactoring tool, and a fixture that moves with the code
 * pins nothing. Every key below is a promise made to files that already exist, and a rename
 * that reaches this file has to be typed by hand, by someone who then has to read why.
 *
 * Bumping `PROJECT_VERSION` requires adding the *new* version's document here as well — the
 * migration test fails until every version from 0 to the current one has an entry. Never edit an
 * existing entry: files in that format are already written and will not change to match.
 */

/** Version 1, the first format to carry `version`. */
const V1 = `{
  "id": "prj_fixed",
  "name": "Fixture",
  "version": 1,
  "assets": [
    {
      "id": "asset_1",
      "kind": "video",
      "name": "goodall.mp4",
      "path": "/footage/goodall.mp4",
      "durationUs": 67833333,
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "hasAudio": true,
      "hasVideo": true,
      "posterPath": null,
      "waveformPath": null,
      "createdAt": 1700000000000
    }
  ],
  "timelines": [
    {
      "id": "tl_1",
      "name": "Timeline 1",
      "fps": 30,
      "width": 1080,
      "height": 1920,
      "background": "#000000",
      "tracks": [
        {
          "id": "trk_v1",
          "kind": "video",
          "name": "V1",
          "locked": false,
          "muted": false,
          "hidden": false,
          "items": [
            {
              "id": "item_1",
              "assetId": "asset_1",
              "trackId": "trk_v1",
              "from": 0,
              "durationInFrames": 150,
              "sourceStartUs": 20000000,
              "layout": {
                "left": 0,
                "top": 0,
                "width": 1080,
                "height": 1920,
                "opacity": 1,
                "rotation": 0
              },
              "volume": 1,
              "fadeInFrames": 15,
              "fadeOutFrames": 15,
              "speed": 1
            }
          ]
        }
      ]
    }
  ],
  "activeTimelineId": "tl_1",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000001
}`

/**
 * Version 0: identical to version 1 except that the `version` key did not exist yet. Kept as
 * its own document so the 0 → 1 migration has a real input rather than a synthesised one.
 */
const V0 = `{
  "id": "prj_old",
  "name": "Before versions",
  "assets": [],
  "timelines": [
    {
      "id": "tl_0",
      "name": "Timeline 1",
      "fps": 30,
      "width": 1920,
      "height": 1080,
      "background": "#000000",
      "tracks": [
        {
          "id": "trk_v0",
          "kind": "video",
          "name": "V1",
          "locked": false,
          "muted": false,
          "hidden": false,
          "items": []
        }
      ]
    }
  ],
  "activeTimelineId": "tl_0",
  "createdAt": 1690000000000,
  "updatedAt": 1690000000001
}`

/** Keyed by format version. One entry for every version from 0 to `PROJECT_VERSION`. */
export const BAY_DOCUMENTS: Record<number, string> = {
  0: V0,
  1: V1
}

/** The richest fixture — the one whose keys today's writer must still emit. */
export const V1_ON_DISK = V1
