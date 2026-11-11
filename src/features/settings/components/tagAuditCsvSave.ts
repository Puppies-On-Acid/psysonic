import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { TagAuditAlbum } from '@/lib/api/library';
import { auditAlbumsCsv } from './tagAuditPresentation';

/**
 * Tauri/WebView downloads are not reliable as browser-style blob anchors.
 * Use the same native picker + filesystem write as Psysonic's other exports.
 * Returns 'cancelled' without a write when the user dismisses the dialog.
 */
export async function saveTagAuditCsv(
  albums: readonly TagAuditAlbum[],
  dialogTitle: string,
): Promise<'saved' | 'cancelled'> {
  const path = await save({
    title: dialogTitle,
    defaultPath: 'library-tag-audit.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!path) return 'cancelled';

  await writeFile(path, new TextEncoder().encode(auditAlbumsCsv(albums)));
  return 'saved';
}
