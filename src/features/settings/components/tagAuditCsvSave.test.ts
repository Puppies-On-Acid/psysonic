import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagAuditAlbum } from '@/lib/api/library';

const nativeMocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: nativeMocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: nativeMocks.writeFile }));

import { saveTagAuditCsv } from './tagAuditCsvSave';

const album = (id: string, name: string): TagAuditAlbum => ({
  serverId: 'server1', libraryId: 'library1', albumId: id,
  name, artist: 'Test artist', trackCount: 2,
  genreTaggedTracks: 0, moodTaggedTracks: 1,
  albumGenreTagged: false, genreStatus: 'missing', moodStatus: 'partial',
});

describe('Library tag audit native CSV save', () => {
  beforeEach(() => {
    nativeMocks.save.mockReset();
    nativeMocks.writeFile.mockReset();
    nativeMocks.writeFile.mockResolvedValue(undefined);
  });

  it('opens a native Save dialog and writes only the provided filtered results as UTF-8 CSV', async () => {
    nativeMocks.save.mockResolvedValue('C:\\Exports\\chosen.csv');
    const result = await saveTagAuditCsv([album('a1', 'Chosen, "Album"')], 'Save CSV');
    expect(result).toBe('saved');
    expect(nativeMocks.save).toHaveBeenCalledExactlyOnceWith({
      title: 'Save CSV',
      defaultPath: 'library-tag-audit.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    expect(nativeMocks.writeFile).toHaveBeenCalledTimes(1);
    const [path, writtenBytes] = nativeMocks.writeFile.mock.calls[0] as [string, Uint8Array];
    expect(path).toBe('C:\\Exports\\chosen.csv');
    // Tauri/Vitest can provide a typed array from another JS realm, making
    // instanceof Uint8Array fail even though the written bytes are valid.
    expect(ArrayBuffer.isView(writtenBytes)).toBe(true);
    const bytes = Uint8Array.from(writtenBytes);
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder strips a leading UTF-8 BOM by default.
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('"Chosen, ""Album"""');
    expect(csv).toContain('"a1"');
    expect(csv).not.toContain('a2');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('does not generate or write a file if the dialog is cancelled', async () => {
    nativeMocks.save.mockResolvedValue(null);
    expect(await saveTagAuditCsv([album('a1', 'Album')], 'Save CSV')).toBe('cancelled');
    expect(nativeMocks.writeFile).not.toHaveBeenCalled();
  });

  it('propagates native Save dialog errors to the UI', async () => {
    nativeMocks.save.mockRejectedValue(new Error('dialog unavailable'));
    await expect(saveTagAuditCsv([album('a1', 'Album')], 'Save CSV'))
      .rejects.toThrow('dialog unavailable');
    expect(nativeMocks.writeFile).not.toHaveBeenCalled();
  });

  it('propagates filesystem write failures to the UI instead of reporting success', async () => {
    nativeMocks.save.mockResolvedValue('C:\\Exports\\chosen.csv');
    nativeMocks.writeFile.mockRejectedValue(new Error('access denied'));
    await expect(saveTagAuditCsv([album('a1', 'Album')], 'Save CSV'))
      .rejects.toThrow('access denied');
    expect(nativeMocks.writeFile).toHaveBeenCalledTimes(1);
  });
});
