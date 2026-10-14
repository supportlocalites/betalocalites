import { describe, expect, it } from 'vitest';
import { readAttachment, tidyFileName } from '@/server/conversation-files.server';

const pdf = (text = '') => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);

describe('file names sent in conversations', () => {
  it('drops folders and odd characters, keeps the right ending', () => {
    expect(tidyFileName('../../Our quote<1>.pdf', 'pdf')).toBe('Our quote1.pdf');
    expect(tidyFileName('C:\\Users\\me\\menu.PDF', 'pdf')).toBe('menu.pdf');
    expect(tidyFileName('cake.png', 'webp')).toBe('cake.webp');
  });
  it('never empty, never too long', () => {
    expect(tidyFileName('<<>>', 'pdf')).toBe('file.pdf');
    expect(tidyFileName(`${'a'.repeat(300)}.pdf`, 'pdf').length).toBeLessThanOrEqual(120);
  });
});

describe('reading the chosen file', () => {
  it('a PDF by its contents, whatever its name says', async () => {
    const got = await readAttachment(new File([pdf('hello')], 'notes.txt', { type: 'text/plain' }));
    expect(got && 'type' in got && got.type).toBe('application/pdf');
    expect(got && 'name' in got && got.name).toBe('notes.pdf');
  });
  it('not a photo or a PDF: refused in plain words', async () => {
    const got = await readAttachment(new File(['just words'], 'notes.txt', { type: 'text/plain' }));
    expect(got).toEqual({ error: 'Please choose a photo or a PDF.' });
  });
  it('a "PDF" that doesn’t end as one is refused', async () => {
    const got = await readAttachment(new File([new TextEncoder().encode('%PDF-1.4\nno ending')], 'x.pdf'));
    expect(got).toEqual({ error: 'Please choose a photo or a PDF.' });
  });
  it('nothing chosen: no file', async () => {
    expect(await readAttachment(null)).toBeNull();
    expect(await readAttachment(new File([], 'empty.pdf'))).toBeNull();
  });
});
