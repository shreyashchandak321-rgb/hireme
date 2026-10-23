/** Extract text locally in the browser; never send a document to an AI provider. */
export async function extractResumeText(file: Pick<File,'name'|'size'|'arrayBuffer'|'text'>) {
  if (!file.size || file.size > 3 * 1024 * 1024) throw new Error('Choose a resume up to 3 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  if (ext === 'txt') text = await file.text();
  else if (ext === 'pdf') {
    const {getDocumentProxy} = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    try {
      if (doc.numPages > 20) throw new Error('Use a resume with no more than 20 pages.');
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i), content = await page.getTextContent();
        for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
        text += '\n';
      }
    } finally { await (doc as unknown as {destroy?:()=>Promise<void>}).destroy?.(); }
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser.js');
    text = (await mammoth.extractRawText({arrayBuffer: await file.arrayBuffer()})).value;
  } else throw new Error('Use a PDF, DOCX, or TXT resume.');
  text = text.normalize('NFKC').replace(/\r\n?/g,'\n').replace(/[\t ]+\n/g,'\n').trim();
  if (text.length < 40) throw new Error('No usable text found. Scanned PDFs need OCR; paste your resume text instead.');
  if (text.length > 60000) throw new Error('Resume text exceeds 60,000 characters. Use a shorter document.');
  return text;
}
