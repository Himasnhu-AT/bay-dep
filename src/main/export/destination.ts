/**
 * Checking an export destination before spending minutes on it.
 *
 * `export.start()` used to resolve for an output path whose parent directory did not exist.
 * The job ran to completion and died at the ffmpeg write with `exited with 254: [out#0/mp4 …]
 * Error o…`. Nothing was lost and the UI recovered — so this is not a correctness bug, it is a
 * *cost* bug, and the cost is asymmetric in the extreme: the check is one `stat`, and the
 * thing it saves is the single most expensive operation in the app. On a long 4K export the
 * user learns their destination was wrong after paying for the whole render.
 *
 * Writability is checked in the same pass. A directory that exists but cannot be written to
 * fails just as late and just as expensively, and `W_OK` beside `F_OK` is the same syscall
 * budget. This is not a permissions model and does not try to be one — it is the same
 * question asked one step earlier.
 *
 * No Electron here, so the answers are testable against real directories.
 */

import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'

export interface DestinationProblem {
  /** Written as a recovery instruction: what is wrong, and what to do about it. */
  message: string
}

/**
 * Returns the reason this destination cannot be written, or null if it can.
 *
 * Deliberately checks the *directory*, never the file: the output not existing is the normal
 * case, and a check that required it would refuse every first export.
 */
export async function checkExportDestination(
  outputPath: string
): Promise<DestinationProblem | null> {
  if (outputPath.trim().length === 0) {
    return { message: 'No output path was given for the export.' }
  }

  const folder = dirname(outputPath)

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(folder)
  } catch {
    return {
      message:
        `The folder ${folder} does not exist, so the export has nowhere to write. ` +
        `Create it, or choose another destination.`
    }
  }

  if (!info.isDirectory()) {
    // A path whose parent is a *file* — usually a missing extension somewhere upstream, or a
    // path assembled from the wrong pieces. ffmpeg's ENOTDIR says nothing about which.
    return {
      message:
        `${folder} is a file, not a folder, so ${outputPath} cannot be created inside it. ` +
        `Check the destination path.`
    }
  }

  try {
    await access(folder, constants.W_OK)
  } catch {
    return {
      message:
        `The folder ${folder} cannot be written to. Choose a different destination, or ` +
        `change the folder's permissions.`
    }
  }

  return null
}
