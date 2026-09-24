/**
 * The Media panel's file dialogs: locating a missing file, and reading or writing caption files.
 *
 * Each one is a dialog main owns because the renderer never opens a path. None of them imports:
 * a located file goes back through `importPaths`, which is still the only place a path is
 * probed and admitted to `bay://`.
 */

import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { COMPOSITION_EXTENSIONS } from '@shared/composition'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './asset-mint'
import { CAPTION_EXTENSIONS, captionFileProblem } from './caption-file'

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory()).catch(() => false)
}

async function openOne(window: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<string | null> {
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export async function locate(window: BrowserWindow | null, name: string, nearPath?: string | null): Promise<string | null> {
  // The folder it used to be in, when that still exists: a file renamed in place is found there.
  const near = nearPath ? dirname(nearPath) : null
  return openOne(window, {
    title: `Locate “${name}”`,
    message: `Choose the file “${name}” should now use.`,
    buttonLabel: 'Use this file',
    properties: ['openFile'],
    ...(near && (await isFolder(near)) ? { defaultPath: near } : {}),
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, 'gif', ...COMPOSITION_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
}

export async function readCaptions(path: string): Promise<{ name: string; text: string }> {
  const info = await stat(path)
  const problem = captionFileProblem(path, info.size)
  if (problem) throw new Error(problem)
  return { name: basename(path), text: await readFile(path, 'utf8') }
}

export async function openCaptions(window: BrowserWindow | null): Promise<{ name: string; text: string } | null> {
  const path = await openOne(window, {
    title: 'Import captions',
    buttonLabel: 'Import',
    properties: ['openFile'],
    filters: [{ name: 'Captions (SRT, WebVTT)', extensions: CAPTION_EXTENSIONS }]
  })
  return path ? readCaptions(path) : null
}

export async function saveCaptions(window: BrowserWindow | null, defaultName: string, text: string): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: 'Export captions',
    buttonLabel: 'Export',
    defaultPath: defaultName.toLowerCase().endsWith('.srt') ? defaultName : `${defaultName}.srt`,
    filters: [{ name: 'SubRip captions', extensions: ['srt'] }]
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, text, 'utf8')
  return result.filePath
}
