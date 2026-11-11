import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLibraryRulesCsv } from './libraryRulesCsvSave';

const native = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: native.writeFile }));

describe('Library Rules native Save dialog', () => {
  beforeEach(() => {
    native.save.mockReset();
    native.writeFile.mockReset().mockResolvedValue(undefined);
  });

  it('uses the Save picker and writes only completed bytes', async () => {
    native.save.mockResolvedValue('C:\\Exports\\my-rules.csv');
    const csv = new Uint8Array([239, 187, 191, 65, 13, 10]);
    expect(await saveLibraryRulesCsv(csv, 'album', 'Export All Matches')).toBe('saved');
    expect(native.save).toHaveBeenCalledWith({
      title: 'Export All Matches',
      defaultPath: 'library-rules-albums.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    expect(native.writeFile).toHaveBeenCalledTimes(1);
    expect(native.writeFile).toHaveBeenCalledWith('C:\\Exports\\my-rules.csv', csv);
  });

  it('does not write when the user cancels the dialog', async () => {
    native.save.mockResolvedValue(null);
    expect(await saveLibraryRulesCsv(new Uint8Array([65]), 'track', 'Export All'))
      .toBe('cancelled');
    expect(native.writeFile).not.toHaveBeenCalled();
  });

  it('reports permission or disk failures instead of claiming success', async () => {
    native.save.mockResolvedValue('C:\\Exports\\rules.csv');
    native.writeFile.mockRejectedValue(new Error('access denied'));
    await expect(saveLibraryRulesCsv(new Uint8Array([65]), 'track', 'Export All'))
      .rejects.toThrow('access denied');
  });

  it('does not write when the Save picker fails', async () => {
    native.save.mockRejectedValue(new Error('dialog unavailable'));
    await expect(saveLibraryRulesCsv(new Uint8Array([65]), 'album', 'Export All'))
      .rejects.toThrow('dialog unavailable');
    expect(native.writeFile).not.toHaveBeenCalled();
  });
});
