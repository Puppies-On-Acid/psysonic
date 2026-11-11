import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { LibraryRuleEntity } from '../utils/libraryRuleModel';

/**
 * Open the native Save dialog ONLY after every read-only export batch
 * completed. No partial file is written if collection fails/cancels.
 * A filesystem error is thrown to the caller, never reported as success.
 */
export async function saveLibraryRulesCsv(
  bytes: Uint8Array,
  entity: LibraryRuleEntity,
  dialogTitle: string,
): Promise<'saved' | 'cancelled'> {
  const path = await save({
    title: dialogTitle,
    defaultPath: 'library-rules-' + entity + 's.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!path) return 'cancelled';
  await writeFile(path, bytes);
  return 'saved';
}
