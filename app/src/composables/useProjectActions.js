/**
 * @module composables/useProjectActions
 * @description What can be done to a project, as menu items: its settings, an
 * export, showing its folder, sharing it or keeping it on this device, and
 * removing it: to the trash, with an Undo, whether it is this account's or
 * shared with it. The outline's menus offer them for the project open, and a
 * list of projects for any of them, without opening it.
 *
 * A project not open here has only its story and its root in memory. That is
 * enough to remove it or show its folder; what wants its documents reads them
 * first (`readWhole`). One open in another window is that window's, and only
 * its folder can be shown from here.
 */

import { useConfirm } from 'primevue/useconfirm'
import { useRouter } from 'vue-router'
import { sharing } from '@/cloud/people.js'
import { askForProject, letGoOfProject, takeProject } from '@/platform/windows.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useCloudSync } from './useCloudSync.js'
import { useExport } from './useExport.js'
import { useProjects } from './useProjects.js'
import { useReveal } from './useReveal.js'
import { saveNow } from './useSaveBeforeClosing.js'
import { useSettingsPanel } from './useSettingsPanel.js'
import { useToast } from './useToast.js'

/**
 * Whether a project is out of sync here: kept on this device by the writer,
 * or by another device to itself and then brought back out of the trash here.
 * @param {any} story
 */
const keptOffSync = story => Boolean(story?.syncOff || story?.keptElsewhere)

/**
 * @typedef {Object} ItemsOptions
 * @property {boolean} [current] - It is the project open in this window
 * @property {Array<Object>} [beforeDelete] - Items of the caller's to go above Remove
 */

/**
 * @returns {{itemsFor: (storyId: string, options?: ItemsOptions) => Array<Object>}}
 */
export function useProjectActions() {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const projects = useProjects()
  const cloud = useCloudSync()
  const settingsPanel = useSettingsPanel()
  const { revealItem } = useReveal()

  /**
   * Have a project not open here in memory, whole. It is read holding the
   * project, as a job is, so that this window hears when another takes it
   * later and knows that what it read is behind. If another has had it since
   * this window last read it, what is here is behind already: the page reads
   * it all again, and the writer can ask again. One gone to another window
   * since the menu opened is shown there.
   *
   * @param {string} storyId
   * @returns {Promise<boolean>} Whether it is here to use
   */
  const readWhole = async storyId => {
    const { held, stale, first } = await takeProject(storyId, 'read')
    if (!held) {
      askForProject(storyId)
      return false
    }
    try {
      if (stale) {
        await saveNow()
        window.location.reload()
        return false
      }
      if (first) await storiesStore.readAfresh(storyId)
      await documentsStore.loadStory(storyId)
      return true
    } finally {
      letGoOfProject(storyId, 'read')
    }
  }

  /**
   * @param {string} storyId
   * @returns {Promise<boolean>} Whether it is ready for what wants its documents
   */
  const ready = async storyId => {
    try {
      return await readWhole(storyId)
    } catch (error) {
      console.error('Failed to read the project:', error)
      toast.error("The project couldn't be read.")
      return false
    }
  }

  /**
   * @param {string} storyId
   * @param {boolean} current
   * @param {'sharing'} [part]
   */
  const showSettings = async (storyId, current, part) => {
    if (current) settingsPanel.open('project', part)
    else if (await ready(storyId)) settingsPanel.open('project', part, storyId)
  }

  /**
   * As it would be published; a backup is in the settings.
   * @param {string} storyId
   * @param {boolean} current
   */
  const exportProject = async (storyId, current) => {
    if (current || (await ready(storyId))) {
      await useExport(storyId, toast).exportDocument(rootIdFor(storyId))
    }
  }

  /**
   * To the trash, and to another project if it was the one open, with an
   * Undo that brings it back, and back open if it was. One shared goes to
   * this account's trash alone, and stops syncing until it is back.
   * @param {string} storyId
   * @param {boolean} current
   */
  const remove = async (storyId, current) => {
    if (!storiesStore.getStory(storyId)) return
    const name = projects.nameOf(storyId)
    try {
      await projects.trash(storyId)
      if (current) router.push('/')
    } catch (error) {
      console.error('Failed to move the project to the trash:', error)
      toast.error("The project couldn't be moved to the trash.")
      return
    }
    toast.action(`Removed ${name}`, {
      label: 'Undo',
      command: async () => {
        try {
          await projects.restore(storyId)
          if (current) await projects.pick(storyId)
        } catch (error) {
          console.error('Failed to bring the project back from the trash:', error)
          toast.error("The project couldn't be brought back. It's in the trash.")
        }
      },
    })
  }

  /**
   * Keep a project on this device only, once the writer has said so.
   * @param {string} storyId
   */
  const confirmKeepHere = storyId => {
    confirm.require({
      message: `Keep “${projects.nameOf(storyId)}” on this device only? It leaves the sync server, and your other devices move it to their trash.`,
      header: 'Keep on this device only',
      rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
      acceptProps: { label: 'Keep here only' },
      accept: async () => {
        try {
          await cloud.keepOnThisDevice(storyId)
        } catch (error) {
          toast.error(error.message)
        }
      },
    })
  }

  /**
   * Sync a project again, having kept it on this device only.
   * @param {string} storyId
   */
  const syncAgain = async storyId => {
    try {
      await cloud.syncProjectAgain(storyId)
    } catch (error) {
      toast.error(error.message)
    }
  }

  /**
   * The menu items for a project.
   *
   * @param {string} storyId
   * @param {ItemsOptions} [options]
   * @returns {Array<Object>}
   */
  const itemsFor = (storyId, { current = false, beforeDelete = [] } = {}) => {
    // In the desktop app, the project's folder.
    const reveal = revealItem(rootIdFor(storyId))
    if (!current && projects.elsewhere.value.has(storyId)) return reveal ? [reveal] : []

    // Not saved yet, it has only its settings: there is nothing to export,
    // share, show on disk or remove.
    if (storiesStore.isFresh(storyId)) {
      return [
        {
          label: 'Project settings',
          icon: 'pi pi-cog',
          command: () => showSettings(storyId, current),
        },
        ...beforeDelete,
      ]
    }

    // One shared with this account shows its people, and is its owner's to keep off.
    const sharedWithMe = sharing.value.projects[storyId]?.role === 'member'
    return [
      {
        label: 'Project settings',
        icon: 'pi pi-cog',
        command: () => showSettings(storyId, current),
      },
      {
        label: 'Export project',
        icon: 'pi pi-download',
        command: () => exportProject(storyId, current),
      },
      ...(reveal ? [reveal] : []),
      // Signed in to sync: shared, kept on this device, or synced again. One
      // shared with this account is its owner's to keep off.
      ...(cloud.account.value
        ? keptOffSync(storiesStore.getStory(storyId))
          ? [
              {
                label: 'Sync this project',
                icon: 'pi pi-cloud-upload',
                command: () => syncAgain(storyId),
              },
            ]
          : [
              {
                label: sharedWithMe ? 'People…' : 'Share…',
                icon: 'pi pi-users',
                command: () => showSettings(storyId, current, 'sharing'),
              },
              ...(sharedWithMe
                ? []
                : [
                    {
                      label: 'Keep on this device only…',
                      icon: 'pi pi-cloud',
                      command: () => confirmKeepHere(storyId),
                    },
                  ]),
            ]
        : []),
      ...beforeDelete,
      { label: 'Remove', icon: 'pi pi-trash', command: () => remove(storyId, current) },
    ]
  }

  return { itemsFor }
}
